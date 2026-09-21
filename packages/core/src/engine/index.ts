// packages/core/src/engine/index.ts

import * as path from 'node:path';
import { IdCacheManager } from '../cache/index.js';
import { ApiClient } from '../http/index.js';
import { FileParser, ParsedRow } from '../parser/index.js';
import { ErrorReporter } from '../reporter/index.js';
import { PayloadResolver } from '../resolver/index.js';
import { validateConfig } from '../schema/index.js';
import {
  ApiSeederConfig,
  EngineOptions,
  ExecutionErrorRecord,
  IntegrationStep,
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
    this.config = validateConfig(rawConfig);
    this.options = options;
    this.basePath = options.workingDirectory || process.cwd();

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

          if (step.id_lookup_config?.enabled !== false && step.id_lookup_config?.lookup_endpoint) {
            const queryParams = await this.resolver.resolveQueryParams(
              step.id_lookup_config.lookup_query_params,
              row
            );

            if (Object.keys(queryParams).length > 0) {
              if (this.options.dryRun) {
                this.options.onLog?.('debug', `[DRY-RUN] Lookup ${step.id_lookup_config.lookup_endpoint}`);
              } else {
                const lookupResp = await this.apiClient.getEntity(
                  step.id_lookup_config.lookup_endpoint,
                  queryParams
                );
                if (lookupResp.ok && lookupResp.data) {
                  existingEntity = this.apiClient.extractEntity(lookupResp.data, {
                    response_data_path: step.id_lookup_config.response_data_path,
                  });
                  if (existingEntity) {
                    existingId = this.apiClient.extractId(
                      existingEntity,
                      step.id_lookup_config.response_id_field
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
          const payload = await this.resolver.buildPayload(row, step.payload_mapping);
          if (!payload) {
            throw new Error(`Failed to build payload (missing required values or unresolved dependencies)`);
          }

          // 3. Dry-run Mode
          if (this.options.dryRun) {
            const simulatedId = `sim_${step.name}_${rIndex + 1}`;
            if (step.unique_identifier && row[step.unique_identifier]) {
              await this.cache.set(step.name, row[step.unique_identifier], simulatedId);
            }
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

          // 4. Send API Request
          let responseId: string | undefined = existingId;
          let isUpdate = Boolean(existingEntity && existingId);

          if (isUpdate) {
            // Update entity
            const updateMethod = step.method === 'PATCH' ? 'PATCH' : 'PUT';
            const endpoint = `${step.endpoint.replace(/\/+$/, '')}/${existingId}`;
            const resp = await this.apiClient.updateEntity(endpoint, payload, updateMethod, step.headers);

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
            const resp = await this.apiClient.createEntity(step.endpoint, payload, step.headers);
            if (!resp.ok) {
              throw {
                httpStatus: resp.status,
                apiResponse: resp.data,
                message: `Create failed with HTTP ${resp.status}`,
              };
            }

            const createdEntity = this.apiClient.extractEntity(resp.data);
            const newId = this.apiClient.extractId(createdEntity);
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
            // Also cache by row number as secondary reference
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

    // Generate Excel error report if errors occurred
    let errorsReportPath: string | undefined = undefined;
    if (allErrors.length > 0 && !this.options.dryRun) {
      const reportName = `api_seeder_errors_${new Date().toISOString().slice(0, 10)}.xlsx`;
      errorsReportPath = path.resolve(this.basePath, reportName);
      await ErrorReporter.generateExcelReport(allErrors, errorsReportPath);
    }

    await this.cache.save();

    return {
      success: overallSuccess && totalFailed === 0,
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
}
