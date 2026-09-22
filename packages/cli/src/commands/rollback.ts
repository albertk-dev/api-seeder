// packages/cli/src/commands/rollback.ts

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { SeederEngine } from '@api-seeder/core';

export interface RollbackCommandOptions {
  dryRun?: boolean;
  force?: boolean;
}

export async function runRollback(
  configPath: string = 'config.json',
  options: RollbackCommandOptions = {}
): Promise<void> {
  const resolvedConfigPath = path.resolve(configPath);
  const basePath = path.dirname(resolvedConfigPath);

  p.intro(pc.bgRed(pc.black(' API Seeder ')) + pc.bold(' Transactional Rollback'));

  // 1. Check if config file exists
  let rawConfig: any;
  try {
    const content = await fs.readFile(resolvedConfigPath, 'utf-8');
    rawConfig = JSON.parse(content);
  } catch (err: any) {
    p.cancel(pc.red(`Failed to read configuration file at: ${resolvedConfigPath} (${err.message})`));
    process.exit(1);
  }

  // 2. Safety confirmation (unless --force or --dry-run)
  if (!options.force && !options.dryRun) {
    const shouldContinue = await p.confirm({
      message: pc.yellow('Are you sure you want to rollback and DELETE all created entities recorded in cache?'),
      initialValue: false,
    });

    if (p.isCancel(shouldContinue) || !shouldContinue) {
      p.cancel(pc.dim('Rollback aborted by user. No deletions performed.'));
      process.exit(0);
    }
  }

  // 3. Initialize engine
  const engine = new SeederEngine(rawConfig, {
    workingDirectory: basePath,
  });

  const spinner = p.spinner();
  spinner.start(options.dryRun ? 'Simulating rollback (DRY-RUN)...' : 'Executing entity deletions...');

  const startTime = Date.now();

  try {
    const result = await engine.rollback({
      dryRun: options.dryRun,
      force: options.force,
      workingDirectory: basePath,
      onProgress: (event) => {
        if (event.status === 'deleted') {
          p.log.info(pc.cyan(`Deleted [${event.stepName}]: ${event.entityId} ${event.message || ''}`));
        } else if (event.status === 'failed') {
          p.log.error(pc.red(`Failed to delete [${event.stepName}]: ${event.entityId} (${event.message})`));
        }
      },
    });

    spinner.stop(options.dryRun ? 'Rollback simulation completed' : 'Rollback execution completed');

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

    if (result.success) {
      p.note(
        [
          `Entities deleted: ${pc.bold(String(result.totalDeleted))}`,
          `Failures:         ${pc.bold(String(result.totalFailed))}`,
          `Duration:         ${pc.bold(`${durationSec}s`)}`,
          options.dryRun ? `Mode:             ${pc.yellow('DRY-RUN SIMULATION')}` : `Cache:            ${pc.green('CLEANED')}`,
        ].join('\n'),
        pc.green(pc.bold('ROLLBACK COMPLETED'))
      );
    } else {
      p.note(
        [
          `Entities deleted: ${pc.bold(String(result.totalDeleted))}`,
          `Failures:         ${pc.red(pc.bold(String(result.totalFailed)))}`,
          `Duration:         ${pc.bold(`${durationSec}s`)}`,
        ].join('\n'),
        pc.red(pc.bold('ROLLBACK COMPLETED WITH ERRORS'))
      );
    }

    p.outro(pc.cyan('Rollback session finished.'));

    if (!result.success) {
      process.exit(1);
    }
  } catch (err: any) {
    spinner.stop('Rollback failed');
    p.log.error(pc.red(`Unexpected error during rollback: ${err.message}`));
    process.exit(1);
  }
}
