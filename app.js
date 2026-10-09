// ============================================================
// WEDDING PLANNER — COMPANION APP
//
// Schema-driven. Every route is a sheet in the workbook.
// The sidebar is built from _app_config via the Apps Script API.
//
// Design principles:
//   - Inline editing everywhere. No modal.
//   - Optimistic updates on checkbox toggles.
//   - Search + category filters on every list.
//   - "+ Add" opens a strip below the search bar, not a modal.
// ============================================================

const CONFIG = window.WEDDING_CONFIG;

// ---------- Global state ----------

const state = {
  schema: [],           // [{ sheet, label, ..., view, ... }]
  route: null,          // current sheet name or '_overview'
  data: {},             // { sheetName: [rows] }
  search: {},           // { sheetName: 'query' }
  filter: {},           // { sheetName: 'Category value or All' }
  expanded: null,       // "sheetName:id" of the open row
  booted: false
};

// ---------- DOM shortcuts ----------

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

// ============================================================
// API HELPERS
// ============================================================

async function apiGetSchema() {
  const url = `${CONFIG.apiUrl}?secret=${encodeURIComponent(CONFIG.secret)}&schema=true`;
  return (await fetch(url)).json();
}

async function apiGetOverview() {
  const url = `${CONFIG.apiUrl}?secret=${encodeURIComponent(CONFIG.secret)}&overview=true`;
  return (await fetch(url)).json();
}

async function apiGetRows(sheetName) {
  const url = `${CONFIG.apiUrl}?secret=${encodeURIComponent(CONFIG.secret)}&sheet=${encodeURIComponent(sheetName)}`;
  return (await fetch(url)).json();
}

/**
 * Writes to the sheet. `row` is the physical row number from the API's
 * `_row` field. Passing it lets the server update the exact row without
 * having to look it up by ID — critical for sheets whose column 1 is a
 * checkbox and has no meaningful ID.
 */
async function apiWrite(action, sheetName, data, id, row) {
  const body = JSON.stringify({
    secret: CONFIG.secret,
    sheet: sheetName,
    action,
    data,
    id,
    row
  });
  return (await fetch(CONFIG.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body
  })).json();
}

// ============================================================
// UTILITY HELPERS
// ============================================================

function currentSchema() {
  return state.schema.find(s => s.sheet === state.route);
}

function setStatus(text) {
  const el = $('#status');
  if (el) el.textContent = text;
}

function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2400);
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n) {
  const num = Number(n || 0);
  return '₦' + num.toLocaleString();
}

function fmtDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date)) return String(d);
  return date.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

function fmtDateShort(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date)) return String(d);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isChecked(v) {
  return v === true || v === 'TRUE' || v === 'true'
    || v === 'Yes' || v === 'yes' || v === 1;
}

