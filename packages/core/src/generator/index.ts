// packages/core/src/generator/index.ts

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import ExcelJS from 'exceljs';
import { ApiSeederConfig, IntegrationStep } from '../types/index.js';

export interface GeneratedTemplate {
  stepName: string;
  filePath: string;
  columns: string[];
}

export class TemplateGenerator {
  /**
   * Generates blank, styled Excel template files for all steps defined in config.
   */
  public static async generateTemplates(
    config: ApiSeederConfig,
    options: string | { outputDir?: string; overwrite?: boolean } = {}
  ): Promise<GeneratedTemplate[]> {
    const opts = typeof options === 'string' ? { outputDir: options } : options;
    const outputDir = opts.outputDir || './templates';
    const resolvedOutputDir = path.resolve(outputDir);
    await fs.mkdir(resolvedOutputDir, { recursive: true });

    const generated: GeneratedTemplate[] = [];

    for (const step of config.integration_steps) {
      if (step.enabled === false) continue;

      const columns = this.extractColumnsFromStep(step);
      const filename = path.basename(step.source_file, path.extname(step.source_file)) + '.xlsx';
      const targetFilePath = path.join(resolvedOutputDir, filename);

      if (!opts.overwrite) {
        try {
          await fs.access(targetFilePath);
          // File already exists, skip
          continue;
        } catch {
          // File does not exist, proceed
        }
      }

      await this.createStyledExcelFile(targetFilePath, step.name, columns);

      generated.push({
        stepName: step.name,
        filePath: targetFilePath,
        columns,
      });
    }

    return generated;
  }

  /**
   * Extracts required source columns from an integration step.
   */
  public static extractColumnsFromStep(step: IntegrationStep): string[] {
    const columns = new Set<string>();

    // Columns from Lookup params
    if (step.lookup?.params) {
      for (const val of Object.values(step.lookup.params)) {
        if (typeof val === 'string' && !val.startsWith('@') && !val.startsWith('$')) {
          columns.add(val);
        }
      }
    }

    // Columns from unique identifier
    if (step.unique_identifier) {
      columns.add(step.unique_identifier);
    }

    // Columns from payload mapping
    if (step.payload_mapping) {
      this.extractColumnsFromMapping(step.payload_mapping, columns);
    }

    return Array.from(columns);
  }

  private static extractColumnsFromMapping(mapping: Record<string, any>, columns: Set<string>): void {
    for (const [key, val] of Object.entries(mapping)) {
      if (key.includes('@options')) continue;

      if (typeof val === 'string') {
        const trimmed = val.trim();

        // 1. @file(path) descriptor
        const fileMatch = trimmed.match(/^@file\(([^)]+)\)$/);
        if (fileMatch) {
          const inner = fileMatch[1];
          const mustacheMatches = inner.matchAll(/\{\{\s*(.*?)\s*\}\}/g);
          let foundVar = false;
          for (const m of mustacheMatches) {
            foundVar = true;
            const col = m[1].split('|')[0].split('||')[0].trim();
            if (col) columns.add(col);
          }
          if (!foundVar && !inner.includes('/') && !inner.includes('\\')) {
            columns.add(inner.trim());
          }
          continue;
        }

        // 2. Relation @step(Col) or legacy ${step.id:Col}
        const relationMatch =
          trimmed.match(/^@([A-Za-z0-9_]+)\(([^)]+)\)$/) ||
          trimmed.match(/^\$\{[^:]+\.id:([^}]+)\}$/);

        if (relationMatch) {
          columns.add(relationMatch[2].trim());
          continue;
        }

        // 3. Mustache & Pipe expressions (embedded or full)
        if (trimmed.includes('{{') && trimmed.includes('}}')) {
          const mustacheMatches = trimmed.matchAll(/\{\{\s*(.*?)\s*\}\}/g);
          for (const m of mustacheMatches) {
            const rawContent = m[1].trim();
            const firstPart = rawContent.split('|')[0].trim();
            const colName = firstPart.split('||')[0].trim();
            if (colName) columns.add(colName);
          }
          continue;
        }

        // 4. Static column name candidate
        // Skip paths, URLs, expressions, or strings with spaces
        if (
          !trimmed.startsWith('$') &&
          !trimmed.startsWith('@') &&
          !trimmed.includes('/') &&
          !trimmed.includes('\\') &&
          !trimmed.includes(':') &&
          !trimmed.includes(' ')
        ) {
          columns.add(trimmed);
        }
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        this.extractColumnsFromMapping(val, columns);
      }
    }
  }

  private static async createStyledExcelFile(filePath: string, sheetTitle: string, columns: string[]): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetTitle.slice(0, 31));

    worksheet.columns = columns.map((col) => ({
      header: col,
      key: col,
      width: Math.max(col.length + 6, 16),
    }));

    // Style the header row with clean Obsidian/Teal style
    const headerRow = worksheet.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0F172A' },
      };
      cell.font = {
        name: 'Segoe UI',
        size: 11,
        bold: true,
        color: { argb: 'FF00E5FF' },
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: 'left',
        indent: 1,
      };
      cell.border = {
        bottom: { style: 'medium', color: { argb: 'FF00B0FF' } },
      };
    });

    await workbook.xlsx.writeFile(filePath);
  }
}
