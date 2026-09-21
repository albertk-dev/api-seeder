// packages/core/src/generator/index.ts

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import ExcelJS from 'exceljs';
import { ApiSeederConfig, IntegrationStep } from '../types/index.js';

export interface GeneratedTemplateInfo {
  stepName: string;
  filePath: string;
  columns: string[];
}

export class TemplateGenerator {
  /**
   * Generates all Excel templates inferred from the integration steps.
   */
  public static async generateTemplates(
    config: ApiSeederConfig,
    outputDir: string = './templates_excel',
    basePath?: string
  ): Promise<GeneratedTemplateInfo[]> {
    const resolvedOutputDir = basePath ? path.resolve(basePath, outputDir) : path.resolve(outputDir);
    await fs.mkdir(resolvedOutputDir, { recursive: true });

    const generated: GeneratedTemplateInfo[] = [];

    for (const step of config.integration_steps) {
      if (!step.enabled && step.enabled !== undefined) continue;

      const columns = this.extractColumnsFromStep(step);
      if (columns.length === 0) continue;

      // Extract filename from source_file
      const originalBasename = path.basename(step.source_file, path.extname(step.source_file));
      const targetFileName = `${originalBasename}.xlsx`;
      const targetFilePath = path.join(resolvedOutputDir, targetFileName);

      await this.createStyledExcelFile(targetFilePath, step.name, columns);

      generated.push({
        stepName: step.name,
        filePath: targetFilePath,
        columns,
      });

      // Handle child array files if present in mapping
      const childFiles = this.extractChildFilesFromMapping(step.payload_mapping);
      for (const child of childFiles) {
        const childBasename = path.basename(child.sourceFile, path.extname(child.sourceFile));
        const childFilePath = path.join(resolvedOutputDir, `${childBasename}.xlsx`);
        await this.createStyledExcelFile(childFilePath, `${step.name}_children`, child.columns);
        generated.push({
          stepName: `${step.name}_child`,
          filePath: childFilePath,
          columns: child.columns,
        });
      }
    }

    return generated;
  }

  /**
   * Extracts required source columns from an integration step.
   */
  public static extractColumnsFromStep(step: IntegrationStep): string[] {
    const columns = new Set<string>();

    // Columns from ID lookup query params
    if (step.id_lookup_config?.lookup_query_params) {
      for (const val of Object.values(step.id_lookup_config.lookup_query_params)) {
        if (typeof val === 'string' && !val.startsWith('$') && !val.startsWith('#')) {
          columns.add(val);
        }
      }
    }

    // Columns from unique identifier
    if (step.unique_identifier) {
      columns.add(step.unique_identifier);
    }

    // Columns from payload mapping
    this.extractColumnsFromMapping(step.payload_mapping, columns);

    return Array.from(columns);
  }

  private static extractColumnsFromMapping(mapping: Record<string, any>, columns: Set<string>): void {
    for (const [key, val] of Object.entries(mapping)) {
      if (key.includes('@options')) continue;

      if (typeof val === 'string') {
        const trimmed = val.trim();
        const mustacheMatch = trimmed.match(/^\{\{\s*([^}]+)\s*\}\}$/);
        if (mustacheMatch) {
          columns.add(mustacheMatch[1].trim());
        } else if (trimmed.startsWith('${')) {
          // Cache placeholder: ${step.id:column_name}
          const match = trimmed.match(/^\$\{[^:]+\.id:([^}]+)\}$/);
          if (match) columns.add(match[1]);
        } else if (!trimmed.startsWith('#{') && !trimmed.startsWith('$ref:')) {
          columns.add(trimmed);
        }
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        if ('split_by' in val && 'source_column' in val) {
          columns.add(val.source_column);
        } else if (!('source_file' in val)) {
          this.extractColumnsFromMapping(val, columns);
        }
      }
    }
  }

  private static extractChildFilesFromMapping(mapping: Record<string, any>): Array<{ sourceFile: string; columns: string[] }> {
    const result: Array<{ sourceFile: string; columns: string[] }> = [];

    for (const [key, val] of Object.entries(mapping)) {
      if (val && typeof val === 'object' && 'source_file' in val) {
        const childCols = new Set<string>();
        if (val.link_column_child) childCols.add(val.link_column_child);
        if (val.mapping) this.extractColumnsFromMapping(val.mapping, childCols);
        result.push({
          sourceFile: val.source_file,
          columns: Array.from(childCols),
        });
      }
    }

    return result;
  }

  private static async createStyledExcelFile(filePath: string, sheetTitle: string, columns: string[]): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetTitle.slice(0, 31));

    worksheet.columns = columns.map((col) => ({
      header: col,
      key: col,
      width: Math.max(col.length + 8, 18),
    }));

    // Header styling
    const headerRow = worksheet.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Segoe UI' };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2563EB' }, // Blue 600
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        bottom: { style: 'medium', color: { argb: 'FF1D4ED8' } },
      };
    });

    await workbook.xlsx.writeFile(filePath);
  }
}
