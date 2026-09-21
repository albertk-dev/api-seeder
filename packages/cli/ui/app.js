// packages/cli/ui/app.js

/**
 * API Seeder Studio — Frontend Client Controller
 */

// Application State
const state = {
  config: null,
  activeStepIndex: 0,
  dryRun: false,
  isRunning: false,
  metrics: {
    created: 0,
    updated: 0,
    failed: 0,
    startTime: null,
  },
};

// DOM Elements Cache
const elements = {
  apiBaseUrl: document.getElementById('api-base-url'),
  stepsList: document.getElementById('steps-list'),
  stepCountBadge: document.getElementById('step-count-badge'),
  dryRunToggle: document.getElementById('dry-run-toggle'),
  dryRunDot: document.getElementById('dry-run-dot'),
  btnRunSync: document.getElementById('btn-run-sync'),
  btnValidate: document.getElementById('btn-validate'),
  btnTemplates: document.getElementById('btn-templates'),
  previewTitle: document.getElementById('preview-title'),
  previewTableHead: document.getElementById('preview-table-head'),
  previewTableBody: document.getElementById('preview-table-body'),
  previewRowCount: document.getElementById('preview-row-count'),
  logsTerminal: document.getElementById('logs-terminal'),
  terminalProgress: document.getElementById('terminal-progress'),
  metricCreated: document.getElementById('metric-created'),
  metricErrors: document.getElementById('metric-errors'),
  metricDuration: document.getElementById('metric-duration'),
  auditStatusText: document.getElementById('audit-status-text'),
};

/**
 * Initializes the studio interface.
 */
async function init() {
  bindEvents();
  await loadConfig();
}

/**
 * Binds UI event listeners.
 */
function bindEvents() {
  elements.btnRunSync.addEventListener('click', handleRunSync);
  elements.btnValidate.addEventListener('click', handleValidate);
  elements.btnTemplates.addEventListener('click', handleGenerateTemplates);

  elements.dryRunToggle.addEventListener('click', () => {
    state.dryRun = !state.dryRun;
    elements.dryRunDot.style.marginLeft = state.dryRun ? 'auto' : '0';
    elements.dryRunDot.className = state.dryRun
      ? 'w-3 h-3 rounded-full bg-amber-400 glow-amber transition-all ml-auto'
      : 'w-3 h-3 rounded-full bg-slate-500 transition-all';
    addLog(state.dryRun ? '[INFO] Dry-Run mode enabled (no API mutations)' : '[INFO] Live API mode enabled');
  });
}

/**
 * Loads and displays the configuration.
 */
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();

    if (data.error) {
      elements.apiBaseUrl.textContent = 'Config Error';
      elements.stepsList.innerHTML = `<div class="p-4 text-rose-400 font-mono text-xs">${data.error}</div>`;
      return;
    }

    state.config = data;
    elements.apiBaseUrl.textContent = data.api_base_url || 'https://api.example.com';
    elements.stepCountBadge.textContent = `${data.integration_steps.length} Steps Ready`;

    renderSteps();
    if (data.integration_steps.length > 0) {
      selectStep(0);
    }
  } catch (err) {
    addLog(`[ERR] Failed to load config: ${err.message}`, 'error');
  }
}

/**
 * Renders the pipeline DAG steps in the left column.
 */
