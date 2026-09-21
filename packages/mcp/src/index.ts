#!/usr/bin/env node

// packages/mcp/src/index.ts

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  FileParser,
  SeederEngine,
  TemplateGenerator,
  safeValidateConfig,
} from '@api-seeder/core';

const server = new Server(
  {
    name: 'api-seeder-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 1. List Available Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'inspect_data_file',
        description: 'Inspects an Excel (.xlsx) or CSV (.csv) file, returning its column headers, total rows, and sample data.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Path to the Excel (.xlsx) or CSV (.csv) file',
            },
            sampleRows: {
              type: 'number',
              description: 'Number of sample rows to return (default: 5)',
              default: 5,
            },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'validate_seeder_config',
        description: 'Validates an API Seeder configuration file for schema compliance, file existence, and column mappings.',
        inputSchema: {
          type: 'object',
          properties: {
            configPath: {
              type: 'string',
              description: 'Path to config.json',
            },
          },
          required: ['configPath'],
        },
      },
      {
        name: 'generate_excel_templates',
        description: 'Generates blank Excel template sheets with headers inferred from the API Seeder configuration.',
        inputSchema: {
          type: 'object',
          properties: {
            configPath: {
              type: 'string',
              description: 'Path to config.json',
            },
            outputDir: {
              type: 'string',
              description: 'Directory where blank templates should be generated (default: ./templates_excel)',
              default: './templates_excel',
            },
          },
          required: ['configPath'],
        },
      },
      {
        name: 'run_seed_job',
        description: 'Runs data ingestion and API seeding from config.json. Supports dryRun simulation mode.',
        inputSchema: {
          type: 'object',
          properties: {
            configPath: {
              type: 'string',
              description: 'Path to config.json',
            },
            dryRun: {
              type: 'boolean',
              description: 'If true, simulates execution and resolves mappings without making HTTP mutations.',
              default: false,
            },
            failFast: {
              type: 'boolean',
              description: 'If true, stops execution immediately upon encountering the first rejected record.',
              default: false,
            },
          },
          required: ['configPath'],
        },
      },
    ],
  };
});

// 2. Handle Tool Calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'inspect_data_file') {
      const filePath = path.resolve(String(args?.filePath));
      const sampleRowsCount = Number(args?.sampleRows) || 5;

      const parser = new FileParser();
      const rows = await parser.getData(filePath);
      const headers = rows.length > 0 ? Object.keys(rows[0]).filter((k) => k !== '__rowNumber') : [];
      const sample = rows.slice(0, sampleRowsCount);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                filePath,
                totalRows: rows.length,
                columnHeaders: headers,
                sampleData: sample,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === 'validate_seeder_config') {
      const configPath = path.resolve(String(args?.configPath));
      const content = await fs.readFile(configPath, 'utf-8');
      const rawConfig = JSON.parse(content);

      const validation = safeValidateConfig(rawConfig);
      if (!validation.success) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  valid: false,
                  errors: validation.error.errors,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                valid: true,
                apiBaseUrl: validation.data.api_base_url,
                stepsCount: validation.data.integration_steps.length,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === 'generate_excel_templates') {
      const configPath = path.resolve(String(args?.configPath));
      const outputDir = String(args?.outputDir || './templates_excel');
      const content = await fs.readFile(configPath, 'utf-8');
      const rawConfig = JSON.parse(content);
      const validation = safeValidateConfig(rawConfig);

      if (!validation.success) {
        throw new Error('Config has schema validation errors.');
      }

      const generated = await TemplateGenerator.generateTemplates(
        validation.data,
        outputDir,
        path.dirname(configPath)
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, generatedFiles: generated }, null, 2),
          },
        ],
      };
    }

    if (name === 'run_seed_job') {
      const configPath = path.resolve(String(args?.configPath));
      const dryRun = Boolean(args?.dryRun);
      const failFast = Boolean(args?.failFast);

      const content = await fs.readFile(configPath, 'utf-8');
      const rawConfig = JSON.parse(content);

      const engine = new SeederEngine(rawConfig, {
        dryRun,
        failFast,
        workingDirectory: path.dirname(configPath),
      });

      const result = await engine.run();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Error executing tool '${name}': ${err.message}`,
        },
      ],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal MCP server error:', err);
  process.exit(1);
});
