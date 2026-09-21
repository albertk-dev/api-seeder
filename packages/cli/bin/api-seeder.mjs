#!/usr/bin/env node

// bin/api-seeder.ts
import { Command } from "commander";

// src/commands/sync.ts
import * as fs from "fs/promises";
import * as path from "path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { SeederEngine } from "@api-seeder/core";
async function runSync(configPath, options) {
  p.intro(pc.bgCyan(pc.black(" API Seeder ")) + pc.bold(" Data Synchronization Engine"));
  const resolvedConfigPath = path.resolve(configPath);
  try {
    await fs.access(resolvedConfigPath);
  } catch {
    p.cancel(pc.red(`Error: Configuration file not found at: ${resolvedConfigPath}`));
    process.exit(1);
  }
  let rawConfig;
  try {
    const content = await fs.readFile(resolvedConfigPath, "utf-8");
    rawConfig = JSON.parse(content);
  } catch (err) {
    p.cancel(pc.red(`Error: Failed to parse JSON configuration: ${err.message}`));
    process.exit(1);
  }
  const workingDir = path.dirname(resolvedConfigPath);
  if (options.dryRun) {
    p.log.warn(pc.yellow("Mode DRY-RUN activated. No API requests will be sent."));
  }
  const spinner3 = p.spinner();
  spinner3.start("Initializing seeding engine and loading cache...");
  let currentStepName = "";
  const engine = new SeederEngine(rawConfig, {
    failFast: options.failFast,
    dryRun: options.dryRun,
    cacheFile: options.cacheFile,
    workingDirectory: workingDir,
    onProgress: (event) => {
      if (event.stepName !== currentStepName) {
        currentStepName = event.stepName;
        spinner3.message(`Processing step [${event.stepIndex}/${event.totalSteps}]: ${pc.bold(event.stepName)}`);
      }
      if (event.status === "failed") {
        p.log.error(
          pc.red(`Row ${event.currentRow}/${event.totalRows} in '${event.stepName}': ${event.message || "Rejected"}`)
        );
      }
    },
    onLog: (level, msg) => {
      if (level === "error") p.log.error(pc.red(msg));
      if (level === "warn") p.log.warn(pc.yellow(msg));
    }
  });
  try {
    const result = await engine.run();
    spinner3.stop("Execution finished");
    const durationSec = (result.durationMs / 1e3).toFixed(2);
    if (result.success) {
      p.note(
        [
          `${pc.green("\u2714")} Steps completed: ${pc.bold(`${result.completedSteps}/${result.totalSteps}`)}`,
          `${pc.green("\u2714")} Records created:   ${pc.bold(String(result.totalCreated))}`,
          `${pc.cyan("\u2139")} Records updated:   ${pc.bold(String(result.totalUpdated))}`,
          `${pc.yellow("\u23F1")} Execution time:    ${pc.bold(`${durationSec}s`)}`
        ].join("\n"),
        pc.green(pc.bold("SYNC SUCCESSFUL"))
      );
    } else {
      p.note(
        [
          `${pc.yellow("\u26A0")} Steps processed: ${pc.bold(`${result.completedSteps}/${result.totalSteps}`)}`,
          `${pc.green("\u2714")} Records created:   ${pc.bold(String(result.totalCreated))}`,
          `${pc.cyan("\u2139")} Records updated:   ${pc.bold(String(result.totalUpdated))}`,
          `${pc.red("\u2716")} Records failed:    ${pc.bold(String(result.totalFailed))}`,
          result.errorsReportPath ? `
${pc.magenta("\u{1F4CA} Audit Report Generated:")}
${pc.underline(result.errorsReportPath)}` : ""
        ].join("\n"),
        pc.red(pc.bold("SYNC COMPLETED WITH ERRORS"))
      );
    }
    p.outro(pc.cyan("Thank you for using API Seeder!"));
    if (!result.success) {
      process.exit(1);
    }
  } catch (err) {
    spinner3.stop(pc.red("Execution halted due to fatal error"));
    p.cancel(pc.red(`Fatal Error: ${err.message}`));
    process.exit(1);
  }
}

