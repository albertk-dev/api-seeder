// packages/core/src/env/index.ts

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Loads a .env file from the specified directory if it exists.
 */
export function loadEnvFile(directory: string = process.cwd()): void {
  const envPath = path.resolve(directory, '.env');
  if (!fs.existsSync(envPath)) return;

  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const equalIndex = trimmed.indexOf('=');
      if (equalIndex === -1) continue;

      const key = trimmed.slice(0, equalIndex).trim();
      let value = trimmed.slice(equalIndex + 1).trim();

      // Remove surrounding quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      // Do not overwrite existing process.env values
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore error if .env cannot be read
  }
}

/**
 * Replaces ${env:VARIABLE_NAME} or ${env:VARIABLE_NAME:-default} in a string.
 */
export function interpolateEnvString(str: string): string {
  return str.replace(/\$\{env:([A-Za-z0-9_]+)(?::-([^}]*))?\}/g, (_, varName, defaultValue) => {
    const envVal = process.env[varName];
    if (envVal !== undefined && envVal !== '') {
      return envVal;
    }
    return defaultValue !== undefined ? defaultValue : '';
  });
}

/**
 * Recursively resolves environment variables across all strings in an object.
 */
export function resolveEnvVariables<T>(data: T): T {
  if (typeof data === 'string') {
    return interpolateEnvString(data) as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map((item) => resolveEnvVariables(item)) as unknown as T;
  }

  if (data !== null && typeof data === 'object') {
    const resolved: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      resolved[key] = resolveEnvVariables(value);
    }
    return resolved as T;
  }

  return data;
}
