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
  btnInspectConfig: document.getElementById('btn-inspect-config'),
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
  // Modal & Inspector Elements
  modalBackdrop: document.getElementById('config-modal-backdrop'),
  modalPanel: document.getElementById('config-modal-panel'),
  modalCloseBtn: document.getElementById('modal-close-btn'),
  modalDragHandle: document.getElementById('modal-drag-handle'),
  tabBtnVisual: document.getElementById('tab-btn-visual'),
  tabBtnRaw: document.getElementById('tab-btn-raw'),
  tabContentVisual: document.getElementById('tab-content-visual'),
  tabContentRaw: document.getElementById('tab-content-raw'),
  configJsonDisplay: document.getElementById('config-json-display'),
  btnCopyJson: document.getElementById('btn-copy-json'),
  copyBtnLabel: document.getElementById('copy-btn-label'),
};

/**
 * Initializes the studio interface.
 */
async function init() {
  bindEvents();
  setupConfigModal();
  await loadConfig();
}

/**
 * Binds UI event listeners.
 */
function bindEvents() {
  elements.btnRunSync.addEventListener('click', handleRunSync);
  elements.btnValidate.addEventListener('click', handleValidate);
  elements.btnTemplates.addEventListener('click', handleGenerateTemplates);

  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      addLog('[INFO] Reloading pipeline configuration...', 'info');
      await loadConfig();
    });
  }

  const tableSearch = document.getElementById('table-search');
  if (tableSearch) {
    tableSearch.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      const rows = elements.previewTableBody.querySelectorAll('tr');
      rows.forEach((row) => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
      });
    });
  }

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
      if (typeof val === 'string' && (val.startsWith('@') || val.startsWith('${'))) {
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
        <svg class="w-3.5 h-3.5 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
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
          <svg class="w-2.5 h-2.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"/>
          </svg>
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
      addLog(`[OK] Synchronization completed successfully in ${duration}s!`, 'success');
      elements.auditStatusText.textContent = 'Last execution passed with zero errors';
      elements.auditStatusText.className = 'text-xs text-emerald-400 font-medium';
    } else {
      addLog(`[FAIL] Synchronization completed with ${result.totalFailed} failure(s).`, 'error');
      if (result.errorsReportPath) {
        addLog(`[REPORT] Error audit generated: ${result.errorsReportPath}`, 'warn');
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
      addLog('[OK] Schema and all column mappings are 100% sound!', 'success');
    } else {
      addLog(`[FAIL] Validation failed: ${data.error || 'Check columns and paths'}`, 'error');
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
      addLog(`[OK] Generated ${data.count} templates in directory: ${data.outputDir}`, 'success');
    } else {
      addLog(`[FAIL] Template generation error: ${data.error}`, 'error');
    }
  } catch (err) {
    addLog(`[ERR] Template error: ${err.message}`, 'error');
  }
}

/**
 * Configures the responsive Config Inspector modal (Desktop) and bottom-sheet (Mobile).
 */
function setupConfigModal() {
  if (!elements.btnInspectConfig || !elements.modalBackdrop) return;

  // Open modal / bottom sheet
  elements.btnInspectConfig.addEventListener('click', openConfigModal);

  // Close modal triggers
  elements.modalCloseBtn?.addEventListener('click', closeConfigModal);
  elements.modalDragHandle?.addEventListener('click', closeConfigModal);
  elements.modalBackdrop.addEventListener('click', (e) => {
    if (e.target === elements.modalBackdrop) closeConfigModal();
  });

  // Close on Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elements.modalBackdrop.classList.contains('active')) {
      closeConfigModal();
    }
  });

  // Tab switching: Visual View vs Raw JSON
  elements.tabBtnVisual?.addEventListener('click', () => switchModalTab('visual'));
  elements.tabBtnRaw?.addEventListener('click', () => switchModalTab('raw'));

  // Copy Raw JSON to Clipboard
  elements.btnCopyJson?.addEventListener('click', () => {
    if (!state.config) return;
    navigator.clipboard.writeText(JSON.stringify(state.config, null, 2)).then(() => {
      elements.copyBtnLabel.textContent = 'Copied!';
      setTimeout(() => {
        elements.copyBtnLabel.textContent = 'Copy JSON';
      }, 2000);
    });
  });
}

/**
 * Opens the configuration inspector and renders the latest config data.
 */
function openConfigModal() {
  if (!state.config) return;
  renderVisualConfig(state.config);
  elements.configJsonDisplay.textContent = JSON.stringify(state.config, null, 2);

  elements.modalBackdrop.classList.add('active');
  elements.modalPanel.classList.add('active');
  document.body.style.overflow = 'hidden';
}

/**
 * Closes the configuration inspector.
 */
function closeConfigModal() {
  elements.modalBackdrop.classList.remove('active');
  elements.modalPanel.classList.remove('active');
  document.body.style.overflow = '';
}

/**
 * Switches between Visual View and Raw JSON tabs.
 */
