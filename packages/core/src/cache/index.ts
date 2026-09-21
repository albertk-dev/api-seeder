// packages/core/src/cache/index.ts

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class IdCacheManager {
  private cache: Record<string, Record<string, string>> = {};
  private cacheFilePath: string | null = null;
  private autoSave: boolean = true;

  constructor(cacheFilePath?: string, autoSave: boolean = true) {
    this.cacheFilePath = cacheFilePath ? path.resolve(cacheFilePath) : null;
    this.autoSave = autoSave;
  }

  /**
   * Initializes the cache for a given step name if not already created.
   */
  public initStep(stepName: string): void {
    if (!this.cache[stepName]) {
      this.cache[stepName] = {};
    }
  }

  /**
   * Gets an ID from the cache for a given step and key.
   */
  public get(stepName: string, key: string | number): string | undefined {
    const stringKey = String(key).trim();
    return this.cache[stepName]?.[stringKey];
  }

  /**
   * Stores an ID in the cache and triggers an auto-save if configured.
   */
  public async set(stepName: string, key: string | number, id: string | number): Promise<void> {
    this.initStep(stepName);
    const stringKey = String(key).trim();
    const stringId = String(id).trim();
    this.cache[stepName][stringKey] = stringId;

    if (this.autoSave && this.cacheFilePath) {
      await this.save();
    }
  }

  /**
   * Checks if an ID exists in cache.
   */
  public has(stepName: string, key: string | number): boolean {
    const stringKey = String(key).trim();
    return Boolean(this.cache[stepName]?.[stringKey]);
  }

  /**
   * Loads the cache from disk if the file exists.
   */
  public async load(): Promise<void> {
    if (!this.cacheFilePath) return;

    try {
      const data = await fs.readFile(this.cacheFilePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (typeof parsed === 'object' && parsed !== null) {
        this.cache = parsed;
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.warn(`[API-Seeder Cache] Warning: Failed to read cache file at ${this.cacheFilePath}:`, error.message);
      }
      this.cache = {};
    }
  }

  /**
   * Saves the current cache to disk.
   */
  public async save(): Promise<void> {
    if (!this.cacheFilePath) return;

    try {
      await fs.mkdir(path.dirname(this.cacheFilePath), { recursive: true });
      await fs.writeFile(this.cacheFilePath, JSON.stringify(this.cache, null, 2), 'utf-8');
    } catch (error: any) {
      console.warn(`[API-Seeder Cache] Warning: Failed to write cache file at ${this.cacheFilePath}:`, error.message);
    }
  }

  /**
   * Clears the entire cache or just a specific step.
   */
  public clear(stepName?: string): void {
    if (stepName) {
      delete this.cache[stepName];
    } else {
      this.cache = {};
    }
  }

  /**
   * Returns a snapshot of the raw cache object.
   */
  public toObject(): Record<string, Record<string, string>> {
    return JSON.parse(JSON.stringify(this.cache));
  }
}
