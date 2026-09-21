// packages/core/src/reporter/index.ts

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import ExcelJS from 'exceljs';
import { ExecutionErrorRecord } from '../types/index.js';

export class ErrorReporter {
  /**
   * Generates a styled Excel workbook listing all failed records with their source row and server error.
   */
  public static async generateExcelReport(
    errors: ExecutionErrorRecord[],
    outputPath: string
  ): Promise<string> {
    const resolvedPath = path.resolve(outputPath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'API Seeder';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Errors Audit', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    // Define columns
    worksheet.columns = [
      { header: 'Step Name', key: 'stepName', width: 22 },
      { header: 'Source File', key: 'sourceFile', width: 25 },
      { header: 'Excel Row #', key: 'sourceRowNumber', width: 14 },
      { header: 'Identifier', key: 'entityIdentifier', width: 20 },
      { header: 'HTTP Status', key: 'httpStatus', width: 14 },
      { header: 'Error Summary', key: 'errorMessage', width: 35 },
      { header: 'Payload Sent', key: 'payload', width: 45 },
      { header: 'Server Response', key: 'apiResponse', width: 45 },
    ];

    // Style Header Row
    const headerRow = worksheet.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Segoe UI' };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' }, // Slate 800
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      };
    });

    // Add Error Rows
    errors.forEach((err, idx) => {
      const row = worksheet.addRow({
        stepName: err.stepName,
        sourceFile: path.basename(err.sourceFile),
        sourceRowNumber: err.sourceRowNumber,
        entityIdentifier: err.entityIdentifier || 'N/A',
        httpStatus: err.httpStatus || 'N/A',
        errorMessage: err.errorMessage,
        payload: JSON.stringify(err.payload, null, 2),
        apiResponse: typeof err.apiResponse === 'object' ? JSON.stringify(err.apiResponse, null, 2) : String(err.apiResponse || ''),
      });

      row.height = 24;

      // Soft light red background for error readability
      const bgArgb = idx % 2 === 0 ? 'FFFFF1F2' : 'FFFFFFFF'; // Rose 50 or white
      row.eachCell((cell) => {
        cell.font = { size: 10, name: 'Segoe UI' };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgArgb },
        };
        cell.alignment = { vertical: 'middle', wrapText: false };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      });

      // Highlight HTTP status
      const statusCell = row.getCell('httpStatus');
      statusCell.font = { bold: true, color: { argb: 'FFBE123C' } }; // Rose 700
      statusCell.alignment = { horizontal: 'center', vertical: 'middle' };

      // Highlight Row #
      const rowNumCell = row.getCell('sourceRowNumber');
      rowNumCell.font = { bold: true };
      rowNumCell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    await workbook.xlsx.writeFile(resolvedPath);
    return resolvedPath;
  }
}
