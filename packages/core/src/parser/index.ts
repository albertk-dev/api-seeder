// packages/core/src/parser/index.ts

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { CsvOptions } from '../types/index.js';

export interface ParsedRow extends Record<string, any> {
  __rowNumber: number; // 1-indexed Excel/CSV row number (header = 1, first data = 2)
}

export class FileParser {
  private cache: Map<string, ParsedRow[]> = new Map();

  /**
   * Reads an Excel (.xlsx) or CSV (.csv) file into an array of row objects.
   * Caches the result in-memory by absolute file path.
   */
  public async getData(
    filePath: string,
    options?: { csvOptions?: CsvOptions; bypassCache?: boolean; basePath?: string }
  ): Promise<ParsedRow[]> {
    const resolvedPath = options?.basePath
      ? path.resolve(options.basePath, filePath)
      : path.resolve(filePath);

    if (!options?.bypassCache && this.cache.has(resolvedPath)) {
      return this.cache.get(resolvedPath)!;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    let rows: ParsedRow[] = [];

    if (ext === '.xlsx') {
      rows = await this.readExcel(resolvedPath);
    } else if (ext === '.csv') {
      rows = await this.readCsv(resolvedPath, options?.csvOptions);
    } else {
      throw new Error(`Unsupported file extension '${ext}' for file '${resolvedPath}'. Supported: .xlsx, .csv`);
    }

    this.cache.set(resolvedPath, rows);
    return rows;
  }

  /**
   * Reads an Excel .xlsx file.
   */
  private async readExcel(filePath: string): Promise<ParsedRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount === 0) {
      return [];
    }

    const rows: ParsedRow[] = [];
    const headers: string[] = [];

    // Header row (Row 1)
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const headerVal = cell.value ? String(cell.value).trim() : '';
      headers[colNumber] = headerVal;
    });

    // Data rows (Row 2+)
    for (let r = 2; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      const rowData: ParsedRow = { __rowNumber: r };
      let hasData = false;

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const header = headers[colNumber];
        if (!header) return;

        let val: any = cell.value;

        // Handle cell formulas / rich text / objects
        if (val && typeof val === 'object') {
          if ('result' in val) {
            val = val.result;
          } else if ('richText' in val) {
            val = val.richText.map((t: any) => t.text).join('');
          } else if ('text' in val) {
            val = val.text;
          }
        }

        if (val instanceof Date) {
          val = val.toISOString();
        }

        const stringified = val !== null && val !== undefined ? String(val).trim() : '';
        if (stringified !== '') {
          hasData = true;
        }

        rowData[header] = stringified;
      });

      // Avoid collecting entirely empty blank rows at bottom of sheet
      if (hasData) {
        rows.push(rowData);
      }
    }

    return rows;
  }

  /**
   * Reads a CSV file using PapaParse.
   */
  private async readCsv(filePath: string, csvOptions?: CsvOptions): Promise<ParsedRow[]> {
    const content = await fs.readFile(filePath, (csvOptions?.encoding as BufferEncoding) || 'utf-8');
    const delimiter = csvOptions?.separator || csvOptions?.delimiter || ',';

    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, any>>(content, {
        header: true,
        skipEmptyLines: 'greedy',
        delimiter: delimiter,
        complete: (results) => {
          const parsedRows: ParsedRow[] = results.data.map((row, index) => {
            const cleaned: ParsedRow = { __rowNumber: index + 2 };
            for (const [key, val] of Object.entries(row)) {
              cleaned[key.trim()] = val !== null && val !== undefined ? String(val).trim() : '';
            }
            return cleaned;
          });
          resolve(parsedRows);
        },
        error: (error: Error) => {
          reject(new Error(`Failed to parse CSV '${filePath}': ${error.message}`));
        },
      });
    });
  }

  /**
   * Inspects the headers of a file without parsing the full dataset.
   */
  public async getHeaders(filePath: string, options?: { csvOptions?: CsvOptions; basePath?: string }): Promise<string[]> {
    const rows = await this.getData(filePath, { ...options, bypassCache: false });
    if (rows.length === 0) return [];
    return Object.keys(rows[0]).filter((k) => k !== '__rowNumber');
  }

  /**
   * Clears the in-memory file cache.
   */
  public clearCache(): void {
    this.cache.clear();
  }
}