function switchModalTab(tab) {
  if (tab === 'visual') {
    elements.tabBtnVisual.className = 'px-2.5 py-1 rounded-md font-medium text-cyan-400 bg-slate-800 shadow-sm transition';
    elements.tabBtnRaw.className = 'px-2.5 py-1 rounded-md font-medium text-slate-400 hover:text-slate-200 transition';
    elements.tabContentVisual.classList.remove('hidden');
    elements.tabContentRaw.classList.add('hidden');
  } else {
    elements.tabBtnRaw.className = 'px-2.5 py-1 rounded-md font-medium text-cyan-400 bg-slate-800 shadow-sm transition';
    elements.tabBtnVisual.className = 'px-2.5 py-1 rounded-md font-medium text-slate-400 hover:text-slate-200 transition';
    elements.tabContentRaw.classList.remove('hidden');
    elements.tabContentVisual.classList.add('hidden');
  }
}

/**
 * Renders the visual representation of the configuration.
 */
function renderVisualConfig(cfg) {
  if (!elements.tabContentVisual) return;

  const steps = cfg.integration_steps || [];
  const headers = cfg.global_headers || {};

  elements.tabContentVisual.innerHTML = `
    <!-- Top System Card: Target API & Global Settings -->
    <div class="p-4 rounded-xl bg-[#090D16] border border-slate-800 flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-emerald-400 glow-emerald"></span>
          <span class="text-xs font-mono text-slate-400">Target Base URL:</span>
          <span class="text-xs font-mono font-bold text-cyan-400 select-all">${cfg.api_base_url || 'N/A'}</span>
        </div>
        <div class="flex items-center gap-2 font-mono text-[11px]">
          <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
            ID Cache: <strong class="${cfg.use_id_cache ? 'text-emerald-400' : 'text-slate-500'}">${cfg.use_id_cache ? 'Enabled' : 'Disabled'}</strong>
          </span>
          ${cfg.id_cache_file ? `<span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">${cfg.id_cache_file}</span>` : ''}
        </div>
      </div>

      <!-- Global Headers Pills -->
      <div class="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5">
        <span class="text-[11px] font-mono text-slate-500">Headers:</span>
        ${
          Object.keys(headers).length > 0
            ? Object.entries(headers)
                .map(
                  ([k, v]) => `
              <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-[11px] text-slate-300">
                <span class="text-slate-400">${k}:</span> <span class="text-cyan-400">${String(v).slice(0, 24)}${String(v).length > 24 ? '...' : ''}</span>
              </span>`
                )
                .join('')
            : '<span class="text-xs text-slate-600 font-mono">None</span>'
        }
      </div>
    </div>

    <!-- Pipeline Steps Architecture Cards -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">
          Sequential Ingestion Stages (${steps.length})
        </span>
      </div>

      ${steps
        .map((step, idx) => {
          const mappings = Object.entries(step.payload_mapping || {});
          return `
        <div class="p-4 rounded-xl bg-[#090D16] border border-slate-800 hover:border-slate-700 transition flex flex-col gap-3">
          <!-- Step Header -->
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2.5">
              <span class="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-mono text-[11px] text-cyan-400 font-bold">
                ${idx + 1}
              </span>
              <span class="font-bold text-sm text-slate-100 font-mono">${step.name}</span>
              <span class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono text-cyan-400 font-bold uppercase">
                ${step.method || 'POST'}
              </span>
            </div>

            <div class="flex items-center gap-2 font-mono text-[11px]">
              <span class="text-slate-400">Endpoint:</span>
              <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-200">${step.endpoint}</span>
            </div>
          </div>

          <!-- Step Meta: Source file & Unique key -->
          <div class="flex flex-wrap items-center gap-3 text-xs font-mono text-slate-400 bg-slate-950/50 p-2 rounded-lg border border-slate-900">
            <div class="flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              <span>Source: <strong class="text-slate-300">${step.source_file}</strong></span>
            </div>
            <span class="text-slate-700">|</span>
            <div>Unique Key: <strong class="text-emerald-400">${step.unique_identifier}</strong></div>
          </div>

          <!-- Payload Mapping Grid -->
          <div class="rounded-lg border border-slate-800/80 overflow-hidden">
            <table class="w-full text-left text-xs font-mono">
              <thead class="bg-slate-900/80 text-slate-400 text-[10px] uppercase">
                <tr>
                  <th class="py-1.5 px-3">Target Payload Key</th>
                  <th class="py-1.5 px-3">Resolution Formula / Field</th>
                  <th class="py-1.5 px-3 text-right">Type</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/40 text-slate-300">
                ${mappings
                  .map(([k, v]) => {
                    let typeBadge = '<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Direct</span>';
                    let valDisplay = `<span class="text-slate-300">${v}</span>`;

                    if (typeof v === 'string' && (v.startsWith('@') || v.startsWith('${'))) {
                      typeBadge = '<span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">Lookup ID</span>';
                      valDisplay = `<span class="text-blue-400 font-semibold">${v}</span>`;
                    } else if (typeof v === 'string' && v.includes('{{')) {
                      typeBadge = '<span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">Template</span>';
                      valDisplay = `<span class="text-purple-400">${v}</span>`;
                    }

                    return `
                  <tr class="hover:bg-slate-800/30">
                    <td class="py-1.5 px-3 font-semibold text-cyan-400">${k}</td>
                    <td class="py-1.5 px-3">${valDisplay}</td>
                    <td class="py-1.5 px-3 text-right">${typeBadge}</td>
                  </tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>`;
        })
        .join('')}
    </div>
  `;
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

