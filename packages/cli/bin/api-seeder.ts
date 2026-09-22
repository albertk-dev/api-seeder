#!/usr/bin/env node

// packages/cli/bin/api-seeder.ts

import { Command } from 'commander';
import { runSync } from '../src/commands/sync.js';
import { runValidate } from '../src/commands/validate.js';
import { runTemplate } from '../src/commands/template.js';
import { runInit } from '../src/commands/init.js';
import { runSchema } from '../src/commands/schema.js';
import { runStudio } from '../src/commands/studio.js';
import { runRollback } from '../src/commands/rollback.js';

const program = new Command();

program
  .name('api-seeder')
  .description('Industrial hierarchical Excel/CSV data ingestion & seed orchestrator for REST APIs')
  .version('1.0.0');

// 1. sync command
program
  .command('sync')
  .description('Synchronize structured Excel/CSV data to target REST API')
  .argument('[config]', 'Path to config.json file', 'config.json')
  .option('--fail-fast', 'Stop execution immediately on first rejected record', false)
  .option('--dry-run', 'Simulate mapping and execution without sending HTTP requests', false)
  .option('--cache-file <path>', 'Custom path for the ID cache file')
  .action(async (config, options) => {
    await runSync(config, options);
  });

// 2. validate command
program
  .command('validate')
  .description('Validate configuration schema, file existence, and Excel column mappings')
  .argument('[config]', 'Path to config.json file', 'config.json')
  .action(async (config) => {
    await runValidate(config);
  });

// 3. template command
program
  .command('template')
  .description('Generate blank Excel template sheets inferred from configuration schema')
  .argument('[config]', 'Path to config.json file', 'config.json')
  .option('-o, --output <dir>', 'Output directory for generated templates', './templates_excel')
  .action(async (config, options) => {
    await runTemplate(config, options);
  });

// 4. init command
program
  .command('init')
  .description('Interactive wizard to create a new config.json project')
  .action(async () => {
    await runInit();
  });

// 5. schema command
program
  .command('schema')
  .description('Generate official JSON Schema for IDE autocompletion')
  .option('-o, --output <file>', 'Output path for schema.json', './schema.json')
  .action(async (options) => {
    await runSchema(options);
  });

// 6. studio command
program
  .command('studio')
  .description('Launch the interactive local Web Studio (like Prisma Studio)')
  .option('-p, --port <number>', 'Port for local studio server', (val) => parseInt(val, 10), 4000)
  .option('-c, --config <path>', 'Path to config.json', './config.json')
  .option('--no-open', 'Do not automatically open browser on startup')
  .action(async (options) => {
    await runStudio(options);
  });

// 7. rollback command
program
  .command('rollback')
  .description('Rollback and delete all created entities recorded in cache')
  .argument('[config]', 'Path to config.json file', 'config.json')
  .option('--dry-run', 'Simulate deletion without sending DELETE HTTP requests', false)
  .option('--force', 'Bypass interactive confirmation prompt', false)
  .action(async (config, options) => {
    await runRollback(config, options);
  });

program.parse(process.argv);

