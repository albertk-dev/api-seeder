// packages/core/src/schema/index.ts

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const CsvOptionsSchema = z
  .object({
    separator: z.string().optional().default(','),
    delimiter: z.string().optional(),
    encoding: z.string().optional().default('utf-8'),
    header: z.boolean().optional().default(true),
  })
  .passthrough();

export const LookupSchema = z.object({
  endpoint: z.string().min(1, 'Endpoint is required'),
  params: z.record(z.string(), z.string()).describe('Query parameter to Excel column name mapping'),
  response_id_field: z.string().optional().default('id'),
  response_data_path: z.string().optional(),
});

export const RollbackConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  method: z.enum(['DELETE', 'PUT', 'PATCH', 'POST']).optional().default('DELETE'),
  endpoint: z.string().optional(),
  payload: z.record(z.string(), z.any()).optional(),
});

export const IntegrationStepSchema = z.object({
  name: z.string().min(1, 'Step name is required'),
  enabled: z.boolean().optional().default(true),
  source_file: z.string().min(1, 'Source file path is required'),
  endpoint: z.string().min(1, 'Target API endpoint is required'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().default('POST'),
  unique_identifier: z.string().optional(),
  batch_size: z.number().int().positive().optional().default(1),
  response_id_field: z.string().optional().default('id'),
  response_data_path: z.string().optional(),
  mode: z.enum(['sync', 'create_only', 'update_only']).optional().default('sync'),
  content_type: z
    .enum(['application/json', 'multipart/form-data', 'application/octet-stream'])
    .optional()
    .default('application/json'),
  expected_status: z.union([z.number(), z.array(z.number())]).optional(),
  csv_options: CsvOptionsSchema.optional(),
  lookup: LookupSchema.optional(),
  payload_mapping: z
    .record(z.string(), z.any())
    .optional()
    .describe('JSON payload mapping structure (auto-mapped if omitted)'),
  headers: z.record(z.string(), z.string()).optional(),
  rollback: RollbackConfigSchema.optional(),
});

export const ApiSeederConfigSchema = z.object({
  $schema: z.string().optional(),
  api_base_url: z.string().url('api_base_url must be a valid URL'),
  use_id_cache: z.boolean().optional().default(true),
  id_cache_file: z.string().optional().default('.id_cache.json'),
  global_headers: z
    .record(z.string(), z.string())
    .optional()
    .default({
      'Content-Type': 'application/json',
    }),
  lookups: z.record(z.string(), LookupSchema).optional(),
  integration_steps: z.array(IntegrationStepSchema).min(1, 'At least one integration step is required'),
});

export type ApiSeederConfigInput = z.input<typeof ApiSeederConfigSchema>;
export type ApiSeederConfigValidated = z.infer<typeof ApiSeederConfigSchema>;
export type IntegrationStepValidated = z.infer<typeof IntegrationStepSchema>;
export type LookupValidated = z.infer<typeof LookupSchema>;

/**
 * Validates a config object against the Zod schema.
 * Throws a detailed ZodError if invalid.
 */
export function validateConfig(config: unknown): ApiSeederConfigValidated {
  return ApiSeederConfigSchema.parse(config);
}

/**
 * Safely parses a config object and returns success/errors.
 */
export function safeValidateConfig(config: unknown) {
  return ApiSeederConfigSchema.safeParse(config);
}

/**
 * Generates the official JSON Schema to enable autocompletion and hover docs in IDEs.
 */
export function generateJsonSchema(): Record<string, any> {
  return zodToJsonSchema(ApiSeederConfigSchema, {
    name: 'ApiSeederConfig',
    target: 'jsonSchema7',
  }) as Record<string, any>;
}
