// packages/cli/src/commands/init.ts

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';

export async function runInit(): Promise<void> {
  p.intro(pc.bgBlue(pc.black(' API Seeder ')) + pc.bold(' Project Initialization Wizard'));

  const apiUrl = await p.text({
    message: 'What is your target API Base URL?',
    placeholder: 'https://api.my-service.com/v1',
    validate: (val) => {
      try {
        new URL(val);
        return;
      } catch {
        return 'Please enter a valid URL (including https://)';
      }
    },
  });

  if (p.isCancel(apiUrl)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const authToken = await p.password({
    message: 'API Authorization Bearer Token (optional, press Enter to skip):',
  });

  if (p.isCancel(authToken)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const stepName = await p.text({
    message: 'Name of your first integration step:',
    placeholder: 'create_organizations',
    defaultValue: 'step_one',
  });

  if (p.isCancel(stepName)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const endpoint = await p.text({
    message: 'Target API endpoint for this step:',
    placeholder: '/organizations',
    defaultValue: '/items',
  });

  if (p.isCancel(endpoint)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const sourceFile = await p.text({
    message: 'Source Excel or CSV file path:',
    placeholder: 'data/organizations.xlsx',
    defaultValue: 'data/input.xlsx',
  });

  if (p.isCancel(sourceFile)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const configContent = {
    $schema: 'https://raw.githubusercontent.com/albertk-dev/api-seeder/main/schema.json',
    api_base_url: apiUrl,
    use_id_cache: true,
    id_cache_file: '.id_cache.json',
    global_headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    integration_steps: [
      {
        name: stepName,
        enabled: true,
        source_file: sourceFile,
        endpoint: endpoint,
        method: 'POST',
        unique_identifier: 'code',
        payload_mapping: {
          name: '{{Nom}}',
          code: '{{Code}}',
          description: 'Description',
        },
      },
    ],
  };

  const targetPath = path.resolve('config.json');
  await fs.writeFile(targetPath, JSON.stringify(configContent, null, 2), 'utf-8');

  p.note(
    `Configuration created at: ${pc.bold(targetPath)}\n\nNext steps:\n` +
    ` 1. Run ${pc.cyan('npx api-seeder template config.json')} to generate blank Excel sheets.\n` +
    ` 2. Run ${pc.cyan('npx api-seeder sync config.json --dry-run')} to test your mapping.\n` +
    ` 3. Run ${pc.cyan('npx api-seeder studio')} to launch the Web GUI!`,
    pc.green('Setup Complete')
  );

  p.outro(pc.green('Your project is initialized and ready!'));
}
