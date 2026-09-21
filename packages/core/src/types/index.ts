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
  response_data_path?: string; // Path to find item in nested responses, e.g. "data" or "results"
}

export interface IdLookupConfig {
  enabled?: boolean;
  lookup_endpoint: string;
  lookup_query_params: Record<string, string>;
  response_id_field?: string;
  response_data_path?: string;
}

export type PayloadValueMapping =
  | string // Column name, static value, or placeholder (${...}, #{...}, $ref:...)
  | number
  | boolean
  | null
  | PayloadValueMapping[]
  | { [key: string]: any };

export interface ChildArrayMapping {
  source_file: string;
  link_column_parent: string;
  link_column_child: string;
  mapping: Record<string, any>;
}

export interface SplitStringMapping {
  split_by: string;
  source_column: string;
}

export interface IntegrationStep {
  name: string;
  enabled?: boolean;
  source_file: string;
  endpoint: string;
  method?: HttpMethod;
  unique_identifier?: string;
  mode?: 'sync' | 'create_only' | 'update_only';
  csv_options?: CsvOptions;
  id_lookup_config?: IdLookupConfig;
  payload_mapping: Record<string, any>;
  headers?: Record<string, string>;
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
