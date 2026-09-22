// packages/cli/src/commands/schema.ts

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { generateJsonSchema } from '@api-seeder/core';

export async function runSchema(options: { output?: string }): Promise<void> {
  const schema = generateJsonSchema();
  const outputPath = path.resolve(options.output || './schema.json');

  await fs.writeFile(outputPath, JSON.stringify(schema, null, 2), 'utf-8');
  p.log.success(pc.green(`JSON Schema written to: ${outputPath}`));
}
