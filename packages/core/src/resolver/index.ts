// packages/core/src/resolver/index.ts

import { IdCacheManager } from '../cache/index.js';
import { ApiClient } from '../http/index.js';
import { FileParser, ParsedRow } from '../parser/index.js';
import { ApiSeederConfig, CsvOptions } from '../types/index.js';

export interface ResolverContext {
  cache: IdCacheManager;
  apiClient: ApiClient;
  parser: FileParser;
  config: ApiSeederConfig;
  basePath?: string;
  csvOptions?: CsvOptions;
}

export class PayloadResolver {
  constructor(private ctx: ResolverContext) {}

  /**
   * Resolves query parameters for search/lookup endpoints from a data row.
   */
  public async resolveQueryParams(
    paramMapping: Record<string, string>,
    row: ParsedRow
  ): Promise<Record<string, any>> {
    const resolved: Record<string, any> = {};

    for (const [key, mappingVal] of Object.entries(paramMapping)) {
      if (typeof mappingVal === 'string') {
        if (mappingVal.startsWith('${') || mappingVal.startsWith('#{') || mappingVal.startsWith('$ref:')) {
          const val = await this.resolvePlaceholder(mappingVal, row);
          if (val !== undefined && val !== null) {
            resolved[key] = val;
          }
        } else if (mappingVal in row) {
          const cell = row[mappingVal];
          if (cell !== undefined && cell !== null && String(cell).trim() !== '') {
            resolved[key] = cell;
          }
        } else {
          resolved[key] = mappingVal;
        }
      } else {
        resolved[key] = mappingVal;
      }
    }

    return resolved;
  }

  /**
   * Resolves a placeholder string (${...}, #{...}, $ref:...)
   */
  public async resolvePlaceholder(value: string, row: ParsedRow): Promise<any> {
    const trimmed = value.trim();

    // Case 1: Cache placeholder ${step_name.id:column_name}
    if (trimmed.startsWith('${')) {
      const match = trimmed.match(/^\$\{([^:]+)\.id:([^}]+)\}$/);
      if (!match) return trimmed;

      const [, stepName, lookupColumnName] = match;
      const lookupValue = row[lookupColumnName];

      if (lookupValue === undefined || lookupValue === null || String(lookupValue).trim() === '') {
        return null;
      }

      const storedId = this.ctx.cache.get(stepName, String(lookupValue));
      return storedId !== undefined ? storedId : null;
    }

    // Case 2: Shorthand ref: $ref:step_name.id
    if (trimmed.startsWith('$ref:')) {
      const match = trimmed.match(/^\$ref:([^.]+)\.(.+)$/);
      if (match) {
        const [, stepName, field] = match;
        // Search cache for step
        const stepCache = this.ctx.cache.toObject()[stepName];
        if (stepCache) {
          // If a single ID exists, return it, or match against row identifiers
          const values = Object.values(stepCache);
          if (values.length === 1) return values[0];
          for (const key of Object.keys(row)) {
            if (stepCache[row[key]]) return stepCache[row[key]];
          }
          return values[values.length - 1] ?? null;
        }
      }
    }

    // Case 3: On-the-fly API Lookup #{lookup.name}
    if (trimmed.startsWith('#{')) {
      const match = trimmed.match(/^#\{lookup\.([^}]+)\}$/);
      if (!match) return null;

      const lookupName = match[1];
      const lookupDef = this.ctx.config.lookups?.[lookupName];

      if (!lookupDef) {
        throw new Error(`Lookup definition '${lookupName}' not found in configuration.`);
      }

      const params: Record<string, any> = {};
      for (const [paramName, sourceCol] of Object.entries(lookupDef.params)) {
        const cellVal = row[sourceCol];
        if (cellVal !== undefined && cellVal !== null && String(cellVal).trim() !== '') {
          // Try converting numbers with commas
          const cleaned = String(cellVal).replace(',', '.');
          const num = Number(cleaned);
          params[paramName] = !isNaN(num) && cleaned !== '' ? num : cellVal;
        }
      }

      const response = await this.ctx.apiClient.getEntity(lookupDef.endpoint, params);
      if (response.ok && response.data) {
        const entity = this.ctx.apiClient.extractEntity(response.data, {
          response_data_path: lookupDef.response_data_path,
        });

        if (entity) {
          const idField = lookupDef.response_id_field || 'id';
          return this.ctx.apiClient.extractId(entity, idField) ?? null;
        }
      }

      return null;
    }

    return value;
  }