// src/commands/validate.ts
import * as fs2 from "fs/promises";
import * as path2 from "path";
import * as p2 from "@clack/prompts";
import pc2 from "picocolors";
import { safeValidateConfig, FileParser, TemplateGenerator } from "@api-seeder/core";
async function runValidate(configPath) {
  p2.intro(pc2.bgMagenta(pc2.black(" API Seeder ")) + pc2.bold(" Configuration & Schema Validator"));
  const resolvedConfigPath = path2.resolve(configPath);
  const basePath = path2.dirname(resolvedConfigPath);
  try {
    await fs2.access(resolvedConfigPath);
  } catch {
    p2.cancel(pc2.red(`Error: Configuration file not found at: ${resolvedConfigPath}`));
    process.exit(1);
  }
  let rawConfig;
  try {
    const content = await fs2.readFile(resolvedConfigPath, "utf-8");
    rawConfig = JSON.parse(content);
  } catch (err) {
    p2.cancel(pc2.red(`Error: Invalid JSON syntax: ${err.message}`));
    process.exit(1);
  }
  const parseResult = safeValidateConfig(rawConfig);
  if (!parseResult.success) {
    p2.log.error(pc2.red("Schema validation errors:"));
    parseResult.error.errors.forEach((e) => {
      p2.log.error(pc2.red(`  \u2022 Path [${e.path.join(".")}] : ${e.message}`));
    });
    p2.cancel(pc2.red("Configuration schema is invalid."));
    process.exit(1);
  }
  p2.log.success(pc2.green("\u2714 Schema structure is valid (Zod verified)"));
  const config = parseResult.data;
  const parser = new FileParser();
  let hasWarningsOrErrors = false;
  for (const step of config.integration_steps) {
    const filePath = path2.resolve(basePath, step.source_file);
    try {
      await fs2.access(filePath);
      p2.log.success(pc2.green(`\u2714 Step '${step.name}': Source file exists (${step.source_file})`));
      const headers = await parser.getHeaders(step.source_file, {
        basePath,
        csvOptions: step.csv_options
      });
      const requiredColumns = TemplateGenerator.extractColumnsFromStep(step);
      const missingColumns = requiredColumns.filter((col) => !headers.includes(col));
      if (missingColumns.length > 0) {
        hasWarningsOrErrors = true;
        p2.log.error(
          pc2.red(
            `\u2716 Step '${step.name}': Missing columns in '${path2.basename(step.source_file)}': ${pc2.bold(
              missingColumns.join(", ")
            )}`
          )
        );
      } else {
        p2.log.success(pc2.green(`\u2714 Step '${step.name}': All ${requiredColumns.length} required columns found`));
      }
    } catch {
      hasWarningsOrErrors = true;
      p2.log.error(pc2.red(`\u2716 Step '${step.name}': File not found: ${step.source_file}`));
    }
  }
  if (hasWarningsOrErrors) {
    p2.note(pc2.yellow("Some files or columns are missing. Please fix the items above before running sync."), pc2.yellow("Validation Warning"));
    process.exit(1);
  } else {
    p2.note(
      `${pc2.green("\u2714")} API Endpoint: ${pc2.bold(config.api_base_url)}
${pc2.green("\u2714")} Total Steps: ${pc2.bold(String(config.integration_steps.length))}
${pc2.green("\u2714")} Ready for execution: npx api-seeder sync ${configPath}`,
      pc2.green("VALIDATION PASSED")
    );
    p2.outro(pc2.green("Your configuration is 100% sound and ready to run!"));
  }
}