function daysUntil(dateStr) {
  const target = parseSheetDate(dateStr);
  if (!target) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

/**
 * Parses a value coming from a Google Sheet cell and returns a Date
 * at local midnight. Handles:
 *   - ISO strings:      "2026-06-14T00:00:00.000Z"
 *   - plain dates:      "2026-06-14"
 *   - human strings:    "June 14, 2026"
 * Returns null if unparseable.
 */
function parseSheetDate(val) {
  if (val == null || val === '') return null;
  const s = String(val);

  // Take just the YYYY-MM-DD prefix, ignore time and timezone
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const d = new Date(s);
  return isNaN(d) ? null : d;
}

/**
 * Formats a date value as "Sunday, June 14, 2026".
 * Falls back to the raw string if the value can't be parsed.
 */
function fmtLongDate(val) {
  const d = parseSheetDate(val);
  if (!d) return val ? String(val) : '—';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Normalizes a date value to "YYYY-MM-DD" for an <input type="date">.
 */
function toISODate(val) {
  const d = parseSheetDate(val);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/**
 * A stable key for a row. Prefers the value of the configured id column;
 * falls back to the physical spreadsheet row.
 */
function rowId(row, schema) {
  const idField = (schema.columns || [])[schema.idColumn - 1];
  if (idField && row[idField] !== undefined && row[idField] !== '') {
    return row[idField];
  }
  return row._row;
}

/**
 * Auto-detects which column plays which role, unless _app_config
 * already overrode them.
 */
const CHECK_RE = /^(returned|packed|done|thanked|arrived|signed|completed|bought|booked|received|sent|paid|got it|decided)$/i;
const NAME_RE = /^(name|names|item|task|thing|vendor|description|title|what|guest|company|chore|question)$/i;
const STATUS_RE = /(status|stage|response|state|category)/i;
const DATE_RE = /(date|due|when|deadline)/i;

function detectFieldRoles(schema) {
  const cols = schema.columns || [];
  return {
    checkField: schema.checkField || cols.find(c => CHECK_RE.test(c)) || '',
    nameField: schema.nameField || cols.find(c => NAME_RE.test(c)) || cols[0] || '',
    statusField: schema.statusField || cols.find(c => STATUS_RE.test(c)) || '',
    dateField: schema.dateField || cols.find(c => DATE_RE.test(c)) || ''
  };
}

function guessType(name, value) {
  if (/date/i.test(name)) return 'date';
  if (/notes?|comment|detail|description/i.test(name)) return 'textarea';
  if (typeof value === 'boolean') return 'checkbox';
  if (/price|cost|amount|number|count|budgeted|actual|deposit/i.test(name)) return 'number';
  if (/response|status|category|stage/i.test(name)) return 'select';
  return 'text';
}

// ============================================================
// SHARED RENDER BUILDING BLOCKS
// ============================================================

function renderStats(stats) {
  return `
    <div class="stats">
      ${stats.map(s => `
        <div class="stat">
          <div class="stat-label">${escapeHtml(s.label)}</div>
          <div class="stat-value">${s.value}</div>
          ${s.hint ? `<div class="stat-hint">${escapeHtml(s.hint)}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function renderProgress(pct, label) {
  const clamped = Math.max(0, Math.min(100, pct || 0));
  return `
    <div class="progress-wrap">
      ${label ? `<div class="progress-label">${escapeHtml(label)}</div>` : ''}
      <div class="progress-track">
        <div class="progress-fill" style="width:${clamped}%"></div>
      </div>
      <div class="progress-pct">${Math.round(clamped)}%</div>
    </div>
  `;
}

function renderField(field, value, compact = false) {
  const id = 'f-' + Math.random().toString(36).slice(2, 9);
  const name = escapeHtml(field.name);
  const label = field.label || field.name;
  const type = field.type || 'text';

  if (type === 'checkbox') {
    return `<label class="field field-checkbox" for="${id}">
      <input type="checkbox" id="${id}" name="${name}" ${isChecked(value) ? 'checked' : ''}>
      <span>${escapeHtml(label)}</span>
    </label>`;
  }

  let input;
  if (field.options && field.options.length) {
    input = `<select id="${id}" name="${name}">
      <option value=""></option>
      ${field.options.map(o =>
      `<option value="${escapeHtml(o)}" ${o === value ? 'selected' : ''}>${escapeHtml(o)}</option>`
    ).join('')}
    </select>`;
  } else if (type === 'textarea') {
    input = `<textarea id="${id}" name="${name}" rows="2">${escapeHtml(value ?? '')}</textarea>`;
  } else {
    input = `<input id="${id}" name="${name}" type="${type}" value="${escapeHtml(value ?? '')}">`;
  }

  const cls = compact ? 'field field-compact' : 'field';
  return `<div class="${cls}"><label for="${id}">${escapeHtml(label)}</label>${input}</div>`;
}

function readForm(root) {
  const data = {};
  $$('input, select, textarea', root).forEach(el => {
    if (!el.name) return;
    if (el.type === 'checkbox') data[el.name] = el.checked;
    else if (el.type === 'number') data[el.name] = el.value === '' ? '' : Number(el.value);
    else data[el.name] = el.value.trim();
  });
  return data;
}

// ============================================================
// DISPATCHER
// ============================================================

const VIEWS = {
  'renderOverview': renderOverview,
  'renderTimeline': renderTimeline,
  'renderQuickList': renderQuickList,
  'renderBudget': renderBudget,
  'renderGuests': renderGuests,
  'renderGifts': renderGifts
};

async function render() {
  if (state.route === '_overview') return renderOverview();

  const schema = currentSchema();
  if (!schema) {
    $('#view').innerHTML = '<h1>Sheet not found</h1><p>This route is not configured.</p>';
    return;
  }

  if (schema.type === 'link') return renderLinkView(schema);

  const fn = VIEWS[schema.view] || renderQuickList;
  await fn(schema);
}

// ============================================================
// VIEW: OVERVIEW
// ============================================================

async function renderOverview() {
  setStatus('Loading overview…');
  try {
    const res = await apiGetOverview();
    if (res.error) throw new Error(res.error);
    const { meta = {}, metaGrouped = {}, stats = {} } = res;

    const days = daysUntil(meta.wedding_date);
    const coupleGroup = metaGrouped.Couple || [];
    const coupleName = (coupleGroup.find(x => x.key === 'couple_names') || {}).value || '—';
    const hashtag = (coupleGroup.find(x => x.key === 'hashtag') || {}).value || '';
    const datesGroup = metaGrouped.Dates || [];

    const budgetUsedPct = stats.budget_budgeted
      ? (stats.budget_actual / stats.budget_budgeted) * 100 : 0;
    const guestPct = stats.guests_total
      ? (stats.guests_coming / stats.guests_total) * 100 : 0;
    const planPct = stats.planning_total
      ? (stats.planning_done / stats.planning_total) * 100 : 0;
    const bridalPct = stats.bridal_total
      ? (stats.bridal_done / stats.bridal_total) * 100 : 0;

    $('#view').innerHTML = `
      <h1>Overview</h1>

      <div class="hero">
        <div class="hero-left">
          <div class="hero-couple">${escapeHtml(coupleName)}</div>
          <div class="hero-date">${escapeHtml(fmtLongDate(meta.wedding_date))}</div>
          <div class="hero-venue">${escapeHtml(meta.wedding_venue_name || meta.reception_venue_name || '')}</div>
          ${hashtag ? `<div class="hero-hashtag">${escapeHtml(hashtag)}</div>` : ''}
        </div>
        <div class="hero-right">
          <div class="hero-days">${days == null ? '—' : days}</div>
          <div class="hero-days-label">${days === 1 ? 'day to go' : 'days to go'}</div>
        </div>
      </div>

      ${datesGroup.length ? `
        <h2>Key dates</h2>
        <table class="info-table meta-table"><tbody>
          ${datesGroup.map(d => renderMetaRow('Dates', d)).join('')}
        </tbody></table>
      ` : ''}

      <h2>Progress</h2>
      ${renderStats([
      { label: 'Guests confirmed', value: `${stats.guests_coming || 0} / ${stats.guests_total || 0}` },
      { label: 'Budget spent', value: `${Math.round(budgetUsedPct)}%` },
      { label: 'Plan tasks done', value: `${stats.planning_done || 0} / ${stats.planning_total || 0}` },
      { label: 'Bridal tasks done', value: `${stats.bridal_done || 0} / ${stats.bridal_total || 0}` }
    ])}

      ${stats.planning_total ? renderProgress(planPct, 'Planning schedule') : ''}
      ${stats.bridal_total ? renderProgress(bridalPct, 'Bridal list') : ''}
      ${stats.guests_total ? renderProgress(guestPct, 'Guest confirmations') : ''}
      ${stats.budget_budgeted ? renderProgress(budgetUsedPct, 'Budget used') : ''}

      ${Object.entries(metaGrouped)
        .filter(([group]) => group !== 'Dates')
        .map(([group, items]) => `
          <div class="meta-group">
            <div class="meta-group-name">${escapeHtml(group)}</div>
            <table class="info-table meta-table"><tbody>
              ${items.map(it => renderMetaRow(group, it)).join('')}
            </tbody></table>
          </div>
        `).join('')}
    `;

    bindOverviewMeta();
    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed');
    toast('Could not load overview: ' + err.message);
  }
}



// ============================================================
// VIEW: TIMELINE (Planning Schedule)
// ============================================================

async function renderTimeline(schema) {
  setStatus('Loading timeline…');
  try {
    const res = await apiGetRows(schema.sheet);
    if (res.error) throw new Error(res.error);
    const rows = res.rows || [];
    state.data[schema.sheet] = rows;

    if (rows.length > 0 && !schema.columns) {
      schema.columns = Object.keys(rows[0]).filter(k => k !== '_row');
    }
    const cols = schema.columns || [];
    const roles = detectFieldRoles(schema);
    Object.assign(schema, roles);

    const doneCol = roles.checkField;
    const phaseCol = cols.find(c => /phase|section|stage/i.test(c)) || '';
    const total = rows.length;
    const doneCount = doneCol ? rows.filter(r => isChecked(r[doneCol])).length : 0;
    const pct = total ? (doneCount / total) * 100 : 0;

    // Group by phase, then sort within phase by date
    const groups = {};
    rows.forEach(r => {
      const phase = phaseCol ? (r[phaseCol] || 'Unscheduled') : 'All tasks';
      if (!groups[phase]) groups[phase] = [];
      groups[phase].push(r);
    });

    const phaseOrder = phaseCol
      ? Object.keys(groups).sort((a, b) => {
        // Keep insertion order for phases as they appear in the sheet
        const ia = rows.findIndex(r => (r[phaseCol] || 'Unscheduled') === a);
        const ib = rows.findIndex(r => (r[phaseCol] || 'Unscheduled') === b);
        return ia - ib;
      })
      : Object.keys(groups);

    $('#view').innerHTML = `
      <div class="toolbar">
        <h1>${escapeHtml(schema.label)}</h1>
        <button class="btn btn-primary" id="tl-add">+ Add task</button>
      </div>

      ${renderStats([
      { label: 'Total', value: total },
      { label: 'Done', value: doneCount },
      { label: 'Left', value: total - doneCount }
    ])}

      ${renderProgress(pct, 'Progress')}

      <div id="tl-add-strip"></div>

      ${phaseOrder.map(phase => {
      const tasks = groups[phase];
      const phaseDone = doneCol ? tasks.filter(t => isChecked(t[doneCol])).length : 0;
      const phasePct = tasks.length ? (phaseDone / tasks.length) * 100 : 0;

      return `
          <h2>${escapeHtml(phase)}</h2>
          ${renderProgress(phasePct, '')}
          <div class="ql-list">
            ${tasks.map(t => renderTimelineRow(t, schema, roles)).join('')}
          </div>
        `;
    }).join('')}
    `;

    bindTimeline(schema, roles);
    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed');
    toast(err.message);
  }
}

function renderTimelineRow(row, schema, roles) {
  const id = rowId(row, schema);
  const key = schema.sheet + ':' + id;
  const expanded = state.expanded === key;
  const checked = roles.checkField ? isChecked(row[roles.checkField]) : false;
  const name = row[roles.nameField] || '—';
  const dateVal = roles.dateField ? row[roles.dateField] : '';
  const overdue = dateVal && !checked && (daysUntil(dateVal) ?? 1) < 0;

  return `
    <div class="ql-row ${checked ? 'done' : ''} ${expanded ? 'expanded' : ''}"
         data-id="${escapeHtml(String(id))}" data-row="${row._row}">
      <div class="ql-row-main">
        ${roles.checkField ? `
          <button type="button" class="ql-check ${checked ? 'on' : ''}"
                  data-action="toggle" aria-label="Toggle">
            ${checked ? '✓' : ''}
          </button>` : ''}
        <div class="ql-row-info" data-action="expand">
          <div class="ql-row-name">${escapeHtml(name)}</div>
          ${dateVal ? `
            <div class="ql-row-meta">
              <span class="ql-row-date ${overdue ? 'overdue' : ''}">${escapeHtml(fmtDateShort(dateVal))}</span>
            </div>` : ''}
        </div>
        <button type="button" class="ql-more" data-action="expand" aria-label="More">⋯</button>
      </div>
      ${expanded ? renderInlineEditor(row, schema) : ''}
    </div>
  `;
}

function bindTimeline(schema, roles) {
  bindQuickListCommon(schema, roles, 'tl-add', 'tl-add-strip');
}

// ============================================================
// VIEW: QUICK LIST (Bridal, Rentals, Venue Run, New Home Run)
// ============================================================

async function renderQuickList(schema) {
  setStatus('Loading…');
  try {
    const res = await apiGetRows(schema.sheet);
    if (res.error) throw new Error(res.error);
    const rows = res.rows || [];
    state.data[schema.sheet] = rows;

    if (rows.length > 0 && !schema.columns) {
      schema.columns = Object.keys(rows[0]).filter(k => k !== '_row');
    }
    const cols = schema.columns || [];
    const roles = detectFieldRoles(schema);
    Object.assign(schema, roles);

    const q = (state.search[schema.sheet] || '').toLowerCase();
    const filtered = q
      ? rows.filter(r => cols.some(c => String(r[c] ?? '').toLowerCase().includes(q)))
      : rows;

    const doneCount = roles.checkField
      ? rows.filter(r => isChecked(r[roles.checkField])).length
      : 0;
    const pct = rows.length && roles.checkField
      ? (doneCount / rows.length) * 100
      : 0;

    $('#view').innerHTML = `
      <div class="toolbar">
        <h1>${escapeHtml(schema.label)}</h1>
        <button class="btn btn-primary" id="ql-add">+ Add</button>
      </div>

      <div class="ql-controls">
        <input type="search" id="ql-search" placeholder="Search…"
               value="${escapeHtml(state.search[schema.sheet] || '')}">
      </div>

      <div id="ql-add-strip"></div>

      ${roles.checkField ? `
        <div class="ql-progress">
          <div class="progress-track">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
          <div class="ql-progress-text">${doneCount} / ${rows.length} done</div>
        </div>
      ` : `
        <div class="ql-progress-text ql-count">${rows.length} item${rows.length === 1 ? '' : 's'}</div>
      `}

      <div class="ql-list" id="ql-list">
        ${filtered.length === 0
        ? `<div class="ql-empty">${q ? 'No matches' : 'Nothing yet — tap <b>+ Add</b> to start'}</div>`
        : filtered.map(r => renderQuickRow(r, schema, roles)).join('')}
      </div>
    `;

    bindQuickListCommon(schema, roles, 'ql-add', 'ql-add-strip');

    const search = $('#ql-search');
    if (search) search.oninput = debounce(() => {
      state.search[schema.sheet] = search.value;
      renderQuickList(schema);
    }, 200);

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed');
    toast(err.message);
  }
}

function renderQuickRow(row, schema, roles) {
  const id = rowId(row, schema);
  const key = schema.sheet + ':' + id;
  const expanded = state.expanded === key;
  const checked = roles.checkField ? isChecked(row[roles.checkField]) : false;
  const name = row[roles.nameField] || '—';
  const status = roles.statusField ? row[roles.statusField] : '';
  const dateVal = roles.dateField ? row[roles.dateField] : '';
  const overdue = dateVal && !checked && (daysUntil(dateVal) ?? 1) < 0;

  return `
    <div class="ql-row ${checked ? 'done' : ''} ${expanded ? 'expanded' : ''}"
         data-id="${escapeHtml(String(id))}" data-row="${row._row}">
      <div class="ql-row-main">
        ${roles.checkField ? `
          <button type="button" class="ql-check ${checked ? 'on' : ''}"
                  data-action="toggle" aria-label="Toggle">
            ${checked ? '✓' : ''}
          </button>` : ''}
        <div class="ql-row-info" data-action="expand">
          <div class="ql-row-name">${escapeHtml(name)}</div>
          ${(status || dateVal) ? `
            <div class="ql-row-meta">
              ${status ? `<span class="pill">${escapeHtml(String(status))}</span>` : ''}
              ${dateVal ? `<span class="ql-row-date ${overdue ? 'overdue' : ''}">${escapeHtml(fmtDateShort(dateVal))}</span>` : ''}
            </div>` : ''}
        </div>
        <button type="button" class="ql-more" data-action="expand" aria-label="More">⋯</button>
      </div>
      ${expanded ? renderInlineEditor(row, schema) : ''}
    </div>
  `;
}

function renderInlineEditor(row, schema) {
  const cols = schema.columns || [];
  const fields = (schema.fields && schema.fields.length)
    ? schema.fields
    : cols.map(c => ({ name: c, label: c, type: guessType(c, row[c]) }));

  return `
    <div class="ql-editor">
      ${fields.map(f => renderField(f, row[f.name])).join('')}
      <div class="ql-editor-actions">
        <button type="button" class="btn btn-danger" data-action="delete">Delete</button>
        <button type="button" class="btn" data-action="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="save">Save</button>
      </div>
    </div>
  `;
}

// ---------- shared event binding ----------

function bindQuickListCommon(schema, roles, addBtnId, stripId) {
  const list = $('#ql-list');
  const addBtn = $('#' + addBtnId);
  const strip = $('#' + stripId);

  if (addBtn) addBtn.onclick = () => showQuickAdd(schema, roles, strip);

  // Rows are rendered in multiple containers (timeline has one per phase);
  // bind via the view root so we catch all of them.
  const view = $('#view');
  if (!view) return;

  view.onclick = async (e) => {
    const rowEl = e.target.closest('.ql-row');
    if (!rowEl) return;
    const id = rowEl.dataset.id;
    const action = e.target.closest('[data-action]')?.dataset.action;

    if (action === 'toggle') return toggleCheck(schema, roles, id, rowEl);
    if (action === 'expand') return toggleExpand(schema, id);
    if (action === 'save') return saveInline(schema, id, rowEl);
    if (action === 'cancel') { state.expanded = null; return render(); }
    if (action === 'delete') {
      if (!confirm('Delete this item?')) return;
      const res = await apiWrite('delete', schema.sheet, null, id, rowEl.dataset.row);
      if (res.error) return toast('Delete failed: ' + res.error);
      state.expanded = null;
      toast('Deleted');
      render();
    }
  };
}

function toggleExpand(schema, id) {
  const key = schema.sheet + ':' + id;
  state.expanded = state.expanded === key ? null : key;
  render();
}

async function toggleCheck(schema, roles, id, rowEl) {
  if (!roles.checkField) return;
  const row = state.data[schema.sheet].find(r => String(rowId(r, schema)) === String(id));
  if (!row) return;

  const newVal = !isChecked(row[roles.checkField]);
  row[roles.checkField] = newVal;

  // Optimistic UI
  rowEl.classList.toggle('done', newVal);
  const btn = rowEl.querySelector('.ql-check');
  if (btn) {
    btn.classList.toggle('on', newVal);
    btn.textContent = newVal ? '✓' : '';
  }

  const res = await apiWrite('update', schema.sheet,
    { [roles.checkField]: newVal }, id, row._row);

  if (res.error) {
    row[roles.checkField] = !newVal;
    rowEl.classList.toggle('done', !newVal);
    if (btn) {
      btn.classList.toggle('on', !newVal);
      btn.textContent = !newVal ? '✓' : '';
    }
    toast('Save failed: ' + res.error);
  }
}

async function saveInline(schema, id, rowEl) {
  const editor = rowEl.querySelector('.ql-editor');
  if (!editor) return;
  const data = readForm(editor);
  const res = await apiWrite('update', schema.sheet, data, id, rowEl.dataset.row);
  if (res.error) return toast('Save failed: ' + res.error);
  state.expanded = null;
  toast('Saved');
  render();
}

function showQuickAdd(schema, roles, stripEl) {
  if (!stripEl) return;
  if (stripEl.firstChild) { stripEl.innerHTML = ''; return; }

  const cols = schema.columns || [];
  const quickFieldNames = (schema.quickAdd && schema.quickAdd.length)
    ? schema.quickAdd
    : [roles.nameField, roles.statusField, roles.dateField].filter(Boolean);

  const fields = quickFieldNames
    .filter(name => cols.includes(name))
    .map(name => ({ name, label: name, type: guessType(name, '') }));

  if (fields.length === 0 && roles.nameField) {
    fields.push({ name: roles.nameField, label: roles.nameField, type: 'text' });
  }

  stripEl.innerHTML = `
    <div class="ql-quick-add" id="ql-quick-add">
      ${fields.map(f => renderField(f, '', true)).join('')}
      <div class="ql-quick-actions">
        <button type="button" class="btn" data-action="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="create">Add</button>
      </div>
    </div>
  `;

  const form = $('#ql-quick-add');
  form.querySelector('input, select, textarea')?.focus();
  form.onkeydown = (e) => { if (e.key === 'Escape') stripEl.innerHTML = ''; };

  form.onclick = async (e) => {
    const action = e.target.dataset.action;
    if (action === 'cancel') { stripEl.innerHTML = ''; return; }
    if (action !== 'create') return;

    const data = readForm(form);
    if (roles.nameField && !data[roles.nameField]) {
      return toast('Please enter a value');
    }
    const res = await apiWrite('create', schema.sheet, data);
    if (res.error) return toast('Add failed: ' + res.error);
    toast('Added');
    stripEl.innerHTML = '';
    render();
  };
}

// ============================================================
// VIEW: BUDGET
// ============================================================

async function renderBudget(schema) {
  setStatus('Loading budget…');
  try {
    const res = await apiGetRows(schema.sheet);
    if (res.error) throw new Error(res.error);
    const rows = res.rows || [];
    state.data[schema.sheet] = rows;

    if (rows.length > 0 && !schema.columns) {
      schema.columns = Object.keys(rows[0]).filter(k => k !== '_row');
    }

    // budget_flat uses lowercase field names, but tolerate either case.
    const pick = (row, ...keys) => {
      for (const k of keys) if (row[k] !== undefined) return row[k];
      return '';
    };
    const sectionOf = r => pick(r, 'section', 'Section') || 'Other';
    const itemOf = r => pick(r, 'item', 'Item');
    const budgeted = r => Number(pick(r, 'budgeted', 'Budgeted')) || 0;
    const actual = r => Number(pick(r, 'actual', 'Actual')) || 0;
    const deposit = r => Number(pick(r, 'deposit', 'Deposit', 'paid', 'Paid')) || 0;

    const totalBudgeted = rows.reduce((s, r) => s + budgeted(r), 0);
    const totalActual = rows.reduce((s, r) => s + actual(r), 0);
    const totalPaid = rows.reduce((s, r) => s + deposit(r), 0);
    const outstanding = totalActual - totalPaid;
    const remaining = totalBudgeted - totalActual;

    const bySection = {};
    rows.forEach(r => {
      const sec = sectionOf(r);
      if (!bySection[sec]) bySection[sec] = { budgeted: 0, actual: 0, paid: 0, items: [] };
      bySection[sec].budgeted += budgeted(r);
      bySection[sec].actual += actual(r);
      bySection[sec].paid += deposit(r);
      bySection[sec].items.push(r);
    });

    $('#view').innerHTML = `
      <div class="toolbar">
        <h1>${escapeHtml(schema.label)}</h1>
        <button class="btn btn-primary" id="bd-add">+ Add expense</button>
      </div>

      ${renderStats([
      { label: 'Budgeted', value: money(totalBudgeted) },
      {
        label: 'Spent', value: money(totalActual),
        hint: remaining >= 0 ? money(remaining) + ' left' : money(-remaining) + ' over'
      },
      { label: 'Paid', value: money(totalPaid) },
      { label: 'Outstanding', value: money(outstanding) }
    ])}

      ${renderProgress(totalBudgeted ? (totalActual / totalBudgeted) * 100 : 0, 'Spent vs budgeted')}

      <div id="bd-add-strip"></div>

      <h2>Sections</h2>
      <div class="section-cards">
        ${Object.entries(bySection).map(([name, sec]) => {
      const used = sec.budgeted ? (sec.actual / sec.budgeted) * 100 : 0;
      const over = sec.actual > sec.budgeted && sec.budgeted > 0;
      return `
            <div class="section-card">
              <div class="section-name">${escapeHtml(name)}</div>
              <div class="section-numbers">
                <span class="spent">${money(sec.actual)}</span>
                <span class="muted">of ${money(sec.budgeted)}</span>
              </div>
              ${renderProgress(used, '')}
              ${over ? `<div class="over-badge">Over by ${money(sec.actual - sec.budgeted)}</div>` : ''}
              <div class="section-items">
                ${sec.items.slice(0, 5).map(it => renderBudgetItem(it, rows, schema)).join('')}
                ${sec.items.length > 5 ? `<div class="more">+ ${sec.items.length - 5} more</div>` : ''}
              </div>
            </div>
          `;
    }).join('')}
      </div>
    `;

    document.getElementById('bd-add').onclick = () => {
      const strip = document.getElementById('bd-add-strip');
      if (strip.firstChild) { strip.innerHTML = ''; return; }
      const fields = [
        { name: 'item', label: 'Item' },
        { name: 'section', label: 'Section' },
        { name: 'budgeted', label: 'Budgeted', type: 'number' },
        { name: 'actual', label: 'Actual', type: 'number' }
      ];
      strip.innerHTML = `
        <div class="ql-quick-add" id="bd-quick-add">
          ${fields.map(f => renderField(f, '', true)).join('')}
          <div class="ql-quick-actions">
            <button type="button" class="btn" data-action="cancel">Cancel</button>
            <button type="button" class="btn btn-primary" data-action="create">Add</button>
          </div>
        </div>
      `;
      const form = document.getElementById('bd-quick-add');
      form.querySelector('input')?.focus();
      form.onclick = async (e) => {
        const action = e.target.dataset.action;
        if (action === 'cancel') { strip.innerHTML = ''; return; }
        if (action !== 'create') return;
        const data = readForm(form);
        if (!data.item) return toast('Item is required');
        const res = await apiWrite('create', schema.sheet, data);
        if (res.error) return toast('Add failed: ' + res.error);
        toast('Added');
        strip.innerHTML = '';
        render();
      };
    };

    // Click an item → open inline editor in a full-width row below its card
    $$('.budget-item[data-row]').forEach(el => {
      el.onclick = () => {
        const row = rows.find(r => r._row === Number(el.dataset.row));
        if (!row) return;
        state.expanded = schema.sheet + ':' + rowId(row, schema);
        const card = el.closest('.section-card');
        // Replace the section list temporarily with the editor
        const oldHtml = card.querySelector('.section-items').innerHTML;
        card.querySelector('.section-items').innerHTML =
          renderBudgetEditor(row, schema) +
          `<div class="more" data-role="close" style="cursor:pointer">Close</div>`;
        card.querySelector('[data-role="close"]').onclick = () => {
          card.querySelector('.section-items').innerHTML = oldHtml;
          // Re-bind original items
          $$('.budget-item[data-row]', card).forEach(item => {
            item.onclick = () => { /* nested handlers rebind on re-render */ render(); };
          });
          render();
        };
        bindBudgetEditor(schema, row, card, oldHtml);
      };
    });

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed');
    toast(err.message);
  }
}

function renderBudgetItem(row, allRows, schema) {
  const id = rowId(row, schema);
  const budgeted = Number(row.budgeted ?? row.Budgeted ?? 0) || 0;
  const actual = Number(row.actual ?? row.Actual ?? 0) || 0;
  const paid = Number(row.deposit ?? row.Deposit ?? row.paid ?? row.Paid ?? 0) || 0;
  const over = actual > budgeted && budgeted > 0;
  const fullyPaid = actual > 0 && paid >= actual;

  return `
    <div class="budget-item ${over ? 'over' : ''}" data-row="${row._row}">
      <div class="bi-name">${escapeHtml(row.item || row.Item || '—')}</div>
      <div class="bi-amounts">
        <span>${money(actual || budgeted)}</span>
        ${fullyPaid
      ? '<span class="pill pill-green">Paid</span>'
      : paid > 0
        ? `<span class="pill pill-amber">${money(actual - paid)} due</span>`
        : ''}
      </div>
    </div>
  `;
}

function renderBudgetEditor(row, schema) {
  const fields = [
    { name: 'item', label: 'Item' },
    { name: 'section', label: 'Section' },
    { name: 'budgeted', label: 'Budgeted', type: 'number' },
    { name: 'actual', label: 'Actual', type: 'number' },
    { name: 'deposit', label: 'Paid', type: 'number' }
  ];
  return `
    <div class="ql-editor" data-row="${row._row}">
      ${fields.map(f => renderField(f, row[f.name])).join('')}
      <div class="ql-editor-actions">
        <button type="button" class="btn btn-danger" data-action="delete">Delete</button>
        <button type="button" class="btn btn-primary" data-action="save">Save</button>
      </div>
    </div>
  `;
}

function bindBudgetEditor(schema, row, card, oldHtml) {
  const editor = card.querySelector('.ql-editor');
  if (!editor) return;
  editor.onclick = async (e) => {
    const action = e.target.dataset.action;
    if (action === 'save') {
      const data = readForm(editor);
      const res = await apiWrite('update', schema.sheet, data, rowId(row, schema), row._row);
      if (res.error) return toast('Save failed: ' + res.error);
      toast('Saved');
      render();
    }
    if (action === 'delete') {
      if (!confirm('Delete this item?')) return;
      const res = await apiWrite('delete', schema.sheet, null, rowId(row, schema), row._row);
      if (res.error) return toast('Delete failed: ' + res.error);
      toast('Deleted');
      render();
    }
  };
}

// ============================================================
// VIEW: GUESTS
// ============================================================

async function renderGuests(schema) {
  setStatus('Loading guests…');
  try {
    const res = await apiGetRows(schema.sheet);
    if (res.error) throw new Error(res.error);
    const rows = res.rows || [];
    state.data[schema.sheet] = rows;

    if (rows.length > 0 && !schema.columns) {
      schema.columns = Object.keys(rows[0]).filter(k => k !== '_row');
    }
    const cols = schema.columns || [];
    const roles = detectFieldRoles(schema);
    Object.assign(schema, roles);

    const nameCol = roles.nameField || cols.find(c => /name/i.test(c)) || cols[0];
    const catCol = cols.find(c => /category/i.test(c)) || '';
    const respCol = cols.find(c => /response/i.test(c)) || '';
    const hotelCol = cols.find(c => /accom/i.test(c)) || '';
    const countCol = cols.find(c => /number|count|expect/i.test(c)) || '';

    const total = rows.reduce((s, r) => s + (Number(r[countCol]) || 0), 0);
    const coming = rows.filter(r => r[respCol] === 'Coming')
      .reduce((s, r) => s + (Number(r[countCol]) || 0), 0);
    const pending = rows.filter(r => !r[respCol] || r[respCol] === 'Pending')
      .reduce((s, r) => s + (Number(r[countCol]) || 0), 0);
    const needHotel = rows.filter(r => r[hotelCol] === 'Hotel').length;

    const categories = catCol
      ? Array.from(new Set(rows.map(r => r[catCol]).filter(Boolean)))
      : [];

    const activeCat = state.filter[schema.sheet] || 'All';
    const q = (state.search[schema.sheet] || '').toLowerCase();

    let filtered = rows;
    if (activeCat !== 'All' && catCol) {
      filtered = filtered.filter(r => r[catCol] === activeCat);
    }
    if (q) {
      filtered = filtered.filter(r =>
        cols.some(c => String(r[c] ?? '').toLowerCase().includes(q)));
    }

    $('#view').innerHTML = `
      <div class="toolbar">
        <h1>${escapeHtml(schema.label)}</h1>
        <button class="btn btn-primary" id="g-add">+ Add guest</button>
      </div>

      ${renderStats([
      { label: 'Expected', value: total },
      { label: 'Coming', value: coming },
      { label: 'Pending', value: pending },
      { label: 'Hotel', value: needHotel }
    ])}

      ${renderProgress(total ? (coming / total) * 100 : 0, 'Confirmed')}

      <div class="ql-controls">
        <input type="search" id="g-search" placeholder="Search guests…"
               value="${escapeHtml(state.search[schema.sheet] || '')}">
      </div>

      ${categories.length ? `
        <div class="chips">
          <button class="chip ${activeCat === 'All' ? 'on' : ''}" data-cat="All">All</button>
          ${categories.map(c => `
            <button class="chip ${activeCat === c ? 'on' : ''}" data-cat="${escapeHtml(c)}">
              ${escapeHtml(c)}
            </button>
          `).join('')}
        </div>
      ` : ''}

      <div id="g-add-strip"></div>

      <div class="ql-list" id="g-list">
        ${filtered.length === 0
        ? `<div class="ql-empty">${q || activeCat !== 'All' ? 'No matches' : 'No guests yet'}</div>`
        : filtered.map(r => renderGuestRow(r, schema, {
          nameCol, catCol, respCol, hotelCol
        })).join('')}
      </div>
    `;

    // Search
    const search = $('#g-search');
    if (search) search.oninput = debounce(() => {
      state.search[schema.sheet] = search.value;
      renderGuests(schema);
    }, 200);

    // Chips
    $$('.chip').forEach(chip => {
      chip.onclick = () => {
        state.filter[schema.sheet] = chip.dataset.cat;
        renderGuests(schema);
      };
    });

    // Add
    $('#g-add').onclick = () => showQuickAdd(schema, roles, $('#g-add-strip'));

    // Row click
    $('#g-list').onclick = async (e) => {
      const rowEl = e.target.closest('.ql-row');
      if (!rowEl) return;
      const id = rowEl.dataset.id;

      // Quick RSVP buttons
      const rsvp = e.target.closest('[data-rsvp]');
      if (rsvp && respCol) {
        const value = rsvp.dataset.rsvp;
        const row = rows.find(r => String(rowId(r, schema)) === String(id));
        if (!row) return;
        row[respCol] = value;
        const res = await apiWrite('update', schema.sheet, { [respCol]: value }, id, row._row);
        if (res.error) return toast('Save failed: ' + res.error);
        toast('RSVP → ' + value);
        return render();
      }

      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'expand') return toggleExpand(schema, id);
      if (action === 'cancel') { state.expanded = null; return render(); }
      if (action === 'save') return saveInline(schema, id, rowEl);
      if (action === 'delete') {
        if (!confirm('Delete this guest?')) return;
        const res = await apiWrite('delete', schema.sheet, null, id, rowEl.dataset.row);
        if (res.error) return toast('Delete failed: ' + res.error);
        state.expanded = null;
        toast('Deleted');
        render();
      }
    };

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed');
    toast(err.message);
  }
}

function renderGuestRow(row, schema, { nameCol, catCol, respCol, hotelCol }) {
  const id = rowId(row, schema);
  const key = schema.sheet + ':' + id;
  const expanded = state.expanded === key;
  const name = row[nameCol] || '—';
  const response = respCol ? row[respCol] : '';
  const hotel = hotelCol ? row[hotelCol] : '';
  const category = catCol ? row[catCol] : '';

  const responseClass = response === 'Coming'
    ? 'pill-green'
    : response === 'Not Coming'
      ? 'pill-red'
      : '';

  // Show category as a chip only in the "All" filter view, since it's redundant otherwise
  const showCategory = catCol && (state.filter[schema.sheet] || 'All') === 'All';

  return `
    <div class="ql-row ${expanded ? 'expanded' : ''}"
         data-id="${escapeHtml(String(id))}" data-row="${row._row}">
      <div class="ql-row-main">
        <div class="ql-row-info" data-action="expand">
          <div class="ql-row-name">${escapeHtml(name)}</div>
          <div class="ql-row-meta">
            ${showCategory && category ? `<span class="pill">${escapeHtml(category)}</span>` : ''}
            ${response ? `<span class="pill ${responseClass}">${escapeHtml(response)}</span>` : ''}
            ${hotel === 'Hotel' ? `<span class="pill pill-amber">Hotel</span>` : ''}
          </div>
        </div>
        <button type="button" class="ql-more" data-action="expand">⋯</button>
      </div>
      ${expanded ? `
        ${respCol ? `
          <div class="rsvp-row">
            <span class="rsvp-label">RSVP:</span>
            ${['Coming', 'Pending', 'Not Coming'].map(v => `
              <button class="rsvp-chip ${response === v ? 'on' : ''}"
                      data-rsvp="${escapeHtml(v)}">${escapeHtml(v)}</button>
            `).join('')}
          </div>
        ` : ''}
        ${renderInlineEditor(row, schema)}
      ` : ''}
    </div>
  `;
}

// ============================================================
// VIEW: GIFTS / CASH
// ============================================================

async function renderGifts(schema) {
  setStatus('Loading…');
  try {
    const res = await apiGetRows(schema.sheet);
    if (res.error) throw new Error(res.error);
    const rows = res.rows || [];
    state.data[schema.sheet] = rows;

    if (rows.length > 0 && !schema.columns) {
      schema.columns = Object.keys(rows[0]).filter(k => k !== '_row');
    }
    const cols = schema.columns || [];
    const roles = detectFieldRoles(schema);
    Object.assign(schema, roles);

    const nameCol = roles.nameField || cols.find(c => /name/i.test(c)) || cols[0];
    const amountCol = cols.find(c => /amount|value|contribution/i.test(c)) || '';
    const thankCol = roles.checkField || '';
    const dateCol = roles.dateField || '';

    const total = rows.length;
    const thanked = thankCol ? rows.filter(r => isChecked(r[thankCol])).length : 0;
    const sumAmount = amountCol
      ? rows.reduce((s, r) => s + (Number(r[amountCol]) || 0), 0)
      : 0;

    const stats = [{ label: 'Total', value: total }];
    if (amountCol) stats.push({ label: 'Sum', value: money(sumAmount) });
    if (thankCol) stats.push({ label: 'Acknowledged', value: thanked });

    $('#view').innerHTML = `
      <div class="toolbar">
        <h1>${escapeHtml(schema.label)}</h1>
        <button class="btn btn-primary" id="gf-add">+ Add</button>
      </div>

      ${renderStats(stats)}

      ${thankCol && total ? renderProgress((thanked / total) * 100, 'Acknowledged') : ''}

      <div class="ql-controls">
        <input type="search" id="gf-search" placeholder="Search…"
               value="${escapeHtml(state.search[schema.sheet] || '')}">
      </div>

      <div id="gf-add-strip"></div>

      <div class="ql-list" id="gf-list">
        ${(() => {
        const q = (state.search[schema.sheet] || '').toLowerCase();
        let filtered = rows;
        if (q) filtered = rows.filter(r =>
          cols.some(c => String(r[c] ?? '').toLowerCase().includes(q)));
        if (filtered.length === 0) {
          return `<div class="ql-empty">${q ? 'No matches' : 'Nothing yet'}</div>`;
        }
        return filtered.map(r => renderGiftRow(r, schema, {
          nameCol, amountCol, thankCol, dateCol
        })).join('');
      })()}
      </div>
    `;

    const search = $('#gf-search');
    if (search) search.oninput = debounce(() => {
      state.search[schema.sheet] = search.value;
      renderGifts(schema);
    }, 200);

    $('#gf-add').onclick = () => showQuickAdd(schema, roles, $('#gf-add-strip'));

    $('#gf-list').onclick = async (e) => {
      const rowEl = e.target.closest('.ql-row');
      if (!rowEl) return;
      const id = rowEl.dataset.id;
      const action = e.target.closest('[data-action]')?.dataset.action;

      if (action === 'toggle') {
        if (!thankCol) return;
        const row = rows.find(r => String(rowId(r, schema)) === String(id));
        if (!row) return;
        const newVal = !isChecked(row[thankCol]);
        row[thankCol] = newVal;
        rowEl.classList.toggle('done', newVal);
        const btn = rowEl.querySelector('.ql-check');
        if (btn) { btn.classList.toggle('on', newVal); btn.textContent = newVal ? '✓' : ''; }
        const res = await apiWrite('update', schema.sheet, { [thankCol]: newVal }, id, row._row);
        if (res.error) {
          row[thankCol] = !newVal;
          toast('Save failed: ' + res.error);
        }
        return;
      }
      if (action === 'expand') return toggleExpand(schema, id);
      if (action === 'cancel') { state.expanded = null; return render(); }
      if (action === 'save') return saveInline(schema, id, rowEl);
      if (action === 'delete') {
        if (!confirm('Delete this item?')) return;
        const res = await apiWrite('delete', schema.sheet, null, id, rowEl.dataset.row);
        if (res.error) return toast('Delete failed: ' + res.error);
        state.expanded = null;
        toast('Deleted');
        render();
      }
    };

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed');
    toast(err.message);
  }
}

function renderGiftRow(row, schema, { nameCol, amountCol, thankCol, dateCol }) {
  const id = rowId(row, schema);
  const key = schema.sheet + ':' + id;
  const expanded = state.expanded === key;
  const checked = thankCol ? isChecked(row[thankCol]) : false;
  const name = row[nameCol] || '—';
  const amount = amountCol ? row[amountCol] : '';
  const date = dateCol ? row[dateCol] : '';

  return `
    <div class="ql-row ${checked ? 'done' : ''} ${expanded ? 'expanded' : ''}"
         data-id="${escapeHtml(String(id))}" data-row="${row._row}">
      <div class="ql-row-main">
        ${thankCol ? `
          <button type="button" class="ql-check ${checked ? 'on' : ''}"
                  data-action="toggle">${checked ? '✓' : ''}</button>
        ` : ''}
        <div class="ql-row-info" data-action="expand">
          <div class="ql-row-name">${escapeHtml(name)}</div>
          <div class="ql-row-meta">
            ${amount ? `<span class="pill">${escapeHtml(String(amount))}</span>` : ''}
            ${date ? `<span class="ql-row-date">${escapeHtml(fmtDateShort(date))}</span>` : ''}
          </div>
        </div>
        <button type="button" class="ql-more" data-action="expand">⋯</button>
      </div>
      ${expanded ? renderInlineEditor(row, schema) : ''}
    </div>
  `;
}

// ============================================================
// VIEW: LINK
// ============================================================

function renderLinkView(schema) {
  $('#view').innerHTML = `
    <h1>${escapeHtml(schema.label)}</h1>
    <p>This view lives in the Google Sheet.
      <a href="${escapeHtml(schema.url)}" target="_blank" rel="noopener">Open it ↗</a>
    </p>`;
  setStatus('External link');
}

// ============================================================
// NAVIGATION
// ============================================================

function renderNav() {
  const nav = $('#nav');
  if (!nav) return;

  const overviewActive = state.route === '_overview' ? 'class="active"' : '';
  const overviewLink = `<a href="#/_overview" ${overviewActive}>Overview</a>`;

  const sheetLinks = state.schema.map(s => {
    if (s.type === 'link') {
      return `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" class="external-link">${escapeHtml(s.label)} ↗</a>`;
    }
    const active = state.route === s.sheet ? 'class="active"' : '';
    return `<a href="#/${encodeURIComponent(s.sheet)}" ${active}>${escapeHtml(s.label)}</a>`;
  }).join('');

  nav.innerHTML = overviewLink + sheetLinks;
}

async function routeTo(route) {
  state.route = route;
  state.expanded = null;
  renderNav();
  await render();
}

// ============================================================
// BOOT
// ============================================================

async function boot() {
  try {
    setStatus('Loading schema…');
    const res = await apiGetSchema();
    if (res.error) throw new Error(res.error);
    state.schema = res.schema || [];
    state.booted = true;

    const hash = location.hash.replace('#/', '');
    state.route = hash ? decodeURIComponent(hash) : '_overview';

    renderNav();
    await render();
  } catch (err) {
    setStatus('Failed');
    toast(err.message);
  }
}

window.addEventListener('hashchange', async () => {
  const route = decodeURIComponent(location.hash.replace('#/', ''));
  await routeTo(route);
});

const refreshBtn = $('#refresh-btn');
if (refreshBtn) refreshBtn.onclick = () => render();

// No setInterval auto-refresh — it was clobbering inline edits.
boot();


function renderMetaRow(group, item) {
  const key = item.key;
  const expanded = state.expanded === '_app_meta:' + key;
  const rawValue = item.value == null ? '' : String(item.value);
  const isDate = group === 'Dates';
  const displayValue = isDate ? fmtLongDate(rawValue) : (rawValue || '—');

  let inputHtml;
  if (isDate) {
    inputHtml = `<input type="date" value="${toISODate(rawValue)}" data-meta-input>`;
  } else {
    inputHtml = `<input type="text" value="${escapeHtml(rawValue)}" data-meta-input>`;
  }

  return `
    <tr class="meta-row ${expanded ? 'expanded' : ''}" data-key="${escapeHtml(key)}">
      <td class="info-label">${escapeHtml(item.label)}</td>
      <td class="meta-value" data-action="expand">
        <span class="meta-value-text">${escapeHtml(displayValue)}</span>
        <span class="meta-edit-icon" aria-hidden="true">✎</span>
      </td>
    </tr>
    ${expanded ? `
      <tr class="meta-editor-row" data-key="${escapeHtml(key)}">
        <td colspan="2">
          <div class="meta-editor">
            ${inputHtml}
            <div class="meta-editor-actions">
              <button type="button" class="btn" data-action="cancel">Cancel</button>
              <button type="button" class="btn btn-primary" data-action="save">Save</button>
            </div>
          </div>
        </td>
      </tr>
    ` : ''}
  `;
}

function bindOverviewMeta() {
  const view = $('#view');
  if (!view) return;

  view.onclick = async (e) => {
    // Open / close editor
    const openTrigger = e.target.closest('[data-action="expand"]');
    if (openTrigger) {
      const metaRow = openTrigger.closest('.meta-row');
      if (!metaRow) return;
      const key = metaRow.dataset.key;
      state.expanded = state.expanded === '_app_meta:' + key
        ? null
        : '_app_meta:' + key;
      return renderOverview();
    }

    // Editor actions
    const editorRow = e.target.closest('.meta-editor-row');
    if (editorRow) {
      const key = editorRow.dataset.key;
      const action = e.target.dataset.action;

      if (action === 'cancel') {
        state.expanded = null;
        return renderOverview();
      }

      if (action === 'save') {
        const input = editorRow.querySelector('[data-meta-input]');
        if (!input) return;
        const newValue = input.value.trim();
        const res = await apiWrite('update', '_app_meta', { value: newValue }, key);
        if (res.error) return toast('Save failed: ' + res.error);
        state.expanded = null;
        toast('Saved');
        return renderOverview();
      }
    }
  };

  // Auto-focus + Enter/Escape shortcuts
  const input = view.querySelector('[data-meta-input]');
  if (input) {
    input.focus();
    if (input.type === 'text' && input.value) input.setSelectionRange(input.value.length, input.value.length);

    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const row = input.closest('.meta-editor-row');
        row?.querySelector('[data-action="save"]')?.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        state.expanded = null;
        renderOverview();
      }
    };
  }
}