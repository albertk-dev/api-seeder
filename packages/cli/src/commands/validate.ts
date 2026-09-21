// packages/cli/src/commands/validate.ts

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { safeValidateConfig, FileParser, TemplateGenerator } from '@api-seeder/core';

export async function runValidate(configPath: string): Promise<void> {
  p.intro(pc.bgMagenta(pc.black(' API Seeder ')) + pc.bold(' Configuration & Schema Validator'));

  const resolvedConfigPath = path.resolve(configPath);
  const basePath = path.dirname(resolvedConfigPath);

  try {
    await fs.access(resolvedConfigPath);
  } catch {
    p.cancel(pc.red(`Error: Configuration file not found at: ${resolvedConfigPath}`));
    process.exit(1);
  }

  let rawConfig: any;
  try {
    const content = await fs.readFile(resolvedConfigPath, 'utf-8');
    rawConfig = JSON.parse(content);
  } catch (err: any) {
    p.cancel(pc.red(`Error: Invalid JSON syntax: ${err.message}`));
    process.exit(1);
  }

  // 1. Validate Schema
  const parseResult = safeValidateConfig(rawConfig);
  if (!parseResult.success) {
    p.log.error(pc.red('Schema validation errors:'));
    parseResult.error.errors.forEach((e) => {
      p.log.error(pc.red(`  • Path [${e.path.join('.')}] : ${e.message}`));
    });
    p.cancel(pc.red('Configuration schema is invalid.'));
    process.exit(1);
  }

  p.log.success(pc.green('✔ Schema structure is valid (Zod verified)'));

  const config = parseResult.data;
  const parser = new FileParser();
  let hasWarningsOrErrors = false;

  // 2. Validate Source Files & Columns
  for (const step of config.integration_steps) {
    const filePath = path.resolve(basePath, step.source_file);
    try {
      await fs.access(filePath);
      p.log.success(pc.green(`✔ Step '${step.name}': Source file exists (${step.source_file})`));

      // Check columns
      const headers = await parser.getHeaders(step.source_file, {
        basePath,
        csvOptions: step.csv_options,
      });

      const requiredColumns = TemplateGenerator.extractColumnsFromStep(step);
      const missingColumns = requiredColumns.filter((col) => !headers.includes(col));

      if (missingColumns.length > 0) {
        hasWarningsOrErrors = true;
        p.log.error(
          pc.red(
            `✖ Step '${step.name}': Missing columns in '${path.basename(step.source_file)}': ${pc.bold(
              missingColumns.join(', ')
            )}`
          )
        );
      } else {
        p.log.success(pc.green(`✔ Step '${step.name}': All ${requiredColumns.length} required columns found`));
      }
    } catch {
      hasWarningsOrErrors = true;
      p.log.error(pc.red(`✖ Step '${step.name}': File not found: ${step.source_file}`));
    }
  }

  if (hasWarningsOrErrors) {
    p.note(pc.yellow('Some files or columns are missing. Please fix the items above before running sync.'), pc.yellow('Validation Warning'));
    process.exit(1);
  } else {
    p.note(
      `${pc.green('✔')} API Endpoint: ${pc.bold(config.api_base_url)}\n` +
      `${pc.green('✔')} Total Steps: ${pc.bold(String(config.integration_steps.length))}\n` +
      `${pc.green('✔')} Ready for execution: npx api-seeder sync ${configPath}`,
      pc.green('VALIDATION PASSED')
    );
    p.outro(pc.green('Your configuration is 100% sound and ready to run!'));
  }
}