// src/commands/template.ts
import * as fs3 from "fs/promises";
import * as path3 from "path";
import * as p3 from "@clack/prompts";
import pc3 from "picocolors";
import { safeValidateConfig as safeValidateConfig2, TemplateGenerator as TemplateGenerator2 } from "@api-seeder/core";
async function runTemplate(configPath, options) {
  p3.intro(pc3.bgGreen(pc3.black(" API Seeder ")) + pc3.bold(" Excel Template Generator"));
  const resolvedConfigPath = path3.resolve(configPath);
  const basePath = path3.dirname(resolvedConfigPath);
  try {
    await fs3.access(resolvedConfigPath);
  } catch {
    p3.cancel(pc3.red(`Error: Configuration file not found at: ${resolvedConfigPath}`));
    process.exit(1);
  }
  let rawConfig;
  try {
    const content = await fs3.readFile(resolvedConfigPath, "utf-8");
    rawConfig = JSON.parse(content);
  } catch (err) {
    p3.cancel(pc3.red(`Error: Invalid JSON syntax: ${err.message}`));
    process.exit(1);
  }
  const parseResult = safeValidateConfig2(rawConfig);
  if (!parseResult.success) {
    p3.cancel(pc3.red("Cannot generate templates: configuration has schema errors."));
    process.exit(1);
  }
  const outputDir = options.output || "./templates_excel";
  const spinner3 = p3.spinner();
  spinner3.start("Analyzing configuration mappings and generating blank Excel sheets...");
  try {
    const generated = await TemplateGenerator2.generateTemplates(parseResult.data, outputDir, basePath);
    spinner3.stop(pc3.green("Templates generated successfully!"));
    const summaryLines = generated.map(
      (item) => `\u2022 ${pc3.bold(path3.basename(item.filePath))} [${item.columns.length} columns: ${item.columns.join(", ")}]`
    );
    p3.note(summaryLines.join("\n"), pc3.cyan(`Output Directory: ${path3.resolve(basePath, outputDir)}`));
    p3.outro(pc3.green("Templates are ready to be populated by business teams!"));
  } catch (err) {
    spinner3.stop(pc3.red("Generation failed"));
    p3.cancel(pc3.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// src/commands/init.ts
import * as fs4 from "fs/promises";
import * as path4 from "path";
import * as p4 from "@clack/prompts";
import pc4 from "picocolors";
async function runInit() {
  p4.intro(pc4.bgBlue(pc4.black(" API Seeder ")) + pc4.bold(" Project Initialization Wizard"));
  const apiUrl = await p4.text({
    message: "What is your target API Base URL?",
    placeholder: "https://api.my-service.com/v1",
    validate: (val) => {
      try {
        new URL(val);
        return;
      } catch {
        return "Please enter a valid URL (including https://)";
      }
    }
  });
  if (p4.isCancel(apiUrl)) {
    p4.cancel("Setup cancelled.");
    process.exit(0);
  }
  const authToken = await p4.password({
    message: "API Authorization Bearer Token (optional, press Enter to skip):"
  });
  if (p4.isCancel(authToken)) {
    p4.cancel("Setup cancelled.");
    process.exit(0);
  }
  const stepName = await p4.text({
    message: "Name of your first integration step:",
    placeholder: "create_organizations",
    defaultValue: "step_one"
  });
  if (p4.isCancel(stepName)) {
    p4.cancel("Setup cancelled.");
    process.exit(0);
  }
  const endpoint = await p4.text({
    message: "Target API endpoint for this step:",
    placeholder: "/organizations",
    defaultValue: "/items"
  });
  if (p4.isCancel(endpoint)) {
    p4.cancel("Setup cancelled.");
    process.exit(0);
  }
  const sourceFile = await p4.text({
    message: "Source Excel or CSV file path:",
    placeholder: "data/organizations.xlsx",
    defaultValue: "data/input.xlsx"
  });
  if (p4.isCancel(sourceFile)) {
    p4.cancel("Setup cancelled.");
    process.exit(0);
  }
  const configContent = {
    $schema: "https://raw.githubusercontent.com/albertk-dev/api-seeder/main/schema.json",
    api_base_url: apiUrl,
    use_id_cache: true,
    id_cache_file: ".id_cache.json",
    global_headers: {
      "Content-Type": "application/json",
      ...authToken ? { Authorization: `Bearer ${authToken}` } : {}
    },
    integration_steps: [
      {
        name: stepName,
        enabled: true,
        source_file: sourceFile,
        endpoint,
        method: "POST",
        unique_identifier: "code",
        payload_mapping: {
          name: "{{Nom}}",
          code: "{{Code}}",
          description: "Description"
        }
      }
    ]
  };
  const targetPath = path4.resolve("config.json");
  await fs4.writeFile(targetPath, JSON.stringify(configContent, null, 2), "utf-8");
  p4.note(
    `Configuration created at: ${pc4.bold(targetPath)}

Next steps:
 1. Run ${pc4.cyan("npx api-seeder template config.json")} to generate blank Excel sheets.
 2. Run ${pc4.cyan("npx api-seeder sync config.json --dry-run")} to test your mapping.
 3. Run ${pc4.cyan("npx api-seeder studio")} to launch the Web GUI!`,
    pc4.green("Setup Complete")
  );
  p4.outro(pc4.green("Your project is initialized and ready!"));
}

// src/commands/schema.ts
import * as fs5 from "fs/promises";
import * as path5 from "path";
import * as p5 from "@clack/prompts";
import pc5 from "picocolors";
import { generateJsonSchema } from "@api-seeder/core";
async function runSchema(options) {
  const schema = generateJsonSchema();
  const outputPath = path5.resolve(options.output || "./schema.json");
  await fs5.writeFile(outputPath, JSON.stringify(schema, null, 2), "utf-8");
  p5.log.success(pc5.green(`\u2714 JSON Schema written to: ${outputPath}`));
}

// src/commands/studio.ts
import * as http from "http";
import * as fs6 from "fs/promises";
import * as path6 from "path";
import open from "open";
import * as p6 from "@clack/prompts";
import pc6 from "picocolors";
import { SeederEngine as SeederEngine2, FileParser as FileParser2, validateConfig } from "@api-seeder/core";
async function runStudio(options) {
  const port = options.port || 4e3;
  const configPath = path6.resolve(options.config || "./config.json");
  const workingDir = path6.dirname(configPath);
  p6.intro(pc6.bgMagenta(pc6.black(" API Seeder Studio ")) + pc6.bold(" Interactive Web Experience"));
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    try {
      if (url.pathname === "/api/config" && req.method === "GET") {
        try {
          const data = await fs6.readFile(configPath, "utf-8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(data);
        } catch {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Config file not found", configPath }));
        }
        return;
      }
      if (url.pathname === "/api/config" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => body += chunk);
        req.on("end", async () => {
          try {
            const parsed = JSON.parse(body);
            validateConfig(parsed);
            await fs6.writeFile(configPath, JSON.stringify(parsed, null, 2), "utf-8");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true }));
          } catch (err) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
        });
        return;
      }
      if (url.pathname === "/api/preview" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => body += chunk);
        req.on("end", async () => {
          try {
            const { filePath } = JSON.parse(body);
            const parser = new FileParser2();
            const rows = await parser.getData(filePath, { basePath: workingDir });
            const headers = rows.length > 0 ? Object.keys(rows[0]).filter((k) => k !== "__rowNumber") : [];
            const sample = rows.slice(0, 15);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ totalRows: rows.length, headers, sample }));
          } catch (err) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }
      if (url.pathname === "/api/run-stream" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });
        const sendEvent = (event, data) => {
          res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
        };
        try {
          const configContent = await fs6.readFile(configPath, "utf-8");
          const parsedConfig = JSON.parse(configContent);
          const engine = new SeederEngine2(parsedConfig, {
            workingDirectory: workingDir,
            onProgress: (prog) => {
              sendEvent("progress", prog);
            },
            onLog: (level, msg) => {
              sendEvent("log", { level, msg });
            }
          });
          const result = await engine.run();
          sendEvent("completed", result);
          res.end();
        } catch (err) {
          sendEvent("error", { message: err.message });
          res.end();
        }
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getStudioHtml(port));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Internal Server Error: ${err.message}`);
    }
  });
  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    p6.log.success(pc6.green(`\u2714 API Seeder Studio running at: ${pc6.bold(pc6.underline(url))}`));
    p6.log.info(pc6.cyan(`Loaded configuration: ${pc6.bold(configPath)}`));
    p6.log.info(pc6.dim("Press Ctrl+C in terminal to stop Studio."));
    open(url).catch(() => {
    });
  });
}
function getStudioHtml(port) {
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
          \u26A1
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
          \u{1F504} Recharger Config
        </button>
        <button id="btn-run" class="px-4 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-xs font-semibold shadow-lg shadow-emerald-500/25 hover:from-emerald-400 hover:to-teal-500 transition flex items-center gap-1.5">
          \u25B6 Lancer Synchronisation
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
            <span>\u2699\uFE0F</span> Configuration Active
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
          <span class="flex items-center gap-2"><span>\u{1F4DC}</span> Journal d'Ex\xE9cution (Temps R\xE9el)</span>
          <span id="run-status-badge" class="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-medium">En attente</span>
        </h2>
        <div id="logs-terminal" class="bg-slate-900 border border-slate-800 rounded-xl p-4 h-64 overflow-y-auto font-mono text-xs space-y-1 text-slate-300">
          <p class="text-slate-500">Pr\xEAt \xE0 lancer. Cliquez sur "Lancer Synchronisation" pour d\xE9marrer.</p>
        </div>
      </div>
    </div>

    <!-- Right Column: Live Metrics & Preview -->
    <div class="lg:col-span-5 space-y-6">
      <!-- Summary Cards -->
      <div class="grid grid-cols-2 gap-4">
        <div class="glass rounded-2xl p-5 border-l-4 border-l-emerald-500">
          <p class="text-xs text-slate-400 font-medium">Entit\xE9s Cr\xE9\xE9es</p>
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
          <span>\u{1F4CA}</span> Pr\xE9visualisation Donn\xE9es
        </h2>
        <div id="preview-container" class="overflow-x-auto text-xs">
          <p class="text-slate-400 text-xs py-8 text-center">S\xE9lectionnez une \xE9tape \xE0 gauche pour inspecter ses donn\xE9es.</p>
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
        document.getElementById('api-base-url').textContent = data.api_base_url || 'URL Non D\xE9finie';
        
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
              <span>\u{1F4C1} \${step.source_file}</span>
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
      terminal.innerHTML = '<p class="text-cyan-400 font-semibold">\u26A1 D\xE9marrage de la synchronisation...</p>';
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
          p.textContent = \`[\u2714] \${prog.stepName} (Ligne \${prog.currentRow}/\${prog.totalRows}) ID: \${prog.entityId || ''}\`;
        } else if (prog.status === 'failed') {
          failed++;
          p.className = 'text-rose-400';
          p.textContent = \`[\u2716] \${prog.stepName} (Ligne \${prog.currentRow}/\${prog.totalRows}) \${prog.message || ''}\`;
        } else {
          p.className = 'text-slate-400';
          p.textContent = \`[\u2192] \${prog.stepName} (Ligne \${prog.currentRow}/\${prog.totalRows}) ...\`;
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
        p.textContent = res.success ? '\u2714 Synchronisation termin\xE9e avec succ\xE8s !' : '\u2716 Synchronisation termin\xE9e avec des erreurs.';
        terminal.appendChild(p);
        eventSource.close();
        document.getElementById('run-status-badge').textContent = 'Termin\xE9';
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

// bin/api-seeder.ts
var program = new Command();
program.name("api-seeder").description("\u26A1 Industrial hierarchical Excel/CSV data ingestion & seed orchestrator for REST APIs").version("1.0.0");
program.command("sync").description("Synchronize structured Excel/CSV data to target REST API").argument("[config]", "Path to config.json file", "config.json").option("--fail-fast", "Stop execution immediately on first rejected record", false).option("--dry-run", "Simulate mapping and execution without sending HTTP requests", false).option("--cache-file <path>", "Custom path for the ID cache file").action(async (config, options) => {
  await runSync(config, options);
});
program.command("validate").description("Validate configuration schema, file existence, and Excel column mappings").argument("[config]", "Path to config.json file", "config.json").action(async (config) => {
  await runValidate(config);
});
program.command("template").description("Generate blank Excel template sheets inferred from configuration schema").argument("[config]", "Path to config.json file", "config.json").option("-o, --output <dir>", "Output directory for generated templates", "./templates_excel").action(async (config, options) => {
  await runTemplate(config, options);
});
program.command("init").description("Interactive wizard to create a new config.json project").action(async () => {
  await runInit();
});
program.command("schema").description("Generate official JSON Schema for IDE autocompletion").option("-o, --output <file>", "Output path for schema.json", "./schema.json").action(async (options) => {
  await runSchema(options);
});
program.command("studio").description("Launch the interactive local Web Studio (like Prisma Studio)").option("-p, --port <number>", "Port for local studio server", (val) => parseInt(val, 10), 4e3).option("-c, --config <path>", "Path to config.json", "./config.json").action(async (options) => {
  await runStudio(options);
});
program.parse(process.argv);
