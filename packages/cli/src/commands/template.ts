// packages/cli/src/commands/template.ts

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { safeValidateConfig, TemplateGenerator, loadEnvFile, resolveEnvVariables } from '@api-seeder/core';

export async function runTemplate(configPath: string, options: { output?: string }): Promise<void> {
  p.intro(pc.bgGreen(pc.black(' API Seeder ')) + pc.bold(' Excel Template Generator'));

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

  loadEnvFile(basePath);
  const configWithEnv = resolveEnvVariables(rawConfig);

  const parseResult = safeValidateConfig(configWithEnv);
  if (!parseResult.success) {
    p.cancel(pc.red('Cannot generate templates: configuration has schema errors.'));
    process.exit(1);
  }

  const outputDir = options.output || './templates_excel';
  const spinner = p.spinner();
  spinner.start('Analyzing configuration mappings and generating blank Excel sheets...');

  try {
    const resolvedOutput = path.resolve(basePath, outputDir);
    const generated = await TemplateGenerator.generateTemplates(parseResult.data, {
      outputDir: resolvedOutput,
      overwrite: true,
    });
    spinner.stop(pc.green('Templates generated successfully!'));

    const summaryLines = generated.map(
      (item) => `• ${pc.bold(path.basename(item.filePath))} [${item.columns.length} columns: ${item.columns.join(', ')}]`
    );

    p.note(summaryLines.join('\n'), pc.cyan(`Output Directory: ${path.resolve(basePath, outputDir)}`));
    p.outro(pc.green('Templates are ready to be populated by business teams!'));
  } catch (err: any) {
    spinner.stop(pc.red('Generation failed'));
    p.cancel(pc.red(`Error: ${err.message}`));
    process.exit(1);
  }
}
