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
  resolveEnvVariables,
  builtInTransformers,
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
        expect(result.data.integration_steps[0].batch_size).toBe(1);
        expect(result.data.integration_steps[0].response_id_field).toBe('id');
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

  describe('Environment Variables (${env:VAR})', () => {
    it('should recursively interpolate environment variables with fallbacks', () => {
      process.env.TEST_API_URL = 'https://api.live.com/v1';
      process.env.TEST_SECRET_TOKEN = 'secret-xyz';

      const config = {
        api_base_url: '${env:TEST_API_URL}',
        global_headers: {
          Authorization: 'Bearer ${env:TEST_SECRET_TOKEN}',
          Tenant: '${env:MISSING_TENANT:-default_tenant}',
        },
      };

      const resolved = resolveEnvVariables(config);
      expect(resolved.api_base_url).toBe('https://api.live.com/v1');
      expect(resolved.global_headers.Authorization).toBe('Bearer secret-xyz');
      expect(resolved.global_headers.Tenant).toBe('default_tenant');
    });
  });

  describe('Data Transformers & Pipes', () => {
    it('should transform values using built-in pipes', () => {
      expect(builtInTransformers.trim('   hello world   ')).toBe('hello world');
      expect(builtInTransformers.uppercase('hello')).toBe('HELLO');
      expect(builtInTransformers.lowercase('HELLO')).toBe('hello');
      expect(builtInTransformers.number('  1 200,50  ')).toBe(1200.5);
      expect(builtInTransformers.boolean('oui')).toBe(true);
      expect(builtInTransformers.boolean('0')).toBe(false);
      expect(builtInTransformers.default('', 'fallback_value')).toBe('fallback_value');
      expect(builtInTransformers.split('A, B, C', ',')).toEqual(['A', 'B', 'C']);
      expect(builtInTransformers.date('2026-09-22T08:00:00Z', 'YYYY-MM-DD')).toBe('2026-09-22');
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

      const fileContent = await fs.readFile(cachePath, 'utf-8');
      expect(JSON.parse(fileContent)).toEqual({
        schools: {
          SCH_001: 'id_999',
        },
      });

      const cache2 = new IdCacheManager(cachePath, false);
      await cache2.load();
      expect(cache2.get('schools', 'SCH_001')).toBe('id_999');
    });
  });

  describe('FileParser & PayloadResolver', () => {
    it('should parse CSV and resolve modern pipes, relations, and auto-mapping', async () => {
      const csvPath = path.join(tempDir, 'data.csv');
      await fs.writeFile(
        csvPath,
        'Code,Nom,Tags,Capacite\nE01,  lycée leclerc  ,"lycee,public",\nE02,collège vogt,"college,prive",45\n',
        'utf-8'
      );

      const parser = new FileParser();
      const rows = await parser.getData(csvPath);

      expect(rows).toHaveLength(2);
      expect(rows[0].Code).toBe('E01');

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

      // Test modern v1.0 payload mapping: pipes, split, fallback, relation shorthand @etablissements(Code)
      const payloadMapping = {
        name: '{{ Nom | trim | uppercase }}',
        identifier: 'Code',
        parent_id: '@etablissements(Code)',
        tags: "{{ Tags | split:',' }}",
        capacite_max: '{{ Capacite || 30 }}',
      };

      const builtPayload = await resolver.buildPayload(rows[0], payloadMapping);
      expect(builtPayload).toEqual({
        name: 'LYCÉE LECLERC',
        identifier: 'E01',
        parent_id: 'db_uuid_100',
        tags: ['lycee', 'public'],
        capacite_max: '30',
      });

      // Test Zero-Config Auto-Mapping (no mapping passed)
      const autoPayload = await resolver.buildPayload(rows[1]);
      expect(autoPayload).toEqual({
        Code: 'E02',
        Nom: 'collège vogt',
        Tags: 'college,prive',
        Capacite: '45',
      });
    });
  });

  describe('TemplateGenerator', () => {
    it('should extract columns from modern syntax and generate Excel templates', async () => {
      const config = {
        api_base_url: 'https://api.example.com',
        integration_steps: [
          {
            name: 'classes',
            source_file: 'data/classes.xlsx',
            endpoint: '/classes',
            unique_identifier: 'CodeClasse',
            payload_mapping: {
              nom: '{{ Nom | trim }}',
              capacite: '{{ CapaciteMax || 30 }}',
              etablissement_id: '@creation_etablissements(CodeEtablissement)',
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

  describe('SeederEngine (Dry Run & Batching & Rollback)', () => {
    it('should simulate an entire seeding workflow and rollback cleanly', async () => {
      const csvPath = path.join(tempDir, 'schools.csv');
      await fs.writeFile(
        csvPath,
        'Code,Nom\nSCH01,School A\nSCH02,School B\nSCH03,School C\nSCH04,School D\n',
        'utf-8'
      );

      const cachePath = path.join(tempDir, '.id_cache.json');
      const config = {
        api_base_url: 'https://api.example.com',
        use_id_cache: true,
        id_cache_file: cachePath,
        integration_steps: [
          {
            name: 'schools_step',
            source_file: csvPath,
            endpoint: '/schools',
            unique_identifier: 'Code',
            batch_size: 2, // Test batch execution
            payload_mapping: {
              name: '{{ Nom | trim | uppercase }}',
              code: 'Code',
            },
          },
        ],
      };

      const engine = new SeederEngine(config, {
        dryRun: true,
        workingDirectory: tempDir,
      });

      // 1. Test Run with Batch Size 2
      const result = await engine.run();
      expect(result.success).toBe(true);
      expect(result.totalSteps).toBe(1);
      expect(result.completedSteps).toBe(1);
      expect(result.totalCreated).toBe(4);
      expect(result.totalFailed).toBe(0);

      // Verify Cache has 4 entries
      const cacheData = JSON.parse(await fs.readFile(cachePath, 'utf-8'));
      expect(Object.keys(cacheData.schools_step)).toHaveLength(4);
      expect(cacheData.schools_step.SCH01).toBe('sim_schools_step_batch_1');

      // 2. Test Rollback in Dry-Run
      const rollbackResult = await engine.rollback({ dryRun: true });
      expect(rollbackResult.success).toBe(true);
      expect(rollbackResult.totalDeleted).toBe(4);
      expect(rollbackResult.totalFailed).toBe(0);
    });

    it('should support soft-delete rollback (PATCH / PUT with custom payload) and disable toggle', async () => {
      const csvPath = path.join(tempDir, 'students.csv');
      await fs.writeFile(csvPath, 'Matricule,Nom\nELV01,Alice\n', 'utf-8');

      const cachePath = path.join(tempDir, '.id_cache_soft.json');
      const config = {
        api_base_url: 'https://api.example.com',
        use_id_cache: true,
        id_cache_file: cachePath,
        integration_steps: [
          {
            name: 'upload_step',
            source_file: csvPath,
            endpoint: 'https://storage.cloud.cm/v1/uploads',
            unique_identifier: 'Matricule',
            response_id_field: 'url',
            rollback: {
              enabled: false, // Don't delete uploaded files
            },
          },
          {
            name: 'students_step',
            source_file: csvPath,
            endpoint: '/students',
            unique_identifier: 'Matricule',
            payload_mapping: {
              matricule: 'Matricule',
              photo_url: '@upload_step(Matricule)',
            },
            rollback: {
              method: 'PATCH' as const,
              endpoint: '/students/:id',
              payload: {
                status: 'ARCHIVED',
              },
            },
          },
        ],
      };

      const loggedMessages: string[] = [];
      const engine = new SeederEngine(config, {
        dryRun: true,
        workingDirectory: tempDir,
        onProgress: (ev) => {
          if (ev.message) loggedMessages.push(ev.message);
        },
      });

      await engine.run();

      const rollbackRes = await engine.rollback({ dryRun: true });
      expect(rollbackRes.success).toBe(true);
      // upload_step had enabled: false, so only students_step was rolled back
      expect(rollbackRes.totalDeleted).toBe(1);

      // Verify that PATCH and payload were used in the dry-run message
      const patchMessage = loggedMessages.find((m) => m.includes('Would PATCH /students/'));
      expect(patchMessage).toBeDefined();
      expect(patchMessage).toContain('"status":"ARCHIVED"');
    });
  });

  describe('ApiClient & Enterprise Features', () => {
    it('should preserve absolute URLs for S3 / Cloud storage endpoints', () => {
      const client = new ApiClient({ baseUrl: 'https://api.example.com/v1' });

      // Relative endpoint -> prepends baseUrl
      expect(client.buildUrl('/students')).toBe('https://api.example.com/v1/students');
      expect(client.buildUrl('students')).toBe('https://api.example.com/v1/students');

      // Absolute endpoints (Cas C / S3) -> does not prepend baseUrl
      expect(client.buildUrl('https://storage.s3.amazonaws.com/bucket/upload')).toBe(
        'https://storage.s3.amazonaws.com/bucket/upload'
      );
      expect(client.buildUrl('http://my-storage-microservice:8080/upload')).toBe(
        'http://my-storage-microservice:8080/upload'
      );

      // Query params appended correctly to absolute URLs
      expect(client.buildUrl('https://storage.s3.amazonaws.com/upload', { folder: 'photos' })).toBe(
        'https://storage.s3.amazonaws.com/upload?folder=photos'
      );
    });

    it('should extract IDs and URLs with dot-notation path', () => {
      const client = new ApiClient({ baseUrl: 'https://api.example.com' });

      const res1 = { data: { url: 'https://cdn.example.com/elv_01.jpg', id: '123' } };
      expect(client.extractId(res1, 'data.url')).toBe('https://cdn.example.com/elv_01.jpg');
      expect(client.extractId(res1, 'data.id')).toBe('123');

      const res2 = { public_url: 'https://cdn.example.com/logo.png' };
      expect(client.extractId(res2, 'public_url')).toBe('https://cdn.example.com/logo.png');
    });

    it('should transform and check local files with file_base64 and file_exists', async () => {
      const testFilePath = path.join(tempDir, 'test-logo.svg');
      await fs.writeFile(testFilePath, '<svg><circle cx="5" cy="5" r="5"/></svg>', 'utf-8');

      expect(builtInTransformers.file_exists('test-logo.svg', tempDir)).toBe(true);
      expect(builtInTransformers.file_exists('non-existent.png', tempDir)).toBe(false);

      const base64Data = builtInTransformers.file_base64('test-logo.svg', tempDir);
      expect(base64Data.startsWith('data:image/svg+xml;base64,')).toBe(true);
    });

    it('should resolve @file(path) in PayloadResolver', async () => {
      const testFilePath = path.join(tempDir, 'avatar.png');
      await fs.writeFile(testFilePath, 'dummy image content', 'utf-8');

      const resolver = new PayloadResolver({
        cache: new IdCacheManager(),
        apiClient: new ApiClient({ baseUrl: 'https://api.example.com' }),
        parser: new FileParser(),
        config: { api_base_url: 'https://api.example.com', integration_steps: [] },
        basePath: tempDir,
      });

      const row = { Photo: 'avatar.png' };
      const resolved = await resolver.resolveStringExpression('@file({{Photo}})', row);
      expect(resolved).toEqual({
        __type: 'file',
        filePath: path.resolve(tempDir, 'avatar.png'),
        fileName: 'avatar.png',
      });
    });
  });
});
