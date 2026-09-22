import * as fs from 'node:fs';
import * as path from 'node:path';
import { IdCacheManager } from '../cache/index.js';
import { loadEnvFile, resolveEnvVariables } from '../env/index.js';
import { ApiClient } from '../http/index.js';
import { FileParser, ParsedRow } from '../parser/index.js';
import { ErrorReporter } from '../reporter/index.js';
import { PayloadResolver } from '../resolver/index.js';
import { validateConfig } from '../schema/index.js';
import { getMimeType } from '../transformers/index.js';
import {
  ApiSeederConfig,
  EngineOptions,
  ExecutionErrorRecord,
  IntegrationStep,
  RollbackOptions,
  RollbackResult,
  SeederRunResult,
  StepExecutionResult,
} from '../types/index.js';

export class SeederEngine {
  private config: ApiSeederConfig;
  private options: EngineOptions;
  private apiClient: ApiClient;
  private cache: IdCacheManager;
  private parser: FileParser;
  private resolver: PayloadResolver;
  private basePath: string;

  constructor(rawConfig: unknown, options: EngineOptions = {}) {
    this.basePath = options.workingDirectory || process.cwd();

    // 1. Load .env file from working directory if present
    loadEnvFile(this.basePath);

    // 2. Resolve environment variables in raw config before validation
    const configWithEnv = resolveEnvVariables(rawConfig);

    // 3. Validate against Zod schema
    this.config = validateConfig(configWithEnv);
    this.options = options;

    const cacheFilePath = this.config.use_id_cache
      ? path.resolve(this.basePath, this.config.id_cache_file || '.id_cache.json')
      : undefined;

    this.cache = new IdCacheManager(cacheFilePath, Boolean(this.config.use_id_cache));
    this.apiClient = new ApiClient({
      baseUrl: this.config.api_base_url,
      globalHeaders: this.config.global_headers,
    });
    this.parser = new FileParser();
    this.resolver = new PayloadResolver({
      cache: this.cache,
      apiClient: this.apiClient,
      parser: this.parser,
      config: this.config,
      basePath: this.basePath,
    });
  }

