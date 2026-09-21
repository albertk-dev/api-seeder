// packages/cli/src/commands/studio.ts

import * as http from 'node:http';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import open from 'open';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { SeederEngine, FileParser, TemplateGenerator, validateConfig, safeValidateConfig } from '@api-seeder/core';

export interface StudioOptions {
  port?: number;
  config?: string;
}

export async function runStudio(options: StudioOptions = {}): Promise<void> {
  const port = options.port || 4000;
  const configPath = path.resolve(options.config || './config.json');
  const workingDir = path.dirname(configPath);

  p.intro(pc.bgMagenta(pc.black(' API Seeder Studio ')) + pc.bold(' Local Web Ingestion Cockpit'));

  // Resolve directory containing UI static assets
  const uiDir = await resolveUiDirectory();

  const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${port}`);

    try {
      // 1. API: Get active configuration
      if (url.pathname === '/api/config' && req.method === 'GET') {
        try {
          const data = await fs.readFile(configPath, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(data);
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Config file not found at: ${configPath}` }));
        }
        return;
      }

      // 2. API: Save updated configuration
      if (url.pathname === '/api/config' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const parsed = JSON.parse(body);
            validateConfig(parsed);
            await fs.writeFile(configPath, JSON.stringify(parsed, null, 2), 'utf-8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
        });
        return;
      }

      // 3. API: Inspect file headers and sample rows
      if (url.pathname === '/api/preview' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { filePath } = JSON.parse(body);
            const parser = new FileParser();
            const rows = await parser.getData(filePath, { basePath: workingDir });
            const headers = rows.length > 0 ? Object.keys(rows[0]).filter((k) => k !== '__rowNumber') : [];
            const sample = rows.slice(0, 15);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ totalRows: rows.length, headers, sample }));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      // 4. API: Validate configuration & columns
      if (url.pathname === '/api/validate' && req.method === 'POST') {
        try {
          const content = await fs.readFile(configPath, 'utf-8');
          const rawConfig = JSON.parse(content);
          const validation = safeValidateConfig(rawConfig);

          if (!validation.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: validation.error.errors[0]?.message }));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
      }

      // 5. API: Generate blank Excel templates
      if (url.pathname === '/api/templates' && req.method === 'POST') {
        try {
          const content = await fs.readFile(configPath, 'utf-8');
          const rawConfig = JSON.parse(content);
          const validation = safeValidateConfig(rawConfig);
          if (!validation.success) {
            throw new Error('Schema validation error');
          }

          const outputDir = path.resolve(workingDir, 'templates_excel');
          const generated = await TemplateGenerator.generateTemplates(validation.data, outputDir);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, count: generated.length, outputDir }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
      }

      // 6. API: Live Stream Execution via Server-Sent Events (SSE)
      if (url.pathname === '/api/run-stream' && req.method === 'GET') {
        const dryRun = url.searchParams.get('dryRun') === 'true';

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        const sendEvent = (event: string, data: any) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        try {
          const configContent = await fs.readFile(configPath, 'utf-8');
          const parsedConfig = JSON.parse(configContent);

          const engine = new SeederEngine(parsedConfig, {
            dryRun,
            workingDirectory: workingDir,
            onProgress: (prog) => {
              sendEvent('progress', prog);
            },
            onLog: (level, msg) => {
              sendEvent('log', { level, msg });
            },
          });

          const result = await engine.run();
          sendEvent('completed', result);
          res.end();
        } catch (err: any) {
          sendEvent('error', { message: err.message });
          res.end();
        }
        return;
      }

      // 7. Static UI Asset Server (HTML, CSS, JS, SVG)
      await serveStaticFile(url.pathname, uiDir, res);
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal Server Error: ${err.message}`);
    }
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    p.log.success(pc.green(`✔ API Seeder Studio running at: ${pc.bold(pc.underline(url))}`));
    p.log.info(pc.cyan(`Loaded configuration: ${pc.bold(configPath)}`));
    p.log.info(pc.dim('Press Ctrl+C in terminal to stop Studio.'));
    open(url).catch(() => {});
  });
}

/**
 * Serves static files from the UI directory.
 */
async function serveStaticFile(pathname: string, uiDir: string, res: http.ServerResponse): Promise<void> {
  const cleanPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(uiDir, cleanPath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(uiDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();

    const contentTypes: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
    };

    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    // Fallback to index.html for SPA routing
    try {
      const fallback = await fs.readFile(path.join(uiDir, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fallback);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('UI asset not found');
    }
  }
}

/**
 * Locates the UI static assets directory across development and production layouts.
 */
async function resolveUiDirectory(): Promise<string> {
  const possiblePaths = [
    // Next to current file (when running from source / ts-node)
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ui'),
    // Next to bin in built package
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ui'),
    // Workspace root / cwd
    path.resolve(process.cwd(), 'packages/cli/ui'),
    path.resolve(process.cwd(), 'ui'),
  ];

  for (const candidate of possiblePaths) {
    try {
      await fs.access(path.join(candidate, 'index.html'));
      return candidate;
    } catch {
      // Continue to next candidate
    }
  }

  throw new Error('Could not locate API Seeder Studio UI directory containing index.html');
}
