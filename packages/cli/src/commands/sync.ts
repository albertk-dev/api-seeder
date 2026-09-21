// packages/cli/src/commands/sync.ts

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { SeederEngine } from '@api-seeder/core';

export interface SyncCommandOptions {
  failFast?: boolean;
  dryRun?: boolean;
  cacheFile?: string;
}

export async function runSync(configPath: string, options: SyncCommandOptions): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' API Seeder ')) + pc.bold(' Data Synchronization Engine'));

  const resolvedConfigPath = path.resolve(configPath);

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
    p.cancel(pc.red(`Error: Failed to parse JSON configuration: ${err.message}`));
    process.exit(1);
  }

  const workingDir = path.dirname(resolvedConfigPath);

  if (options.dryRun) {
    p.log.warn(pc.yellow('Mode DRY-RUN activated. No API requests will be sent.'));
  }

  const spinner = p.spinner();
  spinner.start('Initializing seeding engine and loading cache...');

  let currentStepName = '';

  const engine = new SeederEngine(rawConfig, {
    failFast: options.failFast,
    dryRun: options.dryRun,
    cacheFile: options.cacheFile,
    workingDirectory: workingDir,
    onProgress: (event) => {
      if (event.stepName !== currentStepName) {
        currentStepName = event.stepName;
        spinner.message(`Processing step [${event.stepIndex}/${event.totalSteps}]: ${pc.bold(event.stepName)}`);
      }

      if (event.status === 'failed') {
        p.log.error(
          pc.red(`Row ${event.currentRow}/${event.totalRows} in '${event.stepName}': ${event.message || 'Rejected'}`)
        );
      }
    },
    onLog: (level, msg) => {
      if (level === 'error') p.log.error(pc.red(msg));
      if (level === 'warn') p.log.warn(pc.yellow(msg));
    },
  });

  try {
    const result = await engine.run();
    spinner.stop('Execution finished');

    const durationSec = (result.durationMs / 1000).toFixed(2);

    if (result.success) {
      p.note(
        [
          `${pc.green('✔')} Steps completed: ${pc.bold(`${result.completedSteps}/${result.totalSteps}`)}`,
          `${pc.green('✔')} Records created:   ${pc.bold(String(result.totalCreated))}`,
          `${pc.cyan('ℹ')} Records updated:   ${pc.bold(String(result.totalUpdated))}`,
          `${pc.yellow('⏱')} Execution time:    ${pc.bold(`${durationSec}s`)}`,
        ].join('\n'),
        pc.green(pc.bold('SYNC SUCCESSFUL'))
      );
    } else {
      p.note(
        [
          `${pc.yellow('⚠')} Steps processed: ${pc.bold(`${result.completedSteps}/${result.totalSteps}`)}`,
          `${pc.green('✔')} Records created:   ${pc.bold(String(result.totalCreated))}`,
          `${pc.cyan('ℹ')} Records updated:   ${pc.bold(String(result.totalUpdated))}`,
          `${pc.red('✖')} Records failed:    ${pc.bold(String(result.totalFailed))}`,
          result.errorsReportPath
            ? `\n${pc.magenta('📊 Audit Report Generated:')}\n${pc.underline(result.errorsReportPath)}`
            : '',
        ].join('\n'),
        pc.red(pc.bold('SYNC COMPLETED WITH ERRORS'))
      );
    }

    p.outro(pc.cyan('Thank you for using API Seeder!'));

    if (!result.success) {
      process.exit(1);
    }
  } catch (err: any) {
    spinner.stop(pc.red('Execution halted due to fatal error'));
    p.cancel(pc.red(`Fatal Error: ${err.message}`));
    process.exit(1);
  }
}
