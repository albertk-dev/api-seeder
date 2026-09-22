import * as fs from 'node:fs';
import * as path from 'node:path';

export type TransformerFn = (val: any, ...args: string[]) => any;

/**
 * Returns basic MIME type from file extension.
 */
export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.pdf':
      return 'application/pdf';
    case '.json':
      return 'application/json';
    case '.csv':
      return 'text/csv';
    case '.txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Parses Excel serial date number to JavaScript Date.
 */
function excelSerialToDate(serial: number): Date {
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  const fractionalDay = serial - Math.floor(serial) + 0.0000001;
  let totalSeconds = Math.floor(86400 * fractionalDay);
  const seconds = totalSeconds % 60;
  totalSeconds = Math.floor(totalSeconds / 60);
  const minutes = totalSeconds % 60;
  const hours = Math.floor(totalSeconds / 60);

  return new Date(
    dateInfo.getFullYear(),
    dateInfo.getMonth(),
    dateInfo.getDate(),
    hours,
    minutes,
    seconds
  );
}

/**
 * Formats a Date object to the requested pattern (e.g., YYYY-MM-DD, DD/MM/YYYY).
 */
function formatDate(d: Date, format: string = 'YYYY-MM-DD'): string {
  if (isNaN(d.getTime())) return '';

  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

export const builtInTransformers: Record<string, TransformerFn> = {
  trim(val: any): string {
    if (val === undefined || val === null) return '';
    return String(val).trim();
  },

  uppercase(val: any): string {
    if (val === undefined || val === null) return '';
    return String(val).toUpperCase();
  },

  upper(val: any): string {
    return builtInTransformers.uppercase(val);
  },

  lowercase(val: any): string {
    if (val === undefined || val === null) return '';
    return String(val).toLowerCase();
  },

  lower(val: any): string {
    return builtInTransformers.lowercase(val);
  },

  number(val: any): number | null {
    if (val === undefined || val === null || val === '') return null;
    if (typeof val === 'number') return val;

    // Clean formatting (e.g., "1 500,50" -> "1500.50")
    const cleaned = String(val).replace(/\s+/g, '').replace(',', '.');
    const num = Number(cleaned);
    return isNaN(num) ? null : num;
  },

  boolean(val: any): boolean {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    const str = String(val).toLowerCase().trim();
    return ['true', '1', 'yes', 'oui', 'y', 'vrai'].includes(str);
  },

  default(val: any, fallback: string = ''): any {
    if (val === undefined || val === null || String(val).trim() === '') {
      // Clean quotes from fallback if provided as 'def' or "def"
      if (
        (fallback.startsWith("'") && fallback.endsWith("'")) ||
        (fallback.startsWith('"') && fallback.endsWith('"'))
      ) {
        return fallback.slice(1, -1);
      }
      return fallback;
    }
    return val;
  },

  date(val: any, format: string = 'YYYY-MM-DD'): string {
    if (val === undefined || val === null || val === '') return '';

    // Strip quotes around format if present
    const cleanFormat = format.replace(/^['"]|['"]$/g, '');

    // Excel serial number
    if (typeof val === 'number') {
      return formatDate(excelSerialToDate(val), cleanFormat);
    }

    // Number as string
    if (!isNaN(Number(val)) && String(val).trim().length >= 4 && !String(val).includes('-') && !String(val).includes('/')) {
      const num = Number(val);
      if (num > 20000 && num < 60000) {
        return formatDate(excelSerialToDate(num), cleanFormat);
      }
    }

    const d = new Date(val);
    return formatDate(d, cleanFormat);
  },

  split(val: any, delimiter: string = ','): string[] {
    if (val === undefined || val === null || val === '') return [];
    const cleanDelim = delimiter.replace(/^['"]|['"]$/g, '');
    return String(val)
      .split(cleanDelim)
      .map((s) => s.trim())
      .filter(Boolean);
  },

  json(val: any): any {
    if (val === undefined || val === null || val === '') return null;
    try {
      return JSON.parse(String(val));
    } catch {
      return val;
    }
  },

  slug(val: any): string {
    if (val === undefined || val === null) return '';
    return String(val)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  },

  file_base64(val: any, baseDir?: string, asDataUri: string = 'true'): string {
    if (val === undefined || val === null || String(val).trim() === '') return '';
    const cleanFile = String(val).trim();
    const cleanDir = baseDir ? baseDir.replace(/^['"]|['"]$/g, '') : '';
    const targetPath = cleanDir
      ? path.resolve(process.cwd(), cleanDir, cleanFile)
      : path.resolve(process.cwd(), cleanFile);

    if (!fs.existsSync(targetPath)) {
      throw new Error(`File not found for file_base64: "${targetPath}"`);
    }

    const buffer = fs.readFileSync(targetPath);
    const base64Str = buffer.toString('base64');
    const includeDataUri = asDataUri !== 'false';
    if (includeDataUri) {
      const mime = getMimeType(targetPath);
      return `data:${mime};base64,${base64Str}`;
    }
    return base64Str;
  },

  file_exists(val: any, baseDir?: string): boolean {
    if (val === undefined || val === null || String(val).trim() === '') return false;
    const cleanFile = String(val).trim();
    const cleanDir = baseDir ? baseDir.replace(/^['"]|['"]$/g, '') : '';
    const targetPath = cleanDir
      ? path.resolve(process.cwd(), cleanDir, cleanFile)
      : path.resolve(process.cwd(), cleanFile);
    return fs.existsSync(targetPath);
  },
};

/**
 * Applies a list of transformer names with arguments to an initial value.
 */
export function applyTransformers(
  initialValue: any,
  pipeline: Array<{ name: string; args: string[] }>
): any {
  let result = initialValue;

  for (const { name, args } of pipeline) {
    const fn = builtInTransformers[name.toLowerCase()];
    if (fn) {
      result = fn(result, ...args);
    }
  }

  return result;
}