function renderSteps() {
  const steps = state.config.integration_steps || [];
  elements.stepsList.innerHTML = '';

  steps.forEach((step, index) => {
    const isFocused = index === state.activeStepIndex;
    const card = document.createElement('div');

    card.className = `relative flex flex-col gap-2 p-3 rounded-lg cursor-pointer transition-all ${
      isFocused
        ? 'glass-card border-cyan-500/60 shadow-[0_0_12px_rgba(6,182,212,0.2)]'
        : 'bg-slate-900/60 border border-slate-800 hover:border-slate-700'
    }`;

    // Extract parent reference if available
    let parentRef = null;
    for (const val of Object.values(step.payload_mapping || {})) {
      if (typeof val === 'string' && (val.startsWith('${') || val.startsWith('$ref:'))) {
        parentRef = val;
        break;
      }
    }

    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full ${isFocused ? 'bg-cyan-400 animate-pulse' : 'bg-emerald-400'}"></span>
          <span class="font-mono text-xs font-bold text-slate-100">${index + 1}. ${step.name}</span>
        </div>
        <span class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 font-bold uppercase">
          ${step.method || 'POST'}
        </span>
      </div>
      <div class="flex items-center gap-1.5 text-slate-400 font-mono text-[11px] truncate">
        <span>📄</span>
        <span class="truncate">${step.source_file}</span>
      </div>
      ${
        parentRef
          ? `<div class="mt-1 px-2 py-1 rounded bg-slate-950/60 flex items-center justify-between font-mono text-[10px]">
              <span class="text-slate-500">Parent Ref:</span>
              <span class="text-blue-400 truncate max-w-[130px]">${parentRef}</span>
            </div>`
          : ''
      }
    `;

    card.addEventListener('click', () => selectStep(index));
    elements.stepsList.appendChild(card);

    // Add connector line between steps
    if (index < steps.length - 1) {
      const connector = document.createElement('div');
      connector.className = 'flex items-center justify-center my-1';
      connector.innerHTML = `
        <div class="flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-[10px] font-mono text-cyan-400/80">
          <span>↓</span>
          <span class="tracking-wider uppercase text-[9px]">Pass ID Map</span>
        </div>
      `;
      elements.stepsList.appendChild(connector);
    }
  });
}

/**
 * Selects an integration step and loads its spreadsheet preview.
 */
async function selectStep(index) {
  state.activeStepIndex = index;
  renderSteps();

  const step = state.config.integration_steps[index];
  if (!step) return;

  elements.previewTitle.textContent = `Spreadsheet Preview: ${step.source_file}`;
  elements.previewTableHead.innerHTML = '<tr><th class="p-3 text-slate-500">Loading headers...</th></tr>';
  elements.previewTableBody.innerHTML = '<tr><td class="p-4 text-center text-slate-500">Loading rows...</td></tr>';

  try {
    const res = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: step.source_file }),
    });

    const data = await res.json();
    if (data.error) {
      elements.previewTableBody.innerHTML = `<tr><td class="p-4 text-rose-400 font-mono text-xs">${data.error}</td></tr>`;
      return;
    }

    elements.previewRowCount.textContent = `Showing ${Math.min(data.sample.length, 15)} of ${data.totalRows} rows`;

    // Render Table Headers
    elements.previewTableHead.innerHTML = `
      <tr class="bg-slate-900 text-slate-400 uppercase tracking-wider text-[11px] font-mono">
        <th class="py-2 px-3 w-12 text-center border-b border-slate-800">#</th>
        ${data.headers
          .map((h) => `<th class="py-2 px-3 font-semibold text-slate-300 border-b border-slate-800">${h}</th>`)
          .join('')}
      </tr>
    `;

    // Render Table Rows
    elements.previewTableBody.innerHTML = data.sample
      .map(
        (row, rIdx) => `
        <tr class="hover:bg-slate-800/40 transition-colors ${rIdx % 2 === 0 ? 'bg-slate-950/30' : 'bg-slate-900/30'}">
          <td class="py-2 px-3 text-slate-500 font-mono text-center text-xs">${row.__rowNumber || rIdx + 2}</td>
          ${data.headers
            .map(
              (h) => `
            <td class="py-2 px-3 text-slate-300 font-mono text-xs border-b border-slate-900/60">
              ${row[h] !== undefined && row[h] !== '' ? row[h] : '<span class="text-slate-600">—</span>'}
            </td>
          `
            )
            .join('')}
        </tr>
      `
      )
      .join('');
  } catch (err) {
    elements.previewTableBody.innerHTML = `<tr><td class="p-4 text-rose-400 font-mono text-xs">Failed to load preview: ${err.message}</td></tr>`;
  }
}

/**
 * Starts synchronization with Server-Sent Events (SSE) stream.
 */
function handleRunSync() {
  if (state.isRunning) return;

  state.isRunning = true;
  state.metrics.created = 0;
  state.metrics.updated = 0;
  state.metrics.failed = 0;
  state.metrics.startTime = Date.now();

  elements.metricCreated.textContent = '0';
  elements.metricErrors.textContent = '0';
  elements.metricDuration.textContent = '0.00s';
  elements.logsTerminal.innerHTML = '';
  elements.terminalProgress.style.width = '0%';
  elements.btnRunSync.disabled = true;
  elements.btnRunSync.classList.add('opacity-50');

  addLog(
    `[INFO] Starting synchronization${state.dryRun ? ' (DRY-RUN SIMULATION)' : ''}...`,
    'info'
  );

  const streamUrl = `/api/run-stream?dryRun=${state.dryRun}`;
  const eventSource = new EventSource(streamUrl);

  eventSource.addEventListener('progress', (e) => {
    const prog = JSON.parse(e.data);
    const percent = Math.round((prog.currentRow / (prog.totalRows || 1)) * 100);
    elements.terminalProgress.style.width = `${percent}%`;

    const nowSec = ((Date.now() - state.metrics.startTime) / 1000).toFixed(2);
    elements.metricDuration.textContent = `${nowSec}s`;

    if (prog.status === 'success') {
      state.metrics.created++;
      elements.metricCreated.textContent = String(state.metrics.created);
      addLog(
        `[201 CREATED] ${prog.stepName} (Row ${prog.currentRow}/${prog.totalRows}) → ID: ${prog.entityId || 'OK'}`,
        'success'
      );
    } else if (prog.status === 'failed') {
      state.metrics.failed++;
      elements.metricErrors.textContent = String(state.metrics.failed);
      addLog(
        `[ERR REJECTED] ${prog.stepName} (Row ${prog.currentRow}/${prog.totalRows}): ${prog.message}`,
        'error'
      );
    } else if (prog.status === 'skipped') {
      addLog(`[SKIP] ${prog.stepName} (Row ${prog.currentRow}): ${prog.message || 'Skipped'}`, 'warn');
    }
  });

  eventSource.addEventListener('completed', (e) => {
    const result = JSON.parse(e.data);
    const duration = (result.durationMs / 1000).toFixed(2);
    elements.metricDuration.textContent = `${duration}s`;
    elements.terminalProgress.style.width = '100%';

    if (result.success) {
      addLog(`✔ Synchronization completed successfully in ${duration}s!`, 'success');
      elements.auditStatusText.textContent = 'Last execution passed with zero errors';
      elements.auditStatusText.className = 'text-xs text-emerald-400 font-medium';
    } else {
      addLog(`✖ Synchronization completed with ${result.totalFailed} failure(s).`, 'error');
      if (result.errorsReportPath) {
        addLog(`📊 Error audit generated: ${result.errorsReportPath}`, 'warn');
        elements.auditStatusText.textContent = `Report saved: ${result.errorsReportPath.split(/[\\/]/).pop()}`;
        elements.auditStatusText.className = 'text-xs text-rose-400 font-medium';
      }
    }

    eventSource.close();
    state.isRunning = false;
    elements.btnRunSync.disabled = false;
    elements.btnRunSync.classList.remove('opacity-50');
  });

  eventSource.addEventListener('error', () => {
    addLog('[ERR] Connection to synchronization stream closed.', 'error');
    eventSource.close();
    state.isRunning = false;
    elements.btnRunSync.disabled = false;
    elements.btnRunSync.classList.remove('opacity-50');
  });
}

/**
 * Validates the schema and file columns.
 */
async function handleValidate() {
  addLog('[INFO] Validating schema and spreadsheet columns...', 'info');
  try {
    const res = await fetch('/api/validate', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      addLog('✔ Schema and all column mappings are 100% sound!', 'success');
    } else {
      addLog(`✖ Validation failed: ${data.error || 'Check columns and paths'}`, 'error');
    }
  } catch (err) {
    addLog(`[ERR] Validation error: ${err.message}`, 'error');
  }
}

/**
 * Triggers Excel template generation.
 */
async function handleGenerateTemplates() {
  addLog('[INFO] Generating blank Excel template sheets...', 'info');
  try {
    const res = await fetch('/api/templates', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      addLog(`✔ Generated ${data.count} templates in directory: ${data.outputDir}`, 'success');
    } else {
      addLog(`✖ Template generation error: ${data.error}`, 'error');
    }
  } catch (err) {
    addLog(`[ERR] Template error: ${err.message}`, 'error');
  }
}

/**
 * Appends a line to the terminal log stream.
 */
function addLog(text, level = 'info') {
  const line = document.createElement('div');
  line.className = 'flex items-start gap-2 text-xs font-mono';

  const time = new Date().toISOString().slice(11, 19);

  let colorClass = 'text-slate-400';
  if (level === 'success') colorClass = 'text-emerald-400 font-semibold';
  if (level === 'error') colorClass = 'text-rose-400 font-semibold';
  if (level === 'warn') colorClass = 'text-amber-400';

  line.innerHTML = `<span class="text-slate-600 select-none">[${time}]</span> <span class="${colorClass}">${text}</span>`;
  elements.logsTerminal.appendChild(line);
  elements.logsTerminal.scrollTop = elements.logsTerminal.scrollHeight;
}

// Start application
window.addEventListener('DOMContentLoaded', init);
