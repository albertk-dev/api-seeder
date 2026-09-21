import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  validateConfig,
  safeValidateConfig,
  generateJsonSchema,
  IdCacheManager,
  FileParser,
  PayloadResolver,
  TemplateGenerator,
  SeederEngine,
  ApiClient,
} from '../src/index.js';

describe('@api-seeder/core', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-seeder-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Schema Validation', () => {
    it('should validate a correct configuration structure', () => {
      const validConfig = {
        api_base_url: 'https://api.example.com/v1',
        integration_steps: [
          {
            name: 'schools',
            source_file: 'data/schools.csv',
            endpoint: '/schools',
            payload_mapping: {
              name: '{{SchoolName}}',
              city: 'City',
            },
          },
        ],
      };

      const result = safeValidateConfig(validConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.api_base_url).toBe('https://api.example.com/v1');
        expect(result.data.integration_steps).toHaveLength(1);
      }
    });

    it('should reject invalid configuration with missing required fields', () => {
      const invalidConfig = {
        api_base_url: 'not-a-valid-url',
        integration_steps: [],
      };

      const result = safeValidateConfig(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should generate standard JSON schema for IDE autocompletion', () => {
      const schema = generateJsonSchema();
      expect(schema).toBeDefined();
      expect(schema.$schema).toBeDefined();
    });
  });

  describe('IdCacheManager', () => {
    it('should set and get IDs in-memory and persist to disk', async () => {
      const cachePath = path.join(tempDir, '.id_cache.json');
      const cache = new IdCacheManager(cachePath, true);

      await cache.set('schools', 'SCH_001', 'id_999');
      expect(cache.get('schools', 'SCH_001')).toBe('id_999');
      expect(cache.has('schools', 'SCH_001')).toBe(true);
      expect(cache.has('schools', 'SCH_999')).toBe(false);

      // Verify file was written
      const fileContent = await fs.readFile(cachePath, 'utf-8');
      expect(JSON.parse(fileContent)).toEqual({
        schools: {
          SCH_001: 'id_999',
        },
      });

      // Reload into new instance
      const cache2 = new IdCacheManager(cachePath, false);
      await cache2.load();
      expect(cache2.get('schools', 'SCH_001')).toBe('id_999');
    });
  });

  describe('FileParser & PayloadResolver', () => {
    it('should parse CSV and resolve placeholders and column mappings', async () => {
      const csvPath = path.join(tempDir, 'data.csv');
      await fs.writeFile(
        csvPath,
        'Code,Nom,Tags\nE01,Lycée Leclerc,lycee;public\nE02,Collège Vogt,college;prive\n',
        'utf-8'
      );

      const parser = new FileParser();
      const rows = await parser.getData(csvPath);

      expect(rows).toHaveLength(2);
      expect(rows[0].Code).toBe('E01');
      expect(rows[0].Nom).toBe('Lycée Leclerc');
      expect(rows[0].__rowNumber).toBe(2);

      const cache = new IdCacheManager();
      await cache.set('etablissements', 'E01', 'db_uuid_100');

      const resolver = new PayloadResolver({
        cache,
        apiClient: new ApiClient({ baseUrl: 'https://api.example.com' }),
        parser,
        config: {
          api_base_url: 'https://api.example.com',
          integration_steps: [],
        },
        basePath: tempDir,
      });

      // Test payload build with mustache, static values, string split, and cache reference
      const payloadMapping = {
        name: '{{Nom}}',
        identifier: 'Code',
        staticRole: 'ACADEMIC',
        parent_id: '${etablissements.id:Code}',
        tags: {
          split_by: ';',
          source_column: 'Tags',
        },
      };

      const builtPayload = await resolver.buildPayload(rows[0], payloadMapping);
      expect(builtPayload).toEqual({
        name: 'Lycée Leclerc',
        identifier: 'E01',
        staticRole: 'ACADEMIC',
        parent_id: 'db_uuid_100',
        tags: ['lycee', 'public'],
      });
    });
  });

  describe('TemplateGenerator', () => {
    it('should extract columns and create styled Excel template files', async () => {
      const config = {
        api_base_url: 'https://api.example.com',
        integration_steps: [
          {
            name: 'classes',
            source_file: 'data/classes.xlsx',
            endpoint: '/classes',
            unique_identifier: 'CodeClasse',
            payload_mapping: {
              nom: '{{Nom}}',
              capacite: 'CapaciteMax',
              etablissement_id: '${creation_etablissements.id:CodeEtablissement}',
            },
          },
        ],
      };

      const outputDir = path.join(tempDir, 'templates');
      const generated = await TemplateGenerator.generateTemplates(config, outputDir);

      expect(generated).toHaveLength(1);
      expect(generated[0].columns).toContain('CodeClasse');
      expect(generated[0].columns).toContain('Nom');
      expect(generated[0].columns).toContain('CapaciteMax');
      expect(generated[0].columns).toContain('CodeEtablissement');

      const exists = await fs.stat(generated[0].filePath);
      expect(exists.isFile()).toBe(true);
    });
  });

  describe('SeederEngine (Dry Run)', () => {
    it('should simulate an entire seeding workflow without network errors', async () => {
      const csvPath = path.join(tempDir, 'schools.csv');
      await fs.writeFile(
        csvPath,
        'Code,Nom\nSCH01,School A\nSCH02,School B\n',
        'utf-8'
      );

      const config = {
        api_base_url: 'https://api.example.com',
        use_id_cache: true,
        id_cache_file: path.join(tempDir, '.id_cache.json'),
        integration_steps: [
          {
            name: 'creation_schools',
            source_file: csvPath,
            endpoint: '/schools',
            unique_identifier: 'Code',
            payload_mapping: {
              name: '{{Nom}}',
              code: 'Code',
            },
          },
        ],
      };

      const engine = new SeederEngine(config, {
        dryRun: true,
        workingDirectory: tempDir,
      });

      const result = await engine.run();
      expect(result.success).toBe(true);
      expect(result.totalSteps).toBe(1);
      expect(result.completedSteps).toBe(1);
      expect(result.totalCreated).toBe(2);
      expect(result.totalFailed).toBe(0);
    });
  });
});