  /**
   * Recursively builds the payload to be sent to the API.
   */
  public async buildPayload(
    row: ParsedRow,
    mapping: Record<string, any>
  ): Promise<Record<string, any> | null> {
    const payload: Record<string, any> = {};

    for (const [key, valueMapping] of Object.entries(mapping)) {
      if (key.includes('@options')) {
        continue;
      }

      let finalValue: any = null;

      // Case A: Mapping is an object (child file array, split string, or nested object)
      if (valueMapping && typeof valueMapping === 'object' && !Array.isArray(valueMapping)) {
        // Subcase A1: Child array from a secondary file
        if ('source_file' in valueMapping) {
          finalValue = await this.resolveChildArray(row, valueMapping);
        }
        // Subcase A2: Split string into array
        else if ('split_by' in valueMapping && 'source_column' in valueMapping) {
          const sourceVal = row[valueMapping.source_column];
          if (sourceVal !== undefined && sourceVal !== null && String(sourceVal).trim() !== '') {
            finalValue = String(sourceVal)
              .split(valueMapping.split_by)
              .map((s) => s.trim())
              .filter(Boolean);
          }
        }
        // Subcase A3: Nested JSON object
        else {
          finalValue = await this.buildPayload(row, valueMapping);
        }
      }
      // Case B: Mapping is a string (placeholder, column reference, mustache {{...}}, or static string)
      else if (typeof valueMapping === 'string') {
        const valTrimmed = valueMapping.trim();

        // Handle mustache syntax: "{{Nom}}" -> references column "Nom"
        const mustacheMatch = valTrimmed.match(/^\{\{\s*([^}]+)\s*\}\}$/);
        const resolvedColKey = mustacheMatch ? mustacheMatch[1].trim() : valTrimmed;

        if (valTrimmed.startsWith('${') || valTrimmed.startsWith('#{') || valTrimmed.startsWith('$ref:')) {
          finalValue = await this.resolvePlaceholder(valTrimmed, row);
          if (valTrimmed.startsWith('${') && (finalValue === null || finalValue === undefined)) {
            throw new Error(`Unresolved cache dependency for '${valTrimmed}' on row ${row.__rowNumber}`);
          }
        } else if (resolvedColKey in row) {
          const cell = row[resolvedColKey];
          if (cell !== undefined && cell !== null && String(cell).trim() !== '') {
            finalValue = cell;
          }
        } else {
          // Static string
          finalValue = valueMapping;
        }
      }
      // Case C: Mapping is an array (static array or array of sub-objects)
      else if (Array.isArray(valueMapping)) {
        finalValue = valueMapping;
      }
      // Case D: Primitive value (number, boolean)
      else {
        finalValue = valueMapping;
      }

      // Check fallback option: key@options: { empty_value: ... }
      if (finalValue === null || finalValue === undefined) {
        const optionKey = `${key}@options`;
        if (optionKey in mapping && typeof mapping[optionKey] === 'object') {
          finalValue = mapping[optionKey]?.empty_value;
        }
      }

      if (finalValue !== null && finalValue !== undefined) {
        payload[key] = finalValue;
      }
    }

    return Object.keys(payload).length > 0 ? payload : null;
  }

  /**
   * Resolves child rows from a secondary file into an array of payloads.
   */
  private async resolveChildArray(row: ParsedRow, mapping: Record<string, any>): Promise<any[] | null> {
    const childFile = mapping.source_file;
    const parentVal = row[mapping.link_column_parent];
    if (!parentVal) return null;

    const childRows = await this.ctx.parser.getData(childFile, {
      basePath: this.ctx.basePath,
      csvOptions: this.ctx.csvOptions,
    });

    const matchingChildren = childRows.filter(
      (c) => String(c[mapping.link_column_child]).trim() === String(parentVal).trim()
    );

    if (matchingChildren.length === 0) return null;

    // Array of simple values if _placeholder is provided
    if (mapping.mapping && '_placeholder' in mapping.mapping) {
      const results: any[] = [];
      for (const childRow of matchingChildren) {
        const itemVal = await this.resolvePlaceholder(mapping.mapping._placeholder, childRow);
        if (itemVal !== null && itemVal !== undefined) {
          results.push(itemVal);
        }
      }
      return results.length > 0 ? results : null;
    }

    // Array of objects
    const results: any[] = [];
    for (const childRow of matchingChildren) {
      const childPayload = await this.buildPayload(childRow, mapping.mapping);
      if (childPayload !== null) {
        results.push(childPayload);
      }
    }

    return results.length > 0 ? results : null;
  }
}
