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
  const spinner4 = p.spinner();
  spinner4.start("Initializing seeding engine and loading cache...");
  let currentStepName = "";
  const engine = new SeederEngine(rawConfig, {
    failFast: options.failFast,
    dryRun: options.dryRun,
    cacheFile: options.cacheFile,
    workingDirectory: workingDir,
    onProgress: (event) => {
      if (event.stepName !== currentStepName) {
        currentStepName = event.stepName;
        spinner4.message(`Processing step [${event.stepIndex}/${event.totalSteps}]: ${pc.bold(event.stepName)}`);
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
    spinner4.stop("Execution finished");
    const durationSec = (result.durationMs / 1e3).toFixed(2);
    if (result.success) {
      p.note(
        [
          `Steps completed: ${pc.bold(`${result.completedSteps}/${result.totalSteps}`)}`,
          `Records created: ${pc.bold(String(result.totalCreated))}`,
          `Records updated: ${pc.bold(String(result.totalUpdated))}`,
          `Execution time:  ${pc.bold(`${durationSec}s`)}`
        ].join("\n"),
        pc.green(pc.bold("SYNC SUCCESSFUL"))
      );
    } else {
      p.note(
        [
          `Steps processed: ${pc.bold(`${result.completedSteps}/${result.totalSteps}`)}`,
          `Records created: ${pc.bold(String(result.totalCreated))}`,
          `Records updated: ${pc.bold(String(result.totalUpdated))}`,
          `Records failed:  ${pc.red(pc.bold(String(result.totalFailed)))}`,
          result.errorsReportPath ? `
Audit Report Generated:
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
    spinner4.stop(pc.red("Execution halted due to fatal error"));
    p.cancel(pc.red(`Fatal Error: ${err.message}`));
    process.exit(1);
  }
}

// src/commands/validate.ts
import * as fs2 from "fs/promises";
import * as path2 from "path";
import * as p2 from "@clack/prompts";
import pc2 from "picocolors";
import { safeValidateConfig, FileParser, TemplateGenerator, loadEnvFile, resolveEnvVariables } from "@api-seeder/core";
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
  loadEnvFile(basePath);
  const configWithEnv = resolveEnvVariables(rawConfig);
  const parseResult = safeValidateConfig(configWithEnv);
  if (!parseResult.success) {
    p2.log.error(pc2.red("Schema validation errors:"));
    parseResult.error.errors.forEach((e) => {
      p2.log.error(pc2.red(`  \u2022 Path [${e.path.join(".")}] : ${e.message}`));
    });
    p2.cancel(pc2.red("Configuration schema is invalid."));
    process.exit(1);
  }
  p2.log.success(pc2.green("Schema structure is valid (Zod verified)"));
  const config = parseResult.data;
  const parser = new FileParser();
  let hasWarningsOrErrors = false;
  for (const step of config.integration_steps) {
    const filePath = path2.resolve(basePath, step.source_file);
    try {
      await fs2.access(filePath);
      p2.log.success(pc2.green(`Step '${step.name}': Source file exists (${step.source_file})`));
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
            `Step '${step.name}': Missing columns in '${path2.basename(step.source_file)}': ${pc2.bold(
              missingColumns.join(", ")
            )}`
          )
        );
      } else {
        p2.log.success(pc2.green(`Step '${step.name}': All ${requiredColumns.length} required columns found`));
      }
    } catch {
      hasWarningsOrErrors = true;
      p2.log.error(pc2.red(`Step '${step.name}': File not found: ${step.source_file}`));
    }
  }
  if (hasWarningsOrErrors) {
    p2.note(pc2.yellow("Some files or columns are missing. Please fix the items above before running sync."), pc2.yellow("Validation Warning"));
    process.exit(1);
  } else {
    p2.note(
      `${pc2.cyan("Endpoint:")} ${pc2.bold(config.api_base_url)}
${pc2.cyan("Steps:")}    ${pc2.bold(String(config.integration_steps.length))}
${pc2.cyan("Run:")}      npx api-seeder sync ${configPath}`,
      pc2.green("VALIDATION PASSED")
    );
    p2.outro(pc2.green("Configuration is verified and ready for execution."));
  }
}

// src/commands/template.ts
import * as fs3 from "fs/promises";
import * as path3 from "path";
import * as p3 from "@clack/prompts";
import pc3 from "picocolors";
import { safeValidateConfig as safeValidateConfig2, TemplateGenerator as TemplateGenerator2, loadEnvFile as loadEnvFile2, resolveEnvVariables as resolveEnvVariables2 } from "@api-seeder/core";
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
  loadEnvFile2(basePath);
  const configWithEnv = resolveEnvVariables2(rawConfig);
  const parseResult = safeValidateConfig2(configWithEnv);
  if (!parseResult.success) {
    p3.cancel(pc3.red("Cannot generate templates: configuration has schema errors."));
    process.exit(1);
  }
  const outputDir = options.output || "./templates_excel";
  const spinner4 = p3.spinner();
  spinner4.start("Analyzing configuration mappings and generating blank Excel sheets...");
  try {
    const resolvedOutput = path3.resolve(basePath, outputDir);
    const generated = await TemplateGenerator2.generateTemplates(parseResult.data, {
      outputDir: resolvedOutput,
      overwrite: true
    });
    spinner4.stop(pc3.green("Templates generated successfully!"));
    const summaryLines = generated.map(
      (item) => `\u2022 ${pc3.bold(path3.basename(item.filePath))} [${item.columns.length} columns: ${item.columns.join(", ")}]`
    );
    p3.note(summaryLines.join("\n"), pc3.cyan(`Output Directory: ${path3.resolve(basePath, outputDir)}`));
    p3.outro(pc3.green("Templates are ready to be populated by business teams!"));
  } catch (err) {
    spinner4.stop(pc3.red("Generation failed"));
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
  p5.log.success(pc5.green(`JSON Schema written to: ${outputPath}`));
}

// src/commands/studio.ts
import * as http from "http";
import * as fs6 from "fs/promises";
import * as path6 from "path";
import { fileURLToPath } from "url";
import open from "open";
import * as p6 from "@clack/prompts";
import pc6 from "picocolors";
import { SeederEngine as SeederEngine2, FileParser as FileParser2, TemplateGenerator as TemplateGenerator3, validateConfig, safeValidateConfig as safeValidateConfig3, loadEnvFile as loadEnvFile3, resolveEnvVariables as resolveEnvVariables3 } from "@api-seeder/core";
async function runStudio(options = {}) {
  const port = options.port || 4e3;
  const configPath = path6.resolve(options.config || "./config.json");
  const workingDir = path6.dirname(configPath);
  p6.intro(pc6.bgMagenta(pc6.black(" API Seeder Studio ")) + pc6.bold(" Local Web Ingestion Cockpit"));
  const uiDir = await resolveUiDirectory();
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
          res.end(JSON.stringify({ error: `Config file not found at: ${configPath}` }));
        }
        return;
      }
      if (url.pathname === "/api/config" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => body += chunk);
        req.on("end", async () => {
          try {
            const parsed = JSON.parse(body);
            loadEnvFile3(workingDir);
            validateConfig(resolveEnvVariables3(parsed));
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
      if (url.pathname === "/api/validate" && req.method === "POST") {
        try {
          const content = await fs6.readFile(configPath, "utf-8");
          const rawConfig = JSON.parse(content);
          loadEnvFile3(workingDir);
          const validation = safeValidateConfig3(resolveEnvVariables3(rawConfig));
          if (!validation.success) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: validation.error.errors[0]?.message }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
      }
      if (url.pathname === "/api/templates" && req.method === "POST") {
        try {
          const content = await fs6.readFile(configPath, "utf-8");
          const rawConfig = JSON.parse(content);
          loadEnvFile3(workingDir);
          const validation = safeValidateConfig3(resolveEnvVariables3(rawConfig));
          if (!validation.success) {
            throw new Error("Schema validation error");
          }
          const outputDir = path6.resolve(workingDir, "templates_excel");
          const generated = await TemplateGenerator3.generateTemplates(validation.data, outputDir);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, count: generated.length, outputDir }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
      }
      if (url.pathname === "/api/run-stream" && req.method === "GET") {
        const dryRun = url.searchParams.get("dryRun") === "true";
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
            dryRun,
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
      await serveStaticFile(url.pathname, uiDir, res);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Internal Server Error: ${err.message}`);
    }
  });
  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    p6.log.success(pc6.green(`API Seeder Studio running at: ${pc6.bold(pc6.underline(url))}`));
    p6.log.info(pc6.cyan(`Loaded configuration: ${pc6.bold(configPath)}`));
    p6.log.info(pc6.dim("Press Ctrl+C in terminal to stop Studio."));
    if (options.open !== false) {
      open(url).catch(() => {
      });
    }
  });
}
async function serveStaticFile(pathname, uiDir, res) {
  const cleanPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path6.resolve(uiDir, cleanPath);
  if (!filePath.startsWith(uiDir)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }
  try {
    const content = await fs6.readFile(filePath);
    const ext = path6.extname(filePath).toLowerCase();
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".ico": "image/x-icon"
    };
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
    res.end(content);
  } catch {
    try {
      const fallback = await fs6.readFile(path6.join(uiDir, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fallback);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("UI asset not found");
    }
  }
}
async function resolveUiDirectory() {
  const possiblePaths = [
    // Next to current file (when running from source / ts-node)
    path6.resolve(path6.dirname(fileURLToPath(import.meta.url)), "../../ui"),
    // Next to bin in built package
    path6.resolve(path6.dirname(fileURLToPath(import.meta.url)), "../ui"),
    // Workspace root / cwd
    path6.resolve(process.cwd(), "packages/cli/ui"),
    path6.resolve(process.cwd(), "ui")
  ];
  for (const candidate of possiblePaths) {
    try {
      await fs6.access(path6.join(candidate, "index.html"));
      return candidate;
    } catch {
    }
  }
  throw new Error("Could not locate API Seeder Studio UI directory containing index.html");
}

