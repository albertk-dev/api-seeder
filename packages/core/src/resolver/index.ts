import * as path from 'node:path';
import { IdCacheManager } from '../cache/index.js';
import { ApiClient } from '../http/index.js';
import { FileParser, ParsedRow } from '../parser/index.js';
import { builtInTransformers, applyTransformers } from '../transformers/index.js';
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
      resolved[key] = await this.resolveValue(mappingVal, row);
    }

    return resolved;
  }

  /**
   * Evaluates a value mapping against the current row.
   */
  public async resolveValue(valueMapping: any, row: ParsedRow): Promise<any> {
    if (valueMapping === undefined || valueMapping === null) {
      return null;
    }

    // Primitives
    if (typeof valueMapping === 'number' || typeof valueMapping === 'boolean') {
      return valueMapping;
    }

    // Arrays
    if (Array.isArray(valueMapping)) {
      const items: any[] = [];
      for (const item of valueMapping) {
        items.push(await this.resolveValue(item, row));
      }
      return items;
    }

    // Nested Objects
    if (typeof valueMapping === 'object') {
      const obj: Record<string, any> = {};
      for (const [k, v] of Object.entries(valueMapping)) {
        obj[k] = await this.resolveValue(v, row);
      }
      return obj;
    }

    // Strings (Expressions, Relations, Columns, Statics)
    if (typeof valueMapping === 'string') {
      return this.resolveStringExpression(valueMapping, row);
    }

    return valueMapping;
  }

  /**
   * Evaluates a string expression against row data.
   */
  public async resolveStringExpression(expr: string, row: ParsedRow): Promise<any> {
    const trimmed = expr.trim();

    // 1. Shorthand Local File descriptor: @file(filePathOrMustache)
    const fileMatch = trimmed.match(/^@file\((.*)\)$/);
    if (fileMatch) {
      let rawPath = fileMatch[1].trim();
      if (rawPath.includes('{{')) {
        rawPath = rawPath.replace(/\{\{\s*(.*?)\s*\}\}/g, (_, innerExpr) => {
          const evaluated = this.evaluatePipeExpression(innerExpr, row);
          return evaluated !== undefined && evaluated !== null ? String(evaluated) : '';
        });
      } else if (rawPath in row) {
        const cell = row[rawPath];
        rawPath = cell !== undefined && cell !== null ? String(cell) : '';
      }

      const cleanPath = rawPath.replace(/^['"]|['"]$/g, '').trim();
      const basePath = this.ctx.basePath || process.cwd();
      const resolvedPath = path.isAbsolute(cleanPath)
        ? cleanPath
        : path.resolve(basePath, cleanPath);

      return {
        __type: 'file',
        filePath: resolvedPath,
        fileName: path.basename(resolvedPath),
      };
    }

    // 2. Shorthand DAG Relation: @step_name(UniqueKeyColumn) or legacy ${step.id:col}
    const relationMatch =
      trimmed.match(/^@([A-Za-z0-9_]+)\(([^)]+)\)$/) ||
      trimmed.match(/^\$\{([^:]+)\.id:([^}]+)\}$/);

    if (relationMatch) {
      const [, stepName, lookupCol] = relationMatch;

      const keyVal = row[lookupCol.trim()];

      if (keyVal === undefined || keyVal === null || String(keyVal).trim() === '') {
        throw new Error(
          `Missing relation key value in column '${lookupCol}' on row ${row.__rowNumber || '?'}`
        );
      }

      const cachedId = this.ctx.cache.get(stepName, String(keyVal));
      if (cachedId === undefined) {
        throw new Error(
          `Unresolved relation: No cached ID found for step '${stepName}' with key '${keyVal}' (row ${row.__rowNumber || '?'})`
        );
      }

      return cachedId;
    }

    // 2. Mustache & Transformer Pipe Expression: {{ Expression }}
    if (trimmed.includes('{{') && trimmed.includes('}}')) {
      const fullMustache = trimmed.match(/^\{\{\s*(.*?)\s*\}\}$/);
      if (fullMustache) {
        return this.evaluatePipeExpression(fullMustache[1], row);
      }
      return trimmed.replace(/\{\{\s*(.*?)\s*\}\}/g, (_, innerExpr) => {
        const val = this.evaluatePipeExpression(innerExpr, row);
        return val !== undefined && val !== null ? String(val) : '';
      });
    }

    // 3. Direct Column Match: if string exactly matches an Excel column name
    if (trimmed in row) {
      const cell = row[trimmed];
      return cell !== undefined && cell !== null && String(cell).trim() !== '' ? cell : null;
    }

    // 4. Static String
    return expr;
  }

  /**
   * Evaluates pipe expressions inside {{ ... }}:
   * Examples:
   *   "Nom | uppercase | trim"
   *   "Capacite || 30"
   *   "Date | date:'YYYY-MM-DD'"
   *   "Tags | split:','"
   */
  private evaluatePipeExpression(rawExpr: string, row: ParsedRow): any {
    let fallbackValue: string | null = null;
    let exprToParse = rawExpr;

    // Handle "Column || 'fallback'" before splitting on single pipe
    if (rawExpr.includes('||')) {
      const orIndex = rawExpr.indexOf('||');
      fallbackValue = rawExpr.slice(orIndex + 2).trim().replace(/^['"]|['"]$/g, '');
      exprToParse = rawExpr.slice(0, orIndex).trim();
    }

    const parts = exprToParse.split('|').map((p) => p.trim());
    const sourceCol = parts[0];

    // Extract initial value from row
    let val = row[sourceCol];
    if ((val === undefined || val === null || String(val).trim() === '') && fallbackValue !== null) {
      val = fallbackValue;
    }

    // Parse subsequent pipe transformers
    const pipeline: Array<{ name: string; args: string[] }> = [];
    for (let i = 1; i < parts.length; i++) {
      const pipeStr = parts[i];
      if (!pipeStr) continue;

      const colonIndex = pipeStr.indexOf(':');
      if (colonIndex === -1) {
        const name = pipeStr.trim().toLowerCase();
        let args: string[] = [];
        if ((name === 'file_base64' || name === 'file_exists') && this.ctx.basePath) {
          args = [this.ctx.basePath];
        }
        pipeline.push({ name, args });
      } else {
        const name = pipeStr.slice(0, colonIndex).trim().toLowerCase();
        let rawArgs = pipeStr.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        if ((name === 'file_base64' || name === 'file_exists') && this.ctx.basePath && !path.isAbsolute(rawArgs)) {
          rawArgs = path.resolve(this.ctx.basePath, rawArgs);
        }
        pipeline.push({ name, args: [rawArgs] });
      }
    }

    return applyTransformers(val, pipeline);
  }

  /**
   * Builds the API payload for a row.
   * If mapping is omitted, auto-maps all row columns directly.
   */
  public async buildPayload(
    row: ParsedRow,
    mapping?: Record<string, any>
  ): Promise<Record<string, any>> {
    // Zero-Config Auto-Mapping Mode
    if (!mapping || Object.keys(mapping).length === 0) {
      const autoPayload: Record<string, any> = {};
      for (const [key, val] of Object.entries(row)) {
        if (!key.startsWith('__')) {
          autoPayload[key] = val !== undefined && val !== null && String(val).trim() !== '' ? val : null;
        }
      }
      return autoPayload;
    }

    const payload: Record<string, any> = {};
    for (const [key, valMapping] of Object.entries(mapping)) {
      payload[key] = await this.resolveValue(valMapping, row);
    }
    return payload;
  }
}
