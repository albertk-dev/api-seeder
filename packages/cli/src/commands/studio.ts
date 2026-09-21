// packages/cli/src/commands/studio.ts

import * as http from 'node:http';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import open from 'open';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { SeederEngine, FileParser, TemplateGenerator, validateConfig } from '@api-seeder/core';

export async function runStudio(options: { port?: number; config?: string }): Promise<void> {
  const port = options.port || 4000;
  const configPath = path.resolve(options.config || './config.json');
  const workingDir = path.dirname(configPath);

  p.intro(pc.bgMagenta(pc.black(' API Seeder Studio ')) + pc.bold(' Interactive Web Experience'));

  // Create lightweight Node HTTP server
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
      // API: Get current config
      if (url.pathname === '/api/config' && req.method === 'GET') {
        try {
          const data = await fs.readFile(configPath, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(data);
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Config file not found', configPath }));
        }
        return;
      }

      // API: Save config
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

      // API: Inspect file headers and sample rows
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

      // API: Run Seeding with Server-Sent Events (SSE)
      if (url.pathname === '/api/run-stream' && req.method === 'GET') {
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

      // Serve Embedded Web Studio SPA HTML
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getStudioHtml(port));
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

function getStudioHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="fr" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Seeder Studio</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
    code, pre { font-family: 'JetBrains Mono', monospace; }
    .glass { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.08); }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
  <!-- Top Navigation -->
  <header class="border-b border-slate-800/80 bg-slate-900/60 sticky top-0 z-50 backdrop-blur-md">
    <div class="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-black text-white shadow-lg shadow-blue-500/20 text-lg">
          ⚡
        </div>
        <div>
          <h1 class="font-bold text-lg leading-tight flex items-center gap-2">
            API Seeder <span class="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-semibold border border-blue-500/30">Studio</span>
          </h1>
          <p class="text-xs text-slate-400">Hierarchical Ingestion & Sync Engine</p>
        </div>
      </div>
      <div class="flex items-center space-x-3">
        <button id="btn-refresh" class="px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs font-medium hover:bg-slate-700 transition">
          🔄 Recharger Config
        </button>
        <button id="btn-run" class="px-4 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-xs font-semibold shadow-lg shadow-emerald-500/25 hover:from-emerald-400 hover:to-teal-500 transition flex items-center gap-1.5">
          ▶ Lancer Synchronisation
        </button>
      </div>
    </div>
  </header>

  <!-- Main Content -->
  <main class="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
    <!-- Left Column: Steps & Configuration -->
    <div class="lg:col-span-7 space-y-6">
      <div class="glass rounded-2xl p-6 shadow-xl">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-base font-bold text-white flex items-center gap-2">
            <span>⚙️</span> Configuration Active
          </h2>
          <span id="api-base-url" class="text-xs px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 font-mono text-cyan-400">...</span>
        </div>
        <div id="steps-container" class="space-y-3">
          <div class="animate-pulse bg-slate-800/50 rounded-xl p-4 h-24"></div>
        </div>
      </div>

      <!-- Live Log Stream -->
      <div class="glass rounded-2xl p-6 shadow-xl">
        <h2 class="text-base font-bold text-white flex items-center justify-between mb-3">
          <span class="flex items-center gap-2"><span>📜</span> Journal d'Exécution (Temps Réel)</span>
          <span id="run-status-badge" class="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-medium">En attente</span>
        </h2>
        <div id="logs-terminal" class="bg-slate-900 border border-slate-800 rounded-xl p-4 h-64 overflow-y-auto font-mono text-xs space-y-1 text-slate-300">
          <p class="text-slate-500">Prêt à lancer. Cliquez sur "Lancer Synchronisation" pour démarrer.</p>
        </div>
      </div>
    </div>

    <!-- Right Column: Live Metrics & Preview -->
    <div class="lg:col-span-5 space-y-6">
      <!-- Summary Cards -->
      <div class="grid grid-cols-2 gap-4">
        <div class="glass rounded-2xl p-5 border-l-4 border-l-emerald-500">
          <p class="text-xs text-slate-400 font-medium">Entités Créées</p>
          <p id="metric-created" class="text-2xl font-black text-emerald-400 mt-1">0</p>
        </div>
        <div class="glass rounded-2xl p-5 border-l-4 border-l-rose-500">
          <p class="text-xs text-slate-400 font-medium">Rejets / Erreurs</p>
          <p id="metric-failed" class="text-2xl font-black text-rose-400 mt-1">0</p>
        </div>
      </div>

      <!-- Data Source Preview -->
      <div class="glass rounded-2xl p-6 shadow-xl">
        <h2 class="text-base font-bold text-white mb-3 flex items-center gap-2">
          <span>📊</span> Prévisualisation Données
        </h2>
        <div id="preview-container" class="overflow-x-auto text-xs">
          <p class="text-slate-400 text-xs py-8 text-center">Sélectionnez une étape à gauche pour inspecter ses données.</p>
        </div>
      </div>
    </div>
  </main>

  <script>
    async function loadConfig() {
      try {
        const res = await fetch('/api/config');
        const data = await res.json();
        if (data.error) {
          document.getElementById('steps-container').innerHTML = \`<p class="text-rose-400 text-sm">\${data.error}</p>\`;
          return;
        }
        document.getElementById('api-base-url').textContent = data.api_base_url || 'URL Non Définie';
        
        const container = document.getElementById('steps-container');
        container.innerHTML = data.integration_steps.map((step, idx) => \`
          <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-blue-500/50 transition cursor-pointer" onclick="previewStep('\${step.source_file}')">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-sm text-white flex items-center gap-2">
                <span class="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 text-xs flex items-center justify-center font-bold">\${idx + 1}</span>
                \${step.name}
              </span>
              <span class="text-xs px-2 py-0.5 rounded bg-slate-800 font-mono text-cyan-400">\${step.method || 'POST'} \${step.endpoint}</span>
            </div>
            <p class="text-xs text-slate-400 mt-2 flex items-center gap-2">
              <span>📁 \${step.source_file}</span>
            </p>
          </div>
        \`).join('');
      } catch (err) {
        console.error(err);
      }
    }

    async function previewStep(filePath) {
      const container = document.getElementById('preview-container');
      container.innerHTML = '<p class="text-slate-400 text-xs py-4 text-center">Chargement du fichier...</p>';
      try {
        const res = await fetch('/api/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath })
        });
        const data = await res.json();
        if (data.error) {
          container.innerHTML = \`<p class="text-rose-400 text-xs py-4 text-center">\${data.error}</p>\`;
          return;
        }

        const tableHtml = \`
          <div class="mb-2 text-xs text-slate-400 font-medium">Total: \${data.totalRows} ligne(s) source</div>
          <table class="w-full border-collapse border border-slate-800 rounded-lg overflow-hidden">
            <thead>
              <tr class="bg-slate-900 text-slate-300">
                \${data.headers.map(h => \`<th class="border border-slate-800 px-3 py-1.5 text-left font-semibold">\${h}</th>\`).join('')}
              </tr>
            </thead>
            <tbody>
              \${data.sample.map((row, rIdx) => \`
                <tr class="\${rIdx % 2 === 0 ? 'bg-slate-950/40' : 'bg-slate-900/40'} hover:bg-slate-800/60">
                  \${data.headers.map(h => \`<td class="border border-slate-800 px-3 py-1.5 text-slate-300">\${row[h] || ''}</td>\`).join('')}
                </tr>
              \`).join('')}
            </tbody>
          </table>
        \`;
        container.innerHTML = tableHtml;
      } catch (err) {
        container.innerHTML = \`<p class="text-rose-400 text-xs py-4 text-center">\${err.message}</p>\`;
      }
    }

    document.getElementById('btn-refresh').addEventListener('click', loadConfig);

    document.getElementById('btn-run').addEventListener('click', () => {
      const terminal = document.getElementById('logs-terminal');
      terminal.innerHTML = '<p class="text-cyan-400 font-semibold">⚡ Démarrage de la synchronisation...</p>';
      document.getElementById('run-status-badge').textContent = 'En cours...';
      document.getElementById('run-status-badge').className = 'text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-medium animate-pulse';

      let created = 0;
      let failed = 0;

      const eventSource = new EventSource('/api/run-stream');

      eventSource.addEventListener('progress', (e) => {
        const prog = JSON.parse(e.data);
        const p = document.createElement('p');
        if (prog.status === 'success') {
          created++;
          p.className = 'text-emerald-400';
          p.textContent = \`[✔] \${prog.stepName} (Ligne \${prog.currentRow}/\${prog.totalRows}) ID: \${prog.entityId || ''}\`;
        } else if (prog.status === 'failed') {
          failed++;
          p.className = 'text-rose-400';
          p.textContent = \`[✖] \${prog.stepName} (Ligne \${prog.currentRow}/\${prog.totalRows}) \${prog.message || ''}\`;
        } else {
          p.className = 'text-slate-400';
          p.textContent = \`[→] \${prog.stepName} (Ligne \${prog.currentRow}/\${prog.totalRows}) ...\`;
        }
        terminal.appendChild(p);
        terminal.scrollTop = terminal.scrollHeight;
        document.getElementById('metric-created').textContent = created;
        document.getElementById('metric-failed').textContent = failed;
      });

      eventSource.addEventListener('completed', (e) => {
        const res = JSON.parse(e.data);
        const p = document.createElement('p');
        p.className = res.success ? 'text-emerald-400 font-bold mt-2' : 'text-rose-400 font-bold mt-2';
        p.textContent = res.success ? '✔ Synchronisation terminée avec succès !' : '✖ Synchronisation terminée avec des erreurs.';
        terminal.appendChild(p);
        eventSource.close();
        document.getElementById('run-status-badge').textContent = 'Terminé';
        document.getElementById('run-status-badge').className = res.success ? 'text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium' : 'text-xs px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 font-medium';
      });

      eventSource.addEventListener('error', () => {
        eventSource.close();
      });
    });

    loadConfig();
  </script>
</body>
</html>`;
}