  /**
   * Executes the full seeding process across all configured steps.
   */
  public async run(): Promise<SeederRunResult> {
    const startTime = Date.now();
    await this.cache.load();

    const stepResults: StepExecutionResult[] = [];
    const allErrors: ExecutionErrorRecord[] = [];
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalFailed = 0;
    let overallSuccess = true;

    const enabledSteps = this.config.integration_steps.filter(
      (s) => s.enabled === undefined || s.enabled === true
    );

    for (let stepIndex = 0; stepIndex < enabledSteps.length; stepIndex++) {
      const step = enabledSteps[stepIndex];
      const stepStartTime = Date.now();

      this.options.onLog?.('info', `Starting step [${stepIndex + 1}/${enabledSteps.length}]: ${step.name}`);
      this.cache.initStep(step.name);

      let stepSuccessCount = 0;
      let stepFailureCount = 0;
      let stepSkippedCount = 0;
      const stepErrors: ExecutionErrorRecord[] = [];

      let rows: ParsedRow[] = [];
      try {
        rows = await this.parser.getData(step.source_file, {
          basePath: this.basePath,
          csvOptions: step.csv_options,
        });
      } catch (err: any) {
        const errorRecord: ExecutionErrorRecord = {
          stepName: step.name,
          sourceFile: step.source_file,
          sourceRowNumber: 1,
          payload: {},
          errorMessage: `Critical: Cannot read source file: ${err.message}`,
        };
        stepErrors.push(errorRecord);
        allErrors.push(errorRecord);
        stepFailureCount++;
        totalFailed++;

        if (this.options.failFast) {
          overallSuccess = false;
          break;
        }
        continue;
      }

      const batchSize = Math.max(1, step.batch_size || 1);

      // --- Batch Execution Mode (batch_size > 1) ---
      if (batchSize > 1) {
        for (let bIndex = 0; bIndex < rows.length; bIndex += batchSize) {
          const batchRows = rows.slice(bIndex, bIndex + batchSize);
          const currentRowNum = bIndex + 1;

          this.options.onProgress?.({
            stepName: step.name,
            stepIndex: stepIndex + 1,
            totalSteps: enabledSteps.length,
            currentRow: Math.min(bIndex + batchSize, rows.length),
            totalRows: rows.length,
            status: 'creating',
          });

          try {
            const batchPayloads: Record<string, any>[] = [];
            for (const r of batchRows) {
              const p = await this.resolver.buildPayload(r, step.payload_mapping);
              batchPayloads.push(p);
            }

            if (this.options.dryRun) {
              for (let i = 0; i < batchRows.length; i++) {
                const r = batchRows[i];
                const simId = `sim_${step.name}_batch_${bIndex + i + 1}`;
                if (step.unique_identifier && r[step.unique_identifier]) {
                  await this.cache.set(step.name, r[step.unique_identifier], simId);
                }
              }
              stepSuccessCount += batchRows.length;
              totalCreated += batchRows.length;
              continue;
            }

            const resp = await this.apiClient.createEntity(
              step.endpoint,
              batchPayloads,
              step.headers,
              step.expected_status
            );
            if (!resp.ok) {
              throw {
                httpStatus: resp.status,
                apiResponse: resp.data,
                message: `Batch POST failed with HTTP ${resp.status}`,
              };
            }

            // Extract IDs if response contains array
            const resData = resp.data;
            const items = Array.isArray(resData) ? resData : Array.isArray(resData?.data) ? resData.data : [];

            for (let i = 0; i < batchRows.length; i++) {
              const r = batchRows[i];
              const item = items[i];
              const id = item
                ? this.apiClient.extractId(item, step.response_id_field || 'id')
                : undefined;

              if (id && step.unique_identifier && r[step.unique_identifier]) {
                await this.cache.set(step.name, r[step.unique_identifier], id);
              }
            }

            stepSuccessCount += batchRows.length;
            totalCreated += batchRows.length;
          } catch (err: any) {
            stepFailureCount += batchRows.length;
            totalFailed += batchRows.length;

            const errorRecord: ExecutionErrorRecord = {
              stepName: step.name,
              sourceFile: step.source_file,
              sourceRowNumber: currentRowNum,
              payload: {},
              httpStatus: err.httpStatus,
              errorMessage: `Batch error: ${err.message || String(err)}`,
              apiResponse: err.apiResponse,
            };
            stepErrors.push(errorRecord);
            allErrors.push(errorRecord);

            if (this.options.failFast) {
              overallSuccess = false;
              break;
            }
          }
        }
      }
      // --- Row-by-Row Execution Mode (batch_size === 1) ---
      else {
        for (let rIndex = 0; rIndex < rows.length; rIndex++) {
          const row = rows[rIndex];
          const rowNumber = row.__rowNumber;

          this.options.onProgress?.({
            stepName: step.name,
            stepIndex: stepIndex + 1,
            totalSteps: enabledSteps.length,
            currentRow: rIndex + 1,
            totalRows: rows.length,
            status: 'searching',
          });

          try {
            // 1. Preventive Lookup (Check if entity already exists)
            let existingEntity: any = null;
            let existingId: string | undefined = undefined;

            if (step.lookup?.endpoint) {
              const queryParams = await this.resolver.resolveQueryParams(step.lookup.params, row);

              if (Object.keys(queryParams).length > 0) {
                if (this.options.dryRun) {
                  this.options.onLog?.('debug', `[DRY-RUN] Lookup ${step.lookup.endpoint}`);
                } else {
                  const lookupResp = await this.apiClient.getEntity(step.lookup.endpoint, queryParams);
                  if (lookupResp.ok && lookupResp.data) {
                    existingEntity = this.apiClient.extractEntity(lookupResp.data, {
                      response_data_path: step.lookup.response_data_path,
                    });
                    if (existingEntity) {
                      existingId = this.apiClient.extractId(
                        existingEntity,
                        step.lookup.response_id_field || 'id'
                      );
                    }
                  }
                }
              }
            }

            const mode = step.mode || 'sync';

            // Skip logic based on mode
            if (mode === 'create_only' && existingEntity) {
              stepSkippedCount++;
              this.options.onProgress?.({
                stepName: step.name,
                stepIndex: stepIndex + 1,
                totalSteps: enabledSteps.length,
                currentRow: rIndex + 1,
                totalRows: rows.length,
                status: 'skipped',
                message: 'Already exists (create_only mode)',
              });
              continue;
            }

            if (mode === 'update_only' && !existingEntity) {
              stepSkippedCount++;
              this.options.onProgress?.({
                stepName: step.name,
                stepIndex: stepIndex + 1,
                totalSteps: enabledSteps.length,
                currentRow: rIndex + 1,
                totalRows: rows.length,
                status: 'skipped',
                message: 'Entity not found for update (update_only mode)',
              });
              continue;
            }

            // 2. Build Payload
            const rawPayload = await this.resolver.buildPayload(row, step.payload_mapping);

            // 3. Dry-run Mode
            if (this.options.dryRun) {
              const simulatedId = step.response_id_field?.includes('url')
                ? `https://storage.cloud-ecoles.cm/uploads/sim_${step.name}_${rIndex + 1}.svg`
                : `sim_${step.name}_${rIndex + 1}`;
              if (step.unique_identifier && row[step.unique_identifier]) {
                await this.cache.set(step.name, row[step.unique_identifier], simulatedId);
              }
              await this.cache.set(step.name, `row_${rowNumber}`, simulatedId);
              stepSuccessCount++;
              totalCreated++;
              this.options.onProgress?.({
                stepName: step.name,
                stepIndex: stepIndex + 1,
                totalSteps: enabledSteps.length,
                currentRow: rIndex + 1,
                totalRows: rows.length,
                status: 'success',
                entityId: simulatedId,
                message: '[DRY-RUN] Simulated',
              });
              continue;
            }

            // Convert payload to FormData if content_type === 'multipart/form-data'
            let requestBody: any = rawPayload;
            if (step.content_type === 'multipart/form-data') {
              const formData = new FormData();
              for (const [k, v] of Object.entries(rawPayload)) {
                if (v && typeof v === 'object' && (v as any).__type === 'file') {
                  const filePath = (v as any).filePath;
                  const fileName = (v as any).fileName;
                  if (!fs.existsSync(filePath)) {
                    throw new Error(`Local file not found for upload: "${filePath}"`);
                  }
                  const fileBuffer = fs.readFileSync(filePath);
                  const mime = getMimeType(filePath);
                  const blob = new Blob([fileBuffer], { type: mime });
                  formData.append(k, blob, fileName);
                } else if (v !== undefined && v !== null) {
                  formData.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
                }
              }
              requestBody = formData;
            }

            // 4. Send API Request
            let responseId: string | undefined = existingId;
            const isUpdate = Boolean(existingEntity && existingId);

            if (isUpdate) {
              // Update entity
              const updateMethod = step.method === 'PATCH' ? 'PATCH' : 'PUT';
              const endpoint = `${step.endpoint.replace(/\/+$/, '')}/${existingId}`;
              const resp = await this.apiClient.updateEntity(
                endpoint,
                requestBody,
                updateMethod,
                step.headers,
                step.expected_status
              );

              if (!resp.ok) {
                throw {
                  httpStatus: resp.status,
                  apiResponse: resp.data,
                  message: `Update failed with HTTP ${resp.status}`,
                };
              }
              totalUpdated++;
            } else {
              // Create entity
              const resp = await this.apiClient.createEntity(
                step.endpoint,
                requestBody,
                step.headers,
                step.expected_status
              );
              if (!resp.ok) {
                throw {
                  httpStatus: resp.status,
                  apiResponse: resp.data,
                  message: `Create failed with HTTP ${resp.status}`,
                };
              }

              const createdEntity = this.apiClient.extractEntity(resp.data, {
                response_data_path: step.response_data_path,
              });
              const newId = this.apiClient.extractId(
                createdEntity,
                step.response_id_field || 'id'
              );
              if (newId) {
                responseId = newId;
              }
              totalCreated++;
            }

            // 5. Store ID in Cache
            if (responseId) {
              if (step.unique_identifier && row[step.unique_identifier]) {
                await this.cache.set(step.name, row[step.unique_identifier], responseId);
              }
              await this.cache.set(step.name, `row_${rowNumber}`, responseId);
            }

            stepSuccessCount++;
            this.options.onProgress?.({
              stepName: step.name,
              stepIndex: stepIndex + 1,
              totalSteps: enabledSteps.length,
              currentRow: rIndex + 1,
              totalRows: rows.length,
              status: 'success',
              entityId: responseId,
            });
          } catch (err: any) {
            stepFailureCount++;
            totalFailed++;

            const errorRecord: ExecutionErrorRecord = {
              stepName: step.name,
              sourceFile: step.source_file,
              sourceRowNumber: rowNumber,
              entityIdentifier: step.unique_identifier ? String(row[step.unique_identifier] || '') : undefined,
              payload: err.payload || {},
              httpStatus: err.httpStatus,
              errorMessage: err.message || String(err),
              apiResponse: err.apiResponse,
            };

            stepErrors.push(errorRecord);
            allErrors.push(errorRecord);

            this.options.onProgress?.({
              stepName: step.name,
              stepIndex: stepIndex + 1,
              totalSteps: enabledSteps.length,
              currentRow: rIndex + 1,
              totalRows: rows.length,
              status: 'failed',
              message: errorRecord.errorMessage,
            });

            if (this.options.failFast) {
              overallSuccess = false;
              break;
            }
          }
        }
      }

      await this.cache.save();

      stepResults.push({
        stepName: step.name,
        totalRows: rows.length,
        successCount: stepSuccessCount,
        failureCount: stepFailureCount,
        skippedCount: stepSkippedCount,
        failedRecords: stepErrors,
        durationMs: Date.now() - stepStartTime,
      });

      if (!overallSuccess) {
        break;
      }
    }

    // 6. Generate Error Audit Report if needed
    let errorsReportPath: string | undefined = undefined;
    if (allErrors.length > 0) {
      overallSuccess = false;
      const reportFile = path.resolve(this.basePath, `audit_errors_${Date.now()}.xlsx`);
      errorsReportPath = await ErrorReporter.generateExcelReport(allErrors, reportFile);
    }

    return {
      success: overallSuccess,
      totalSteps: enabledSteps.length,
      completedSteps: stepResults.length,
      totalCreated,
      totalUpdated,
      totalFailed,
      stepResults,
      errorsReportPath,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Reverses the ingestion by deleting created entities using the cached IDs.
   */
  public async rollback(options: RollbackOptions = {}): Promise<RollbackResult> {
    const startTime = Date.now();
    await this.cache.load();

    const onProgress = options.onProgress ?? (this.options.onProgress as any);
    const onLog = options.onLog ?? this.options.onLog;

    let totalDeleted = 0;
    let totalFailed = 0;
    let success = true;

    const steps = [...this.config.integration_steps].reverse();
    const cacheData = this.cache.toObject();

    for (const step of steps) {
      if (step.rollback?.enabled === false) {
        onLog?.('info', `Rollback skipped for step '${step.name}' (disabled).`);
        continue;
      }

      const stepCache = cacheData[step.name] || {};
      const uniqueIds = Array.from(
        new Set(
          Object.entries(stepCache)
            .filter(([key]) => !key.startsWith('row_'))
            .map(([, id]) => id)
        )
      );

      if (uniqueIds.length === 0) continue;

      const rbMethod = step.rollback?.method || 'DELETE';
      const rbPayload = step.rollback?.payload;

      onLog?.('info', `Rolling back step '${step.name}' (${uniqueIds.length} entities via ${rbMethod})...`);

      for (const entityId of uniqueIds) {
        let endpoint: string;
        if (step.rollback?.endpoint) {
          endpoint = step.rollback.endpoint
            .replace(':id', encodeURIComponent(entityId))
            .replace('${id}', encodeURIComponent(entityId));
        } else {
          endpoint = `${step.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(entityId)}`;
        }

        if (options.dryRun) {
          const payloadPreview = rbPayload ? ` with payload ${JSON.stringify(rbPayload)}` : '';
          onProgress?.({
            stepName: step.name,
            entityId,
            status: 'deleted',
            message: `[DRY-RUN] Would ${rbMethod} ${endpoint}${payloadPreview}`,
          });
          totalDeleted++;
          continue;
        }

        try {
          const resp = await this.apiClient.request(rbMethod, endpoint, {
            body: rbPayload,
            headers: step.headers,
          });

          if (resp.ok || resp.status === 404) {
            totalDeleted++;
            onProgress?.({
              stepName: step.name,
              entityId,
              status: 'deleted',
            });
          } else {
            totalFailed++;
            success = false;
            onProgress?.({
              stepName: step.name,
              entityId,
              status: 'failed',
              message: `HTTP ${resp.status}`,
            });
          }
        } catch (err: any) {
          totalFailed++;
          success = false;
          onProgress?.({
            stepName: step.name,
            entityId,
            status: 'failed',
            message: err.message || String(err),
          });
        }
      }

      // Clear step from cache if not dry-run and succeeded
      if (!options.dryRun && success) {
        this.cache.initStep(step.name);
      }
    }

    if (!options.dryRun) {
      await this.cache.save();
    }

    return {
      success,
      totalDeleted,
      totalFailed,
      durationMs: Date.now() - startTime,
    };
  }
}
