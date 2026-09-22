// packages/core/src/types/index.ts

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface CsvOptions {
  separator?: string;
  delimiter?: string;
  encoding?: string;
  header?: boolean;
}

export interface LookupConfig {
  endpoint: string;
  params: Record<string, string>; // { "paramName": "ExcelColumnName" }
  response_id_field?: string;
  response_data_path?: string;
}

export type ContentType = 'application/json' | 'multipart/form-data' | 'application/octet-stream';

export interface RollbackConfig {
  enabled?: boolean;
  method?: 'DELETE' | 'PUT' | 'PATCH' | 'POST';
  endpoint?: string;
  payload?: Record<string, any>;
}

export interface IntegrationStep {
  name: string;
  enabled?: boolean;
  source_file: string;
  endpoint: string;
  method?: HttpMethod;
  unique_identifier?: string;
  batch_size?: number;
  response_id_field?: string;
  response_data_path?: string;
  mode?: 'sync' | 'create_only' | 'update_only';
  content_type?: ContentType;
  expected_status?: number | number[];
  csv_options?: CsvOptions;
  lookup?: LookupConfig;
  payload_mapping?: Record<string, any>;
  headers?: Record<string, string>;
  rollback?: RollbackConfig;
}

export interface ApiSeederConfig {
  $schema?: string;
  api_base_url: string;
  use_id_cache?: boolean;
  id_cache_file?: string;
  global_headers?: Record<string, string>;
  lookups?: Record<string, LookupConfig>;
  integration_steps: IntegrationStep[];
}

export interface StepProgressEvent {
  stepName: string;
  stepIndex: number;
  totalSteps: number;
  currentRow: number;
  totalRows: number;
  status: 'pending' | 'searching' | 'creating' | 'updating' | 'skipped' | 'success' | 'failed';
  message?: string;
  entityId?: string;
}

export interface ExecutionErrorRecord {
  stepName: string;
  sourceFile: string;
  sourceRowNumber: number;
  entityIdentifier?: string;
  payload: Record<string, any>;
  httpStatus?: number;
  errorMessage: string;
  apiResponse?: any;
}

export interface StepExecutionResult {
  stepName: string;
  totalRows: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  failedRecords: ExecutionErrorRecord[];
  durationMs: number;
}

export interface SeederRunResult {
  success: boolean;
  totalSteps: number;
  completedSteps: number;
  totalCreated: number;
  totalUpdated: number;
  totalFailed: number;
  stepResults: StepExecutionResult[];
  errorsReportPath?: string;
  durationMs: number;
}

export interface EngineOptions {
  failFast?: boolean;
  dryRun?: boolean;
  concurrency?: number;
  cacheFile?: string;
  workingDirectory?: string;
  onProgress?: (event: StepProgressEvent) => void;
  onLog?: (level: 'info' | 'warn' | 'error' | 'debug', message: string) => void;
}

export interface RollbackOptions {
  dryRun?: boolean;
  force?: boolean;
  workingDirectory?: string;
  onProgress?: (event: {
    stepName: string;
    entityId: string;
    status: 'deleted' | 'failed' | 'skipped';
    message?: string;
  }) => void;
  onLog?: (level: 'info' | 'warn' | 'error' | 'debug', message: string) => void;
}

export interface RollbackResult {
  success: boolean;
  totalDeleted: number;
  totalFailed: number;
  durationMs: number;
}