// src/commands/rollback.ts
import * as fs7 from "fs/promises";
import * as path7 from "path";
import * as p7 from "@clack/prompts";
import pc7 from "picocolors";
import { SeederEngine as SeederEngine3 } from "@api-seeder/core";
async function runRollback(configPath = "config.json", options = {}) {
  const resolvedConfigPath = path7.resolve(configPath);
  const basePath = path7.dirname(resolvedConfigPath);
  p7.intro(pc7.bgRed(pc7.black(" API Seeder ")) + pc7.bold(" Transactional Rollback"));
  let rawConfig;
  try {
    const content = await fs7.readFile(resolvedConfigPath, "utf-8");
    rawConfig = JSON.parse(content);
  } catch (err) {
    p7.cancel(pc7.red(`Failed to read configuration file at: ${resolvedConfigPath} (${err.message})`));
    process.exit(1);
  }
  if (!options.force && !options.dryRun) {
    const shouldContinue = await p7.confirm({
      message: pc7.yellow("Are you sure you want to rollback and DELETE all created entities recorded in cache?"),
      initialValue: false
    });
    if (p7.isCancel(shouldContinue) || !shouldContinue) {
      p7.cancel(pc7.dim("Rollback aborted by user. No deletions performed."));
      process.exit(0);
    }
  }
  const engine = new SeederEngine3(rawConfig, {
    workingDirectory: basePath
  });
  const spinner4 = p7.spinner();
  spinner4.start(options.dryRun ? "Simulating rollback (DRY-RUN)..." : "Executing entity deletions...");
  const startTime = Date.now();
  try {
    const result = await engine.rollback({
      dryRun: options.dryRun,
      force: options.force,
      workingDirectory: basePath,
      onProgress: (event) => {
        if (event.status === "deleted") {
          p7.log.info(pc7.cyan(`Deleted [${event.stepName}]: ${event.entityId} ${event.message || ""}`));
        } else if (event.status === "failed") {
          p7.log.error(pc7.red(`Failed to delete [${event.stepName}]: ${event.entityId} (${event.message})`));
        }
      }
    });
    spinner4.stop(options.dryRun ? "Rollback simulation completed" : "Rollback execution completed");
    const durationSec = ((Date.now() - startTime) / 1e3).toFixed(2);
    if (result.success) {
      p7.note(
        [
          `Entities deleted: ${pc7.bold(String(result.totalDeleted))}`,
          `Failures:         ${pc7.bold(String(result.totalFailed))}`,
          `Duration:         ${pc7.bold(`${durationSec}s`)}`,
          options.dryRun ? `Mode:             ${pc7.yellow("DRY-RUN SIMULATION")}` : `Cache:            ${pc7.green("CLEANED")}`
        ].join("\n"),
        pc7.green(pc7.bold("ROLLBACK COMPLETED"))
      );
    } else {
      p7.note(
        [
          `Entities deleted: ${pc7.bold(String(result.totalDeleted))}`,
          `Failures:         ${pc7.red(pc7.bold(String(result.totalFailed)))}`,
          `Duration:         ${pc7.bold(`${durationSec}s`)}`
        ].join("\n"),
        pc7.red(pc7.bold("ROLLBACK COMPLETED WITH ERRORS"))
      );
    }
    p7.outro(pc7.cyan("Rollback session finished."));
    if (!result.success) {
      process.exit(1);
    }
  } catch (err) {
    spinner4.stop("Rollback failed");
    p7.log.error(pc7.red(`Unexpected error during rollback: ${err.message}`));
    process.exit(1);
  }
}

// bin/api-seeder.ts
var program = new Command();
program.name("api-seeder").description("Industrial hierarchical Excel/CSV data ingestion & seed orchestrator for REST APIs").version("1.0.0");
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
program.command("studio").description("Launch the interactive local Web Studio (like Prisma Studio)").option("-p, --port <number>", "Port for local studio server", (val) => parseInt(val, 10), 4e3).option("-c, --config <path>", "Path to config.json", "./config.json").option("--no-open", "Do not automatically open browser on startup").action(async (options) => {
  await runStudio(options);
});
program.command("rollback").description("Rollback and delete all created entities recorded in cache").argument("[config]", "Path to config.json file", "config.json").option("--dry-run", "Simulate deletion without sending DELETE HTTP requests", false).option("--force", "Bypass interactive confirmation prompt", false).action(async (config, options) => {
  await runRollback(config, options);
});
program.parse(process.argv);
