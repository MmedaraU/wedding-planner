// ============================================================
// WEDDING PLANNER — COMPANION APP
// ============================================================

const CONFIG = window.WEDDING_CONFIG;

const VENDOR_SOURCES = [
  { sheet: 'Wedding Vendor Sourcing', kind: 'Wedding', visible: true },
  { sheet: 'Household Vendor Sourcing', kind: 'Household', visible: true },
  { sheet: 'Food Vendor Sourcing', kind: 'Food', visible: false },
  { sheet: 'Honeymoon Vendor Sourcing', kind: 'Honeymoon', visible: false }
];

const VIRTUAL_NAV = [
  { route: '_today', label: 'Today', order: 0 },
  { route: '_overview', label: 'Overview', order: 5 },
  { route: '_team', label: 'Team', order: 15 },
  { route: '_vendors', label: 'Vendors', order: 55 }
];

// Short one-line explanations shown under each view's title
const SUBTITLES = {
  '_today': 'What needs your attention right now',
  '_overview': 'The wedding at a glance',
  '_vendors': 'Every supplier, grouped by pipeline stage',
  '_team': 'Everyone working on the wedding, with contacts and quantities',
  '_search': 'Searching across every sheet',

  'Planning Schedule': 'Every task, from proposal to after-party',
  'Bridal List': 'Dowry, ceremony items, and traditions — grouped by section',
  'Rentals Tracker': "What we're borrowing, and when it goes back",
  'budget_flat': 'Every naira in, every naira out',
  'Guest List': "Who's coming, who's pending, who needs a hotel",
  'Gifts Received': "Presents received, and who's been thanked",
  'Cash Contributions': 'Contributions received, and who\'s been thanked',
  'Things to get to and from venue': 'Things to carry to the venue, and bring back',
  'Things to take back to new home': 'Things to move into the new home'
};

function injectSubtitle() {
  const view = $('#view');
  if (!view) return;

  // Remove any stale subtitle from a previous render
  view.querySelectorAll('.view-subtitle').forEach(el => el.remove());

  const text = SUBTITLES[state.route];
  if (!text) return;

  const h1 = view.querySelector('h1');
  if (!h1) return;

  const p = document.createElement('p');
  p.className = 'view-subtitle';
  p.textContent = text;
  h1.insertAdjacentElement('afterend', p);
}

const state = {
  schema: [],
  route: null,
  data: {},
  search: {},
  filter: {},
  expanded: null,
  globalSearch: '',
  previousRoute: null,
  booted: false
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

// ============================================================
// API
// ============================================================

async function apiGetSchema() {
  const url = `${CONFIG.apiUrl}?secret=${encodeURIComponent(CONFIG.secret)}&schema=true`;
  return (await fetch(url)).json();
}
async function apiGetOverview(force) {
  const now = Date.now();
  state.dataTime = state.dataTime || {};
  if (!force && state.data.__overview && (now - state.dataTime['__overview']) < CACHE_TTL_MS) {
    return state.data.__overview;
  }
  const url = `${CONFIG.apiUrl}?secret=${encodeURIComponent(CONFIG.secret)}&overview=true`;
  let res;
  try {
    res = await (await fetch(url)).json();
  } catch (err) {
    return { error: 'Network error: ' + err.message };
  }
  if (!res.error) {
    state.data.__overview = res;
    state.dataTime['__overview'] = now;
  }
  return res;
}
const CACHE_TTL_MS = 5 * 60 * 1000;

async function apiGetRows(sheetName, force) {
  const now = Date.now();
  state.dataTime = state.dataTime || {};
  const cached = state.data[sheetName];
  const cachedAt = state.dataTime[sheetName] || 0;

  if (!force && cached && (now - cachedAt) < CACHE_TTL_MS) {
    return { rows: cached };
  }

  const url = `${CONFIG.apiUrl}?secret=${encodeURIComponent(CONFIG.secret)}&sheet=${encodeURIComponent(sheetName)}`;
  let res;
  try {
    res = await (await fetch(url)).json();
  } catch (err) {
    return { error: 'Network error: ' + err.message };
  }
  if (!res.error) {
    state.data[sheetName] = res.rows || [];
    state.dataTime[sheetName] = now;
  }
  return res;
}
async function apiWrite(action, sheetName, data, id, row) {
  const body = JSON.stringify({
    secret: CONFIG.secret, sheet: sheetName, action, data, id, row
  });
  const res = await (await fetch(CONFIG.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body
  })).json();
  if (!res.error) {
    // Always drop the cache for the sheet that was written to
    delete state.data[sheetName];
    delete state.dataTime?.[sheetName];

    // Anything that feeds the Overview payload must also blow away the
    // cached __overview, otherwise the UI keeps showing stale data for
    // up to CACHE_TTL_MS (5 minutes).
    const affectsOverview =
      action === 'updateTeam' ||
      action === 'deleteTeam' ||
      action === 'createTeam' ||
      sheetName === '_app_meta';

    if (affectsOverview) {
      delete state.data.__overview;
      delete state.dataTime?.['__overview'];
    }
  }
  return res;
}

// ============================================================
// Utilities
// ============================================================

function currentSchema() { return state.schema.find(s => s.sheet === state.route); }
function setStatus(t) { const el = $('#status'); if (el) el.textContent = t; }

function toast(msg) {
  const el = $('#toast'); if (!el) return;
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2400);
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function money(n) {
  const num = Number(n || 0);
  if (!num) return '₦0';
  return '₦' + num.toLocaleString();
}
function parseSheetDate(val) {
  if (val == null || val === '') return null;
  const s = String(val);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function fmtDate(val) {
  const d = parseSheetDate(val);
  if (!d) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateShort(val) {
  const d = parseSheetDate(val);
  if (!d) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fmtLongDate(val) {
  const d = parseSheetDate(val);
  if (!d) return val ? String(val) : '—';
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
function toISODate(val) {
  const d = parseSheetDate(val);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function daysUntil(val) {
  const target = parseSheetDate(val);
  if (!target) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}
function isChecked(v) {
  return v === true || v === 'TRUE' || v === 'true'
    || v === 'Yes' || v === 'yes' || v === 1;
}
function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function rowId(row, schema) {
  const idField = (schema.columns || [])[schema.idColumn - 1];
  if (idField) {
    const val = row[idField];
    // Skip booleans and empty values — use physical row instead
    if (val !== undefined && val !== '' && val !== null
      && val !== false && val !== true) {
      return val;
    }
  }
  return row._row;
}
function pick(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== '') return row[k];
  }
  // case-insensitive fallback
  const lower = keys.map(k => k.toLowerCase());
  for (const k of Object.keys(row)) {
    if (lower.includes(k.toLowerCase()) && row[k] !== '' && row[k] !== undefined) return row[k];
  }
  return '';
}
function formatPhone(raw) {
  if (!raw) return '';
  return String(raw).split(/[,;\s]+/)[0].replace(/\D/g, '');
}
function telLink(raw) {
  const p = formatPhone(raw); if (!p) return '';
  const intl = p.startsWith('0') ? '234' + p.slice(1) : p;
  return 'tel:+' + intl;
}
function waLink(raw) {
  const p = formatPhone(raw); if (!p) return '';
  const intl = p.startsWith('0') ? '234' + p.slice(1) : p;
  return 'https://wa.me/' + intl;
}
function pluralize(n, s) { return n + ' ' + s + (n === 1 ? '' : 's'); }

function normalizePhone(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const digits = s.replace(/\D/g, '');
  // Nigerian mobile: 10 digits starting 7/8/9 → prepend 0
  if (digits.length === 10 && /^[789]/.test(digits)) return '0' + digits;
  // 13 digits starting 234 → already international
  if (digits.length === 13 && digits.startsWith('234')) return '0' + digits.slice(3);
  return s;
}

// ============================================================
// Field role detection (resilient)
// ============================================================

const CHECK_RE = /\b(returned|packed|done|thanked|arrived|signed|completed|bought|booked|received|sent|paid|decided)\b/i;
const NAME_RE = /\b(name|names|item|task|thing|vendor|description|title|guest|company|chore|question)\b/i;
const STATUS_RE = /\b(status|stage|response|state|category)\b/i;
const DATE_RE = /\b(date|due|when|deadline)\b/i;

function detectFieldRoles(schema) {
  const cols = schema.columns || [];
  const useIfPresent = (val, re) => {
    if (val) {
      const lower = String(val).toLowerCase();
      const hit = cols.find(c => String(c).toLowerCase() === lower);
      if (hit) return hit;
    }
    return re ? (cols.find(c => re.test(c)) || '') : '';
  };
  return {
    checkField: useIfPresent(schema.checkField, CHECK_RE),
    nameField: useIfPresent(schema.nameField, NAME_RE) || cols[0] || '',
    statusField: useIfPresent(schema.statusField, STATUS_RE),
    dateField: useIfPresent(schema.dateField, DATE_RE)
  };
}

function guessType(name) {
  if (/date/i.test(name)) return 'date';
  if (/notes?|comment|detail|description/i.test(name)) return 'textarea';
  if (/price|cost|amount|number|count|budgeted|actual|deposit/i.test(name)) return 'number';
  if (/response|status|category|stage|tier/i.test(name)) return 'select';
  return 'text';
}

// ============================================================
// Section helpers — for hierarchical sheets
// ============================================================

const SKIP_AS_HEADER = /^(budgeted cost|actual cost|deposit made|deposit made\/money spent|outstanding balance|date last deposit was made|date next deposit is due|notes|total|sub-?total|grand total)\b/i;

function attachSections(rows, roles) {
  let currentSection = '';
  const out = [];
  rows.forEach(r => {
    const raw = r[roles.nameField];
    const name = raw == null ? '' : String(raw).trim();
    if (!name) return;
    if (/^(sub-?total|total|grand total)\b/i.test(name)) return;
    if (SKIP_AS_HEADER.test(name)) return;
    const noCheckbox = r[roles.checkField] === '' || r[roles.checkField] === false || r[roles.checkField] == null;
    const hasLetters = /[A-Za-z]/.test(name);
    const isAllCaps = hasLetters && name === name.toUpperCase();
    if (isAllCaps && noCheckbox) { currentSection = name; return; }
    out.push({ ...r, _section: currentSection });
  });
  return out;
}

// ============================================================
// Shared render blocks
// ============================================================

function renderStats(stats) {
  return `<div class="stats">${stats.map(s => `
    <div class="stat">
      <div class="stat-label">${escapeHtml(s.label)}</div>
      <div class="stat-value">${s.value}</div>
      ${s.hint ? `<div class="stat-hint">${escapeHtml(s.hint)}</div>` : ''}
    </div>`).join('')}</div>`;
}

function renderProgress(pct, label) {
  const c = Math.max(0, Math.min(100, pct || 0));
  return `<div class="progress-wrap">
    ${label ? `<div class="progress-label">${escapeHtml(label)}</div>` : ''}
    <div class="progress-track"><div class="progress-fill" style="width:${c}%"></div></div>
    <div class="progress-pct">${Math.round(c)}%</div>
  </div>`;
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
    input = `<select id="${id}" name="${name}"><option value=""></option>
      ${field.options.map(o => `<option value="${escapeHtml(o)}" ${o === value ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
    </select>`;
  } else if (type === 'textarea') {
    input = `<textarea id="${id}" name="${name}" rows="2">${escapeHtml(value ?? '')}</textarea>`;
  } else if (type === 'date') {
    // API returns date cells as ISO timestamps; browsers only accept
    // YYYY-MM-DD in <input type="date">, so normalise before rendering.
    input = `<input id="${id}" name="${name}" type="date" value="${escapeHtml(toISODate(value))}">`;
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

function renderInlineEditor(row, schema) {
  const cols = schema.columns || [];
  const fields = (schema.fields && schema.fields.length)
    ? schema.fields
    : cols.map(c => ({ name: c, label: c, type: guessType(c) }));
  return `<div class="ql-editor">
    ${fields.map(f => renderField(f, row[f.name])).join('')}
    <div class="ql-editor-actions">
      <button type="button" class="btn btn-danger" data-action="delete">Delete</button>
      <button type="button" class="btn" data-action="cancel">Cancel</button>
      <button type="button" class="btn btn-primary" data-action="save">Save</button>
    </div>
  </div>`;
}

// ============================================================
// Dispatcher
// ============================================================
async function render() {
  await renderView();
  injectSubtitle();
}

async function renderView() {
  if (state.route === '_overview') return renderOverview();
  if (state.route === '_today') return renderToday();
  if (state.route === '_vendors') return renderVendors();
  if (state.route === '_search') return renderSearch();
  if (state.route === '_team') return renderTeamPage();

  const schema = currentSchema();
  if (!schema) { $('#view').innerHTML = '<h1>Not found</h1>'; return; }
  if (schema.type === 'link') return renderLinkView(schema);

  const map = {
    renderTimeline: renderTimeline,
    renderQuickList: renderQuickList,
    renderBudget: renderBudget,
    renderGuests: renderGuests,
    renderGifts: renderGifts
  };
  const fn = map[schema.view] || renderQuickList;
  await fn(schema);
}

// ============================================================
// VIEW: Overview
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

    const budgetUsedPct = stats.budget_budgeted ? (stats.budget_actual / stats.budget_budgeted) * 100 : 0;
    const guestPct = stats.guests_total ? (stats.guests_coming / stats.guests_total) * 100 : 0;
    const planPct = stats.planning_total ? (stats.planning_done / stats.planning_total) * 100 : 0;
    const bridalPct = stats.bridal_total ? (stats.bridal_done / stats.bridal_total) * 100 : 0;

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
        </tbody></table>` : ''}

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
        .filter(([g]) => !['Dates', 'Couple', 'Team'].includes(g))
        .map(([g, items]) => `
          <div class="meta-group">
            <div class="meta-group-name">${escapeHtml(g)}</div>
            <table class="info-table meta-table"><tbody>
              ${items.map(it => renderMetaRow(g, it)).join('')}
            </tbody></table>
          </div>`).join('')}
    `;
    bindOverviewMeta();
    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed'); toast(err.message);
  }
}

function renderMetaRow(group, item) {
  const key = item.key;
  const expanded = state.expanded === '_app_meta:' + key;
  const rawValue = item.value == null ? '' : String(item.value);
  const isDate = group === 'Dates';
  const displayValue = isDate ? fmtLongDate(rawValue) : (rawValue || '—');
  const input = isDate
    ? `<input type="date" value="${toISODate(rawValue)}" data-meta-input>`
    : `<input type="text" value="${escapeHtml(rawValue)}" data-meta-input>`;
  return `
    <tr class="meta-row ${expanded ? 'expanded' : ''}" data-key="${escapeHtml(key)}">
      <td class="info-label">${escapeHtml(item.label)}</td>
      <td class="meta-value" data-action="expand">
        <span class="meta-value-text">${escapeHtml(displayValue)}</span>
        <span class="meta-edit-icon">✎</span>
      </td>
    </tr>
    ${expanded ? `<tr class="meta-editor-row" data-key="${escapeHtml(key)}">
      <td colspan="2"><div class="meta-editor">
        ${input}
        <div class="meta-editor-actions">
          <button type="button" class="btn" data-action="cancel">Cancel</button>
          <button type="button" class="btn btn-primary" data-action="save">Save</button>
        </div>
      </div></td>
    </tr>` : ''}`;
}

function bindOverviewMeta() {
  const view = $('#view'); if (!view) return;
  view.onclick = async (e) => {
    const openTrigger = e.target.closest('[data-action="expand"]');
    if (openTrigger) {
      const metaRow = openTrigger.closest('.meta-row'); if (!metaRow) return;
      const key = metaRow.dataset.key;
      state.expanded = state.expanded === '_app_meta:' + key ? null : '_app_meta:' + key;
      return renderOverview();
    }
    const editorRow = e.target.closest('.meta-editor-row');
    if (editorRow) {
      const key = editorRow.dataset.key;
      const action = e.target.dataset.action;
      if (action === 'cancel') { state.expanded = null; return renderOverview(); }
      if (action === 'save') {
        const input = editorRow.querySelector('[data-meta-input]'); if (!input) return;
        const res = await apiWrite('update', '_app_meta', { value: input.value.trim() }, key);
        if (res.error) return toast('Save failed: ' + res.error);
        state.expanded = null; toast('Saved');
        return renderOverview();
      }
    }
  };
  const input = view.querySelector('[data-meta-input]');
  if (input) {
    input.focus();
    if (input.type === 'text' && input.value) input.setSelectionRange(input.value.length, input.value.length);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.closest('.meta-editor-row').querySelector('[data-action="save"]')?.click(); }
      else if (e.key === 'Escape') { e.preventDefault(); state.expanded = null; renderOverview(); }
    };
  }
}


// ============================================================
// VIEW: Team
// ============================================================
function openTeamEditor(team) {
  const isEdit = !!team;
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h2>${isEdit ? 'Edit team member' : 'Add team member'}</h2>
      <form id="team-form">
        <div class="field">
          <label>Role</label>
          <input name="role" value="${escapeHtml(team?.role || '')}">
        </div>
        <div class="field">
          <label>Name</label>
          <input name="contact" value="${escapeHtml(team?.contact || '')}">
        </div>
        <div class="field">
          <label>Phone</label>
          <input name="phone" value="${escapeHtml(team?.phone || '')}">
        </div>
        <div class="field">
          <label>Events</label>
          <input name="events" value="${escapeHtml(team?.events || '')}">
        </div>
        <div class="field">
          <label>Quantity (for food)</label>
          <input name="qty" type="number" value="${escapeHtml(team?.qty || '')}">
        </div>
        <div class="field">
          <label>Description</label>
          <textarea name="description">${escapeHtml(team?.description || '')}</textarea>
        </div>
        <div class="modal-actions">
          ${isEdit ? '<button type="button" class="btn btn-danger" data-action="delete">Delete</button>' : ''}
          <button type="button" class="btn" data-action="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const form = modal.querySelector('#team-form');
  form.querySelector('input')?.focus();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = {};
    new FormData(form).forEach((v, k) => { data[k] = String(v).trim(); });
    const action = isEdit ? 'updateTeam' : 'createTeam';
    const res = await apiWrite(action, 'General Information', data, null, team?._row);
    if (res.error) return toast('Save failed: ' + res.error);
    modal.remove();
    toast(isEdit ? 'Saved' : 'Added');
    renderTeamPage();
  };

  modal.querySelector('[data-action="cancel"]').onclick = () => modal.remove();
  if (isEdit) {
    modal.querySelector('[data-action="delete"]').onclick = async () => {
      if (!confirm('Delete this team member?')) return;
      const res = await apiWrite('deleteTeam', 'General Information', null, null, team._row);
      if (res.error) return toast('Delete failed: ' + res.error);
      modal.remove();
      toast('Deleted');
      renderTeamPage();
    };
  }

  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

async function renderTeamPage() {
  setStatus('Loading team…');
  try {
    const res = await apiGetOverview();
    if (res.error) throw new Error(res.error);
    const team = res.team || [];

    const q = (state.search._team || '').toLowerCase();
    const filtered = q
      ? team.filter(t => [t.role, t.contact, t.phone, t.events, t.description].join(' ').toLowerCase().includes(q))
      : team;

    const withPhone = team.filter(t => t.phone).length;

    $('#view').innerHTML = `
      <div class="toolbar">
        <h1>Team</h1>
        <div class="toolbar-actions">
          <span class="pill">${team.length} ${team.length === 1 ? 'role' : 'roles'} · ${withPhone} with number</span>
          <button class="btn btn-primary" id="team-add">+ Add</button>
        </div>
      </div>
      <div class="ql-controls">
        <input type="search" id="team-search" placeholder="Search team…" value="${escapeHtml(state.search._team || '')}">
      </div>
      ${filtered.length === 0
        ? `<div class="ql-empty">${q ? 'No matches' : 'No team members yet'}</div>`
        : `<div class="contact-grid team-grid">
            ${filtered.map(t => {
          const display = normalizePhone(t.phone);
          const tel = telLink(display);
          const wa = waLink(display);
          const hasPhone = !!display;
          return `<div class="contact-card team-card ${hasPhone ? '' : 'no-phone'}"
                           data-row="${t._row}" data-role="${escapeHtml(t.role)}">
                <div class="contact-role">${escapeHtml(t.role)}</div>
                ${t.contact ? `<div class="contact-name">${escapeHtml(t.contact)}</div>` : ''}
                ${hasPhone ? `<div class="contact-phone">${escapeHtml(display)}</div>` : ''}
                ${(t.events || t.qty) ? `<div class="team-meta-row">
                  ${t.events ? `<span class="pill">${escapeHtml(t.events)}</span>` : ''}
                  ${t.qty ? `<span class="pill">🍽 ${escapeHtml(t.qty)}</span>` : ''}
                </div>` : ''}
                ${t.description ? `<div class="team-desc">${escapeHtml(t.description)}</div>` : ''}
                <div class="team-actions-row">
                  ${hasPhone ? `
                    <a class="btn btn-ghost" href="${escapeHtml(tel)}">📞</a>
                    <a class="btn btn-ghost" href="${escapeHtml(wa)}" target="_blank" rel="noopener">💬</a>
                  ` : ''}
                  <button type="button" class="btn btn-ghost team-edit" data-row="${t._row}">✎ Edit</button>
                </div>
              </div>`;
        }).join('')}
          </div>`}
    `;

    const search = $('#team-search');
    if (search) search.oninput = debounce(() => {
      state.search._team = search.value;
      renderTeamPage();
    }, 200);

    // "+ Add" — .onclick overwrites any prior handler, so repeated
    // renders don't stack.
    $('#team-add').onclick = () => openTeamEditor(null);

    // "✎ Edit" — delegate on #view. Using .onclick (not addEventListener)
    // is essential: addEventListener would stack a new handler on every
    // render, eventually opening N modals for a single click.
    $('#view').onclick = (e) => {
      const editBtn = e.target.closest('.team-edit');
      if (!editBtn) return;
      const row = team.find(t => t._row === Number(editBtn.dataset.row));
      if (row) openTeamEditor(row);
    };

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed'); toast(err.message);
  }
}

// ============================================================
// VIEW: Today
// ============================================================

async function renderToday() {
  setStatus('Loading today…');
  try {
    const [planRes, guestRes, budgetRes] = await Promise.all([
      apiGetRows('Planning Schedule'),
      apiGetRows('Guest List'),
      apiGetRows('budget_flat')
    ]);

    const plan = planRes.rows || [];
    const guests = guestRes.rows || [];
    const budget = budgetRes.rows || [];

    // Planning Schedule: detect done/name/date
    const pSchema = state.schema.find(s => s.sheet === 'Planning Schedule') || {};
    if (plan.length > 0 && !pSchema.columns) pSchema.columns = Object.keys(plan[0]).filter(k => k !== '_row');
    const pRoles = detectFieldRoles(pSchema);
    const doneField = pRoles.checkField || 'Done';
    const nameField = pRoles.nameField || 'TASK';
    const dateField = pRoles.dateField || 'DUE DATE';

    const open = plan.filter(r => !isChecked(r[doneField]) && r[dateField]);
    const overdue = open.filter(r => (daysUntil(r[dateField]) ?? 1) < 0);
    const dueToday = open.filter(r => daysUntil(r[dateField]) === 0);
    const dueWeek = open.filter(r => { const d = daysUntil(r[dateField]); return d != null && d > 0 && d <= 7; });
    const dueSoon = [...dueToday, ...dueWeek];

    // Guests pending response
    const respField = 'Guest Response';
    const pending = guests.filter(r => !r[respField] || r[respField] === 'Pending');

    // Deposits due in next 14 days
    const depositsDue = budget.filter(r => {
      const d = daysUntil(r.date_next_deposit);
      return d != null && d >= 0 && d <= 14;
    });

    $('#view').innerHTML = `
      <h1>Today</h1>

      <div class="today-grid">
        <div class="today-card ${overdue.length ? 'urgent' : ''}">
          <div class="today-card-head">
            <span class="today-card-title">Overdue</span>
            <span class="today-card-count">${overdue.length}</span>
          </div>
          ${overdue.length === 0 ? '<div class="today-empty">Nothing overdue</div>' :
        overdue.slice(0, 6).map(r => `
              <div class="today-row" data-task-row="${r._row}">
                <span class="today-date">${escapeHtml(fmtDateShort(r[dateField]))}</span>
                <span class="today-name">${escapeHtml(r[nameField] || '—')}</span>
              </div>`).join('')}
          ${overdue.length > 6 ? `<div class="more">+ ${overdue.length - 6} more</div>` : ''}
        </div>

        <div class="today-card">
          <div class="today-card-head">
            <span class="today-card-title">Due this week</span>
            <span class="today-card-count">${dueSoon.length}</span>
          </div>
          ${dueSoon.length === 0 ? '<div class="today-empty">Nothing this week</div>' :
        dueSoon.slice(0, 6).map(r => `
              <div class="today-row" data-task-row="${r._row}">
                <span class="today-date">${escapeHtml(fmtDateShort(r[dateField]))}</span>
                <span class="today-name">${escapeHtml(r[nameField] || '—')}</span>
              </div>`).join('')}
          ${dueSoon.length > 6 ? `<div class="more">+ ${dueSoon.length - 6} more</div>` : ''}
        </div>

        <div class="today-card">
          <div class="today-card-head">
            <span class="today-card-title">Guests pending</span>
            <span class="today-card-count">${pending.length}</span>
          </div>
          ${pending.length === 0 ? '<div class="today-empty">Everyone has answered</div>' :
        pending.slice(0, 6).map(g => `
              <div class="today-row">
                <span class="today-name">${escapeHtml(g.Names || '—')}</span>
                <span class="today-date">${escapeHtml(g.Category || '')}</span>
              </div>`).join('')}
          ${pending.length > 6 ? `<div class="more">+ ${pending.length - 6} more</div>` : ''}
        </div>

        <div class="today-card ${depositsDue.length ? 'warn' : ''}">
          <div class="today-card-head">
            <span class="today-card-title">Deposits due soon</span>
            <span class="today-card-count">${depositsDue.length}</span>
          </div>
          ${depositsDue.length === 0 ? '<div class="today-empty">Nothing in the next 2 weeks</div>' :
        depositsDue.slice(0, 6).map(b => `
              <div class="today-row">
                <span class="today-date">${escapeHtml(fmtDateShort(b.date_next_deposit))}</span>
                <span class="today-name">${escapeHtml(b.item || '—')}</span>
              </div>`).join('')}
          ${depositsDue.length > 6 ? `<div class="more">+ ${depositsDue.length - 6} more</div>` : ''}
        </div>
      </div>
    `;

    // Tap a task row → jump to Timeline
    $$('[data-task-row]').forEach(el => {
      el.onclick = () => { location.hash = '#/' + encodeURIComponent('Planning Schedule'); };
    });

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed'); toast(err.message);
  }
}

// ============================================================
// VIEW: Timeline
// ============================================================

async function renderTimeline(schema) {
  setStatus('Loading timeline…');
  try {
    const res = await apiGetRows(schema.sheet);
    if (res.error) throw new Error(res.error);
    const all = res.rows || [];
    state.data[schema.sheet] = all;

    if (all.length > 0 && !schema.columns) schema.columns = Object.keys(all[0]).filter(k => k !== '_row');
    const roles = detectFieldRoles(schema);
    Object.assign(schema, roles);

    const doneCol = roles.checkField, dateCol = roles.dateField, nameCol = roles.nameField;
    const phaseCol = (schema.columns || []).find(c => /phase|section|stage|month|when/i.test(c)) || '';
    const rows = attachSections(all, roles);

    const hasDates = !!dateCol && rows.some(r => r[dateCol]);
    const total = rows.length;
    const doneCount = doneCol ? rows.filter(r => isChecked(r[doneCol])).length : 0;
    const overdue = hasDates
      ? rows.filter(r => !isChecked(r[doneCol]) && (daysUntil(r[dateCol]) ?? 1) < 0).length
      : 0;
    const pct = total ? (doneCount / total) * 100 : 0;

    const nextUp = hasDates
      ? rows.filter(r => !isChecked(r[doneCol]) && r[dateCol])
        .sort((a, b) => (parseSheetDate(a[dateCol])?.getTime() ?? Infinity) - (parseSheetDate(b[dateCol])?.getTime() ?? Infinity))
        .slice(0, 3)
      : [];

    const buckets = hasDates ? bucketByDate(rows, doneCol, dateCol) : bucketByPhase(rows, doneCol, phaseCol);

    const filter = state.filter[schema.sheet] || 'all';
    const searchQ = (state.search[schema.sheet] || '').toLowerCase();

    const match = r => {
      if (filter === 'overdue' && (!hasDates || isChecked(r[doneCol]) || (daysUntil(r[dateCol]) ?? 1) >= 0)) return false;
      if (filter === 'open' && isChecked(r[doneCol])) return false;
      if (filter === 'done' && !isChecked(r[doneCol])) return false;
      if (searchQ) {
        const hay = (schema.columns || []).map(c => String(r[c] ?? '')).join(' ').toLowerCase();
        if (!hay.includes(searchQ)) return false;
      }
      return true;
    };

    const visibleBuckets = buckets
      .map(b => ({ ...b, tasks: b.tasks.filter(match) }))
      .filter(b => b.tasks.length > 0);

    $('#view').innerHTML = `
      <div class="toolbar">
        <h1>${escapeHtml(schema.label)}</h1>
        <button class="btn btn-primary" id="tl-add">+ Add task</button>
      </div>

      ${renderStats([
      { label: 'Total', value: total },
      { label: 'Done', value: doneCount },
      { label: 'Open', value: total - doneCount },
      ...(hasDates ? [{ label: 'Overdue', value: overdue, hint: overdue > 0 ? 'needs attention' : '' }] : [])
    ])}

      ${renderProgress(pct, 'Overall progress')}

      ${nextUp.length ? `<h2>Next up</h2><div class="nextup">
        ${nextUp.map(r => renderNextUpCard(r, schema, doneCol, dateCol, nameCol)).join('')}
      </div>` : ''}

      <h2>All tasks</h2>
      <div class="ql-controls">
        <input type="search" id="tl-search" placeholder="Search tasks…" value="${escapeHtml(state.search[schema.sheet] || '')}">
      </div>
      <div class="chips">
        ${[{ key: 'all', label: 'All' }, { key: 'open', label: 'Open' },
      ...(hasDates ? [{ key: 'overdue', label: 'Overdue' }] : []),
      { key: 'done', label: 'Done' }]
        .map(c => `<button class="chip ${filter === c.key ? 'on' : ''}" data-filter="${c.key}">${escapeHtml(c.label)}</button>`).join('')}
      </div>
      <div id="tl-add-strip"></div>

      ${visibleBuckets.length === 0
        ? `<div class="ql-empty">${searchQ || filter !== 'all' ? 'No matches' : 'No tasks yet'}</div>`
        : visibleBuckets.map(b => `
            <div class="tl-bucket">
              <div class="tl-bucket-header">
                <span class="tl-bucket-name">${escapeHtml(b.label)}</span>
                <span class="tl-bucket-count">${b.tasks.length}</span>
              </div>
              <div class="ql-list">
                ${b.tasks.map(r => renderTimelineRow(r, schema, { doneCol, dateCol, nameCol, phaseCol })).join('')}
              </div>
            </div>`).join('')}
    `;

    bindTimelineEvents(schema, { doneCol, dateCol, phaseCol, hasDates });

    // "Next up" hero cards — tap to expand the matching row further down
    // the page. Each card carries data-id (rowId) and data-row (physical
    // sheet row) rendered by renderNextUpCard().
    $$('.nextup-card').forEach(card => {
      card.onclick = async () => {
        const id = card.dataset.id;
        if (!id) return;
        state.expanded = schema.sheet + ':' + id;

        // Await render() so the DOM has been updated by the time we
        // query for the newly expanded row below.
        await render();

        const expanded = document.querySelector('.ql-row.expanded');
        if (expanded && expanded.scrollIntoView) {
          expanded.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      };
    });

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed'); toast(err.message);
  }
}

function bucketByDate(rows, doneCol, dateCol) {
  const buckets = [
    { key: 'overdue', label: 'Overdue', tasks: [] },
    { key: 'today', label: 'Today', tasks: [] },
    { key: 'week', label: 'This week', tasks: [] },
    { key: 'month', label: 'This month', tasks: [] },
    { key: 'quarter', label: 'Next 3 months', tasks: [] },
    { key: 'later', label: 'Later', tasks: [] },
    { key: 'nodate', label: 'No date set', tasks: [] },
    { key: 'done', label: 'Done', tasks: [] }
  ];
  const byKey = Object.fromEntries(buckets.map(b => [b.key, b]));
  rows.forEach(r => {
    if (doneCol && isChecked(r[doneCol])) { byKey.done.tasks.push(r); return; }
    if (!r[dateCol]) { byKey.nodate.tasks.push(r); return; }
    const d = daysUntil(r[dateCol]);
    if (d == null) byKey.nodate.tasks.push(r);
    else if (d < 0) byKey.overdue.tasks.push(r);
    else if (d === 0) byKey.today.tasks.push(r);
    else if (d <= 7) byKey.week.tasks.push(r);
    else if (d <= 31) byKey.month.tasks.push(r);
    else if (d <= 90) byKey.quarter.tasks.push(r);
    else byKey.later.tasks.push(r);
  });
  buckets.forEach(b => {
    if (b.key === 'nodate' || b.key === 'done') return;
    b.tasks.sort((a, b2) => (parseSheetDate(a[dateCol])?.getTime() ?? Infinity) - (parseSheetDate(b2[dateCol])?.getTime() ?? Infinity));
  });
  return buckets.filter(b => b.tasks.length > 0);
}

function bucketByPhase(rows, doneCol, phaseCol) {
  if (!phaseCol) return [{ key: 'all', label: 'All tasks', tasks: rows.slice() }];
  const groups = {};
  rows.forEach(r => { const p = r[phaseCol] || 'Uncategorized'; (groups[p] = groups[p] || []).push(r); });
  return Object.entries(groups).map(([label, tasks]) => ({ key: label, label, tasks }));
}

function renderNextUpCard(row, schema, doneCol, dateCol, nameCol) {
  const id = rowId(row, schema);
  const name = row[nameCol] || '—';
  const dateVal = dateCol ? row[dateCol] : '';
  const d = dateVal ? daysUntil(dateVal) : null;
  const overdue = d != null && d < 0;
  let when = '';
  if (d != null) {
    if (d === 0) when = 'Today';
    else if (d === 1) when = 'Tomorrow';
    else if (d < 0) when = `${Math.abs(d)}d overdue`;
    else if (d < 7) when = `in ${d}d`;
    else when = fmtDateShort(dateVal);
  }
  return `<div class="nextup-card ${overdue ? 'overdue' : ''}" data-id="${escapeHtml(String(id))}" data-row="${row._row}">
    <div class="nextup-when">${escapeHtml(when)}</div>
    <div class="nextup-name">${escapeHtml(name)}</div>
    ${dateVal ? `<div class="nextup-date">${escapeHtml(fmtDate(dateVal))}</div>` : ''}
  </div>`;
}

function renderTimelineRow(row, schema, { doneCol, dateCol, nameCol, phaseCol }) {
  const id = rowId(row, schema);
  const key = schema.sheet + ':' + id;
  const expanded = state.expanded === key;
  const checked = doneCol ? isChecked(row[doneCol]) : false;
  const name = row[nameCol] || '—';
  const dateVal = dateCol ? row[dateCol] : '';
  const phase = phaseCol ? row[phaseCol] : '';
  const d = dateVal ? daysUntil(dateVal) : null;
  const overdue = !checked && d != null && d < 0;
  const dateBadge = (() => {
    if (!dateVal) return `<div class="tl-date tl-date-empty"></div>`;
    const date = parseSheetDate(dateVal);
    if (!date) return `<div class="tl-date tl-date-empty"></div>`;
    const month = date.toLocaleDateString(undefined, { month: 'short' });
    const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
    return `<div class="tl-date ${overdue ? 'overdue' : ''}">
      <div class="tl-date-month">${escapeHtml(month)}</div>
      <div class="tl-date-day">${date.getDate()}</div>
      <div class="tl-date-weekday">${escapeHtml(weekday)}</div>
    </div>`;
  })();
  return `<div class="ql-row tl-row ${checked ? 'done' : ''} ${expanded ? 'expanded' : ''}" data-id="${escapeHtml(String(id))}" data-row="${row._row}">
    <div class="ql-row-main">
      ${dateBadge}
      ${doneCol ? `<button type="button" class="ql-check ${checked ? 'on' : ''}" data-action="toggle">${checked ? '✓' : ''}</button>` : ''}
      <div class="ql-row-info" data-action="expand">
        <div class="ql-row-name">${escapeHtml(name)}</div>
        ${phase ? `<div class="ql-row-meta"><span class="pill">${escapeHtml(phase)}</span></div>` : ''}
      </div>
      <button type="button" class="ql-more" data-action="expand">⋯</button>
    </div>
    ${expanded ? renderInlineEditor(row, schema) : ''}
  </div>`;
}

function bindTimelineEvents(schema, roles) {
  $$('.chip').forEach(chip => {
    chip.onclick = () => { state.filter[schema.sheet] = chip.dataset.filter; render(); };
  });
  const search = $('#tl-search');
  if (search) search.oninput = debounce(() => { state.search[schema.sheet] = search.value; render(); }, 200);
  const addBtn = $('#tl-add');
  if (addBtn) addBtn.onclick = () => showQuickAdd(schema, detectFieldRoles(schema), $('#tl-add-strip'));

  bindRowInteractions(schema);
}

// ============================================================
// Shared row interaction binder (used by many views)
// ============================================================

function bindRowInteractions(schema, onExtraClick) {
  const view = $('#view');
  if (!view) return;
  view.onclick = async (e) => {
    const rowEl = e.target.closest('.ql-row');
    if (!rowEl) return;
    if (onExtraClick && await onExtraClick(e, rowEl)) return;
    const id = rowEl.dataset.id;
    const action = e.target.closest('[data-action]')?.dataset.action;

    if (action === 'toggle') return toggleCheck(schema, detectFieldRoles(schema), id, rowEl);
    if (action === 'expand') return toggleExpand(schema, id);
    if (action === 'save') return saveInline(schema, id, rowEl);
    if (action === 'cancel') { state.expanded = null; return render(); }
    if (action === 'delete') {
      if (!confirm('Delete this item?')) return;
      const res = await apiWrite('delete', schema.sheet, null, id, rowEl.dataset.row);
      if (res.error) return toast('Delete failed: ' + res.error);
      state.expanded = null; toast('Deleted'); render();
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
  const row = (state.data[schema.sheet] || []).find(r => String(rowId(r, schema)) === String(id));
  if (!row) return;
  const newVal = !isChecked(row[roles.checkField]);
  row[roles.checkField] = newVal;
  rowEl.classList.toggle('done', newVal);
  const btn = rowEl.querySelector('.ql-check');
  if (btn) { btn.classList.toggle('on', newVal); btn.textContent = newVal ? '✓' : ''; }
  const res = await apiWrite('update', schema.sheet, { [roles.checkField]: newVal }, id, row._row);
  if (res.error) {
    row[roles.checkField] = !newVal;
    rowEl.classList.toggle('done', !newVal);
    if (btn) { btn.classList.toggle('on', !newVal); btn.textContent = !newVal ? '✓' : ''; }
    toast('Save failed: ' + res.error);
  }
}

async function saveInline(schema, id, rowEl) {
  const editor = rowEl.querySelector('.ql-editor'); if (!editor) return;
  const data = readForm(editor);
  const res = await apiWrite('update', schema.sheet, data, id, rowEl.dataset.row);
  if (res.error) return toast('Save failed: ' + res.error);
  state.expanded = null; toast('Saved'); render();
}

function showQuickAdd(schema, roles, stripEl) {
  if (!stripEl) return;
  if (stripEl.firstChild) { stripEl.innerHTML = ''; return; }
  const cols = schema.columns || [];
  const quickFieldNames = (schema.quickAdd && schema.quickAdd.length)
    ? schema.quickAdd
    : [roles.nameField, roles.statusField, roles.dateField].filter(Boolean);
  const fields = quickFieldNames
    .filter(name => cols.find(c => c.toLowerCase() === name.toLowerCase()))
    .map(name => {
      const realName = cols.find(c => c.toLowerCase() === name.toLowerCase());
      return { name: realName, label: realName, type: guessType(realName) };
    });
  if (fields.length === 0 && roles.nameField) {
    fields.push({ name: roles.nameField, label: roles.nameField, type: 'text' });
  }
  stripEl.innerHTML = `<div class="ql-quick-add" id="ql-quick-add">
    ${fields.map(f => renderField(f, '', true)).join('')}
    <div class="ql-quick-actions">
      <button type="button" class="btn" data-action="cancel">Cancel</button>
      <button type="button" class="btn btn-primary" data-action="create">Add</button>
    </div>
  </div>`;
  const form = $('#ql-quick-add');
  form.querySelector('input, select, textarea')?.focus();
  form.onkeydown = (e) => { if (e.key === 'Escape') stripEl.innerHTML = ''; };
  form.onclick = async (e) => {
    const action = e.target.dataset.action;
    if (action === 'cancel') { stripEl.innerHTML = ''; return; }
    if (action !== 'create') return;
    const data = readForm(form);
    if (roles.nameField && !data[roles.nameField]) return toast('Please enter a value');
    const res = await apiWrite('create', schema.sheet, data);
    if (res.error) return toast('Add failed: ' + res.error);
    toast('Added'); stripEl.innerHTML = ''; render();
  };
}

// ============================================================
// VIEW: Quick list
// ============================================================

async function renderQuickList(schema) {
  setStatus('Loading…');
  try {
    const res = await apiGetRows(schema.sheet);
    if (res.error) throw new Error(res.error);
    const all = res.rows || [];
    state.data[schema.sheet] = all;

    if (all.length > 0 && !schema.columns) schema.columns = Object.keys(all[0]).filter(k => k !== '_row');
    const cols = schema.columns || [];
    const roles = detectFieldRoles(schema);
    Object.assign(schema, roles);

    const rows = attachSections(all, roles);
    const q = (state.search[schema.sheet] || '').toLowerCase();
    const filtered = q ? rows.filter(r => cols.some(c => String(r[c] ?? '').toLowerCase().includes(q))) : rows;
    const doneCount = roles.checkField ? rows.filter(r => isChecked(r[roles.checkField])).length : 0;
    const pct = rows.length && roles.checkField ? (doneCount / rows.length) * 100 : 0;

    $('#view').innerHTML = `
      <div class="toolbar">
        <h1>${escapeHtml(schema.label)}</h1>
        <button class="btn btn-primary" id="ql-add">+ Add</button>
      </div>
      <div class="ql-controls">
        <input type="search" id="ql-search" placeholder="Search…" value="${escapeHtml(state.search[schema.sheet] || '')}">
      </div>
      <div id="ql-add-strip"></div>
      ${roles.checkField
        ? `<div class="ql-progress"><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
            <div class="ql-progress-text">${doneCount} / ${rows.length} done</div></div>`
        : `<div class="ql-progress-text ql-count">${rows.length} item${rows.length === 1 ? '' : 's'}</div>`}
      <div class="ql-list" id="ql-list">
        ${filtered.length === 0
        ? `<div class="ql-empty">${q ? 'No matches' : 'Nothing yet — tap <b>+ Add</b> to start'}</div>`
        : renderGrouped(filtered, schema, roles, renderQuickRow)}
      </div>`;

    bindRowInteractions(schema);
    const search = $('#ql-search');
    if (search) search.oninput = debounce(() => { state.search[schema.sheet] = search.value; renderQuickList(schema); }, 200);
    const addBtn = $('#ql-add');
    if (addBtn) addBtn.onclick = () => showQuickAdd(schema, roles, $('#ql-add-strip'));

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) { setStatus('Failed'); toast(err.message); }
}

function renderGrouped(rows, schema, roles, rowRenderer) {
  const groups = [];
  const index = {};
  rows.forEach(r => {
    const sec = r._section || '';
    if (!(sec in index)) { index[sec] = groups.length; groups.push({ section: sec, rows: [] }); }
    groups[index[sec]].rows.push(r);
  });
  if (groups.length === 1 && !groups[0].section) {
    return groups[0].rows.map(r => rowRenderer(r, schema, roles)).join('');
  }
  return groups.map(g => `
    ${g.section ? `<div class="section-header">
      <span class="section-header-name">${escapeHtml(g.section)}</span>
      <span class="section-header-count">${g.rows.length}</span>
    </div>` : ''}
    ${g.rows.map(r => rowRenderer(r, schema, roles)).join('')}
  `).join('');
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
  return `<div class="ql-row ${checked ? 'done' : ''} ${expanded ? 'expanded' : ''}" data-id="${escapeHtml(String(id))}" data-row="${row._row}">
    <div class="ql-row-main">
      ${roles.checkField ? `<button type="button" class="ql-check ${checked ? 'on' : ''}" data-action="toggle">${checked ? '✓' : ''}</button>` : ''}
      <div class="ql-row-info" data-action="expand">
        <div class="ql-row-name">${escapeHtml(name)}</div>
        ${(status || dateVal) ? `<div class="ql-row-meta">
          ${status ? `<span class="pill">${escapeHtml(String(status))}</span>` : ''}
          ${dateVal ? `<span class="ql-row-date ${overdue ? 'overdue' : ''}">${escapeHtml(fmtDateShort(dateVal))}</span>` : ''}
        </div>` : ''}
      </div>
      <button type="button" class="ql-more" data-action="expand">⋯</button>
    </div>
    ${expanded ? renderInlineEditor(row, schema) : ''}
  </div>`;
}

// ============================================================
// VIEW: Budget  (also used for Bridal List)
// ============================================================

async function renderBudget(schema) {
  setStatus('Loading budget…');
  try {
    const res = await apiGetRows(schema.sheet);
    if (res.error) throw new Error(res.error);
    const all = res.rows || [];
    state.data[schema.sheet] = all;

    if (all.length > 0 && !schema.columns) schema.columns = Object.keys(all[0]).filter(k => k !== '_row');
    const roles = detectFieldRoles(schema);
    Object.assign(schema, roles);

    const rows = (schema.sheet === 'budget_flat')
      ? all.map(r => ({ ...r, _section: r.section || 'Other' }))
      : attachSections(all, roles);

    const num = v => Number(v) || 0;
    const getB = r => num(pick(r, 'budgeted', 'Budgeted', 'Budgeted Cost'));
    const getA = r => num(pick(r, 'actual', 'Actual', 'Actual Cost'));
    const getD = r => num(pick(r, 'deposit', 'Deposit', 'Paid', 'Deposit Made'));
    const sectionOf = r => pick(r, 'section', 'Section', '_section') || 'Other';
    const itemOf = r => pick(r, 'item', 'Item', roles.nameField);

    const totalBudgeted = rows.reduce((s, r) => s + getB(r), 0);
    const totalActual = rows.reduce((s, r) => s + getA(r), 0);
    const totalPaid = rows.reduce((s, r) => s + getD(r), 0);
    const outstanding = totalActual - totalPaid;
    const remaining = totalBudgeted - totalActual;

    const bySection = {};
    rows.forEach(r => {
      const sec = sectionOf(r);
      if (!bySection[sec]) bySection[sec] = { budgeted: 0, actual: 0, paid: 0, items: [] };
      bySection[sec].budgeted += getB(r);
      bySection[sec].actual += getA(r);
      bySection[sec].paid += getD(r);
      bySection[sec].items.push(r);
    });

    $('#view').innerHTML = `
      <div class="toolbar">
        <h1>${escapeHtml(schema.label)}</h1>
        <button class="btn btn-primary" id="bd-add">+ Add expense</button>
      </div>
      ${renderStats([
      { label: 'Budgeted', value: money(totalBudgeted) },
      { label: 'Spent', value: money(totalActual), hint: remaining >= 0 ? money(remaining) + ' left' : money(-remaining) + ' over' },
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
      return `<div class="section-card">
            <div class="section-name">${escapeHtml(name)}</div>
            <div class="section-numbers">
              <span class="spent">${money(sec.actual)}</span>
              <span class="muted">of ${money(sec.budgeted)}</span>
            </div>
            ${renderProgress(used, '')}
            ${over ? `<div class="over-badge">Over by ${money(sec.actual - sec.budgeted)}</div>` : ''}
<div class="section-items">
  ${sec.items.map((it, i) => {
        const hiddenClass = i >= 5 ? ' hidden-until-expand' : '';
        return renderBudgetItem(it, rows, schema).replace(
          'class="budget-item',
          `class="budget-item${hiddenClass}`
        );
      }).join('')}
  ${sec.items.length > 5 ? `<div class="more more-expand">+ ${sec.items.length - 5} more</div>` : ''}
</div>
          </div>`;
    }).join('')}
      </div>`;

    // Resolve real column names once — reused by the quick-add form below.
    const cols = schema.columns || [];
    const findCol = (...cands) => {
      for (const c of cands) {
        const hit = cols.find(x => String(x).toLowerCase() === c.toLowerCase());
        if (hit) return hit;
      }
      return '';
    };
    const itemColName = findCol('item', 'task');
    const sectionColName = findCol('section');
    const budgetedColName = findCol('budgeted', 'budgeted cost');
    const actualColName = findCol('actual', 'actual cost');

    document.getElementById('bd-add').onclick = () => {
      const strip = document.getElementById('bd-add-strip');
      if (strip.firstChild) { strip.innerHTML = ''; return; }

      const fields = [
        itemColName && { name: itemColName, label: 'Item' },
        sectionColName && { name: sectionColName, label: 'Section' },
        budgetedColName && { name: budgetedColName, label: 'Budgeted', type: 'number' },
        actualColName && { name: actualColName, label: 'Actual', type: 'number' }
      ].filter(Boolean);

      strip.innerHTML = `<div class="ql-quick-add" id="bd-quick-add">
        ${fields.map(f => renderField(f, '', true)).join('')}
        <div class="ql-quick-actions">
          <button type="button" class="btn" data-action="cancel">Cancel</button>
          <button type="button" class="btn btn-primary" data-action="create">Add</button>
        </div>
      </div>`;

      const form = document.getElementById('bd-quick-add');
      form.querySelector('input')?.focus();
      form.onclick = async (e) => {
        const action = e.target.dataset.action;
        if (action === 'cancel') { strip.innerHTML = ''; return; }
        if (action !== 'create') return;
        const data = readForm(form);
        if (itemColName && !data[itemColName]) return toast('Item is required');
        const res = await apiWrite('create', schema.sheet, data);
        if (res.error) return toast('Add failed: ' + res.error);
        toast('Added'); strip.innerHTML = ''; render();
      };
    };

    $$('.budget-item[data-row]').forEach(el => {
      el.onclick = () => {
        const row = rows.find(r => r._row === Number(el.dataset.row));
        if (!row) return;
        state.expanded = schema.sheet + ':' + rowId(row, schema);
        const card = el.closest('.section-card');
        card.querySelector('.section-items').innerHTML =
          renderBudgetEditor(row, schema) +
          `<div class="more" data-role="close" style="cursor:pointer">Close</div>`;
        card.querySelector('[data-role="close"]').onclick = () => render();
        bindBudgetEditor(schema, row, card);
      };
    });

    $$('.section-card').forEach(card => {
      const more = card.querySelector('.more-expand');
      if (more) {
        more.onclick = (e) => {
          e.stopPropagation();
          card.classList.toggle('expanded');
          more.textContent = card.classList.contains('expanded')
            ? 'Show less'
            : `+ ${card.querySelectorAll('.hidden-until-expand').length} more`;
        };
      }
    });

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) { setStatus('Failed'); toast(err.message); }
}

function renderBudgetItem(row, allRows, schema) {
  const num = v => Number(v) || 0;
  const budgeted = num(pick(row, 'budgeted', 'Budgeted', 'Budgeted Cost'));
  const actual = num(pick(row, 'actual', 'Actual', 'Actual Cost'));
  const paid = num(pick(row, 'deposit', 'Deposit', 'Paid', 'Deposit Made'));
  const over = actual > budgeted && budgeted > 0;
  const fullyPaid = actual > 0 && paid >= actual;
  return `<div class="budget-item ${over ? 'over' : ''}" data-row="${row._row}">
    <div class="bi-name">${escapeHtml(pick(row, 'item', 'Item') || '—')}</div>
    <div class="bi-amounts">
      <span>${money(actual || budgeted)}</span>
      ${fullyPaid ? '<span class="pill pill-green">Paid</span>'
      : paid > 0 ? `<span class="pill pill-amber">${money(actual - paid)} due</span>` : ''}
    </div>
  </div>`;
}

function renderBudgetEditor(row, schema) {
  const cols = schema.columns || [];

  // Case-insensitive lookup across the schema's real column names,
  // so this works for both budget_flat (lowercase) and Bridal List
  // (Title Case). Returns '' if none of the candidates exist.
  const find = (...cands) => {
    for (const c of cands) {
      const hit = cols.find(x => String(x).toLowerCase() === c.toLowerCase());
      if (hit) return hit;
    }
    return '';
  };

  const fields = [
    { name: find('item', 'task'), label: 'Item' },
    { name: find('section'), label: 'Section' },
    { name: find('budgeted', 'budgeted cost'), label: 'Budgeted', type: 'number' },
    { name: find('actual', 'actual cost'), label: 'Actual', type: 'number' },
    { name: find('deposit', 'deposit made', 'paid'), label: 'Paid', type: 'number' }
  ].filter(f => f.name);   // drop any column that doesn't exist on this sheet

  return `<div class="ql-editor" data-row="${row._row}">
    ${fields.map(f => renderField(f, row[f.name] ?? '')).join('')}
    <div class="ql-editor-actions">
      <button type="button" class="btn btn-danger" data-action="delete">Delete</button>
      <button type="button" class="btn btn-primary" data-action="save">Save</button>
    </div>
  </div>`;
}

function bindBudgetEditor(schema, row, card) {
  const editor = card.querySelector('.ql-editor'); if (!editor) return;
  editor.onclick = async (e) => {
    const action = e.target.dataset.action;
    if (action === 'save') {
      const data = readForm(editor);
      const res = await apiWrite('update', schema.sheet, data, rowId(row, schema), row._row);
      if (res.error) return toast('Save failed: ' + res.error);
      toast('Saved'); render();
    }
    if (action === 'delete') {
      if (!confirm('Delete this item?')) return;
      const res = await apiWrite('delete', schema.sheet, null, rowId(row, schema), row._row);
      if (res.error) return toast('Delete failed: ' + res.error);
      toast('Deleted'); render();
    }
  };
}

// ============================================================
// VIEW: Guests
// ============================================================

async function renderGuests(schema) {
  setStatus('Loading guests…');
  try {
    const res = await apiGetRows(schema.sheet);
    if (res.error) throw new Error(res.error);
    const rows = res.rows || [];
    state.data[schema.sheet] = rows;

    if (rows.length > 0 && !schema.columns) schema.columns = Object.keys(rows[0]).filter(k => k !== '_row');
    const cols = schema.columns || [];
    const roles = detectFieldRoles(schema);
    Object.assign(schema, roles);

    const nameCol = cols.find(c => /name/i.test(c)) || cols[0];
    const catCol = cols.find(c => /category/i.test(c)) || '';
    const respCol = cols.find(c => /response/i.test(c)) || '';
    const hotelCol = cols.find(c => /accom/i.test(c)) || '';
    const countCol = cols.find(c => /number|count|expect/i.test(c)) || '';

    const total = rows.reduce((s, r) => s + (Number(r[countCol]) || 0), 0);
    const coming = rows.filter(r => r[respCol] === 'Coming').reduce((s, r) => s + (Number(r[countCol]) || 0), 0);
    const pending = rows.filter(r => !r[respCol] || r[respCol] === 'Pending').reduce((s, r) => s + (Number(r[countCol]) || 0), 0);
    const needHotel = rows.filter(r => r[hotelCol] === 'Hotel').length;

    const categories = catCol ? Array.from(new Set(rows.map(r => r[catCol]).filter(Boolean))).sort() : [];
    const activeCat = state.filter[schema.sheet] || 'All';
    const respFilters = ['All', 'Coming', 'Pending', 'Not Coming'];
    const activeResp = state.filter[schema.sheet + '_resp'] || 'All';
    const q = (state.search[schema.sheet] || '').toLowerCase();

    let filtered = rows;
    if (activeCat !== 'All' && catCol) filtered = filtered.filter(r => r[catCol] === activeCat);
    if (activeResp !== 'All') {
      filtered = filtered.filter(r => {
        const v = respCol ? r[respCol] : '';
        if (activeResp === 'Pending') return !v || v === 'Pending';
        return v === activeResp;
      });
    }
    if (q) filtered = filtered.filter(r => cols.some(c => String(r[c] ?? '').toLowerCase().includes(q)));

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
        <input type="search" id="g-search" placeholder="Search guests…" value="${escapeHtml(state.search[schema.sheet] || '')}">
        <div class="chips">
          ${respFilters.map(f =>
      `<button class="chip chip-resp ${activeResp === f ? 'on' : ''}" data-resp-filter="${escapeHtml(f)}">${escapeHtml(f)}</button>`
    ).join('')}
        </div>
      </div>
      ${categories.length ? `<div class="chips">
        <button class="chip ${activeCat === 'All' ? 'on' : ''}" data-cat="All">All</button>
        ${categories.map(c => `<button class="chip ${activeCat === c ? 'on' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
      </div>` : ''}
      <div id="g-add-strip"></div>
      <div class="ql-list" id="g-list">
        ${filtered.length === 0
        ? `<div class="ql-empty">${q || activeCat !== 'All' ? 'No matches' : 'No guests yet'}</div>`
        : filtered.map(r => renderGuestRow(r, schema, { nameCol, catCol, respCol, hotelCol })).join('')}
      </div>`;

    const search = $('#g-search');
    if (search) search.oninput = debounce(() => { state.search[schema.sheet] = search.value; renderGuests(schema); }, 200);

    // Category chips only — must NOT match response chips, because those
    // carry class="chip chip-resp" and are wired up separately below.
    $$('.chip[data-cat]').forEach(chip => {
      chip.onclick = () => {
        state.filter[schema.sheet] = chip.dataset.cat;
        renderGuests(schema);
      };
    });

    $$('.chip-resp').forEach(chip => {
      chip.onclick = () => {
        state.filter[schema.sheet + '_resp'] = chip.dataset.respFilter;
        renderGuests(schema);
      };
    });

    $('#g-add').onclick = () => showQuickAdd(schema, roles, $('#g-add-strip'));

    $('#g-list').onclick = async (e) => {
      const rowEl = e.target.closest('.ql-row'); if (!rowEl) return;
      const id = rowEl.dataset.id;

      // RSVP buttons (✓ / ✕) and the expanded RSVP chips
      const rsvp = e.target.closest('[data-rsvp]');
      if (rsvp && respCol) {
        const value = rsvp.dataset.rsvp;
        const row = rows.find(r => String(rowId(r, schema)) === String(id));
        if (!row) return;
        row[respCol] = value;
        const res = await apiWrite('update', schema.sheet, { [respCol]: value }, id, row._row);
        if (res.error) return toast('Save failed: ' + res.error);
        toast('RSVP → ' + value); return render();
      }

      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'expand') return toggleExpand(schema, id);
      if (action === 'cancel') { state.expanded = null; return render(); }
      if (action === 'save') return saveInline(schema, id, rowEl);
      if (action === 'delete') {
        if (!confirm('Delete this guest?')) return;
        const res = await apiWrite('delete', schema.sheet, null, id, rowEl.dataset.row);
        if (res.error) return toast('Delete failed: ' + res.error);
        state.expanded = null; toast('Deleted'); render();
      }
    };

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) { setStatus('Failed'); toast(err.message); }
}

function renderGuestRow(row, schema, { nameCol, catCol, respCol, hotelCol }) {
  const id = rowId(row, schema);
  const key = schema.sheet + ':' + id;
  const expanded = state.expanded === key;
  const name = row[nameCol] || '—';
  const response = respCol ? row[respCol] : '';
  const hotel = hotelCol ? row[hotelCol] : '';
  const category = catCol ? row[catCol] : '';
  const responseClass = response === 'Coming' ? 'pill-green' : response === 'Not Coming' ? 'pill-red' : '';
  const showCategory = catCol && (state.filter[schema.sheet] || 'All') === 'All';
  return `<div class="ql-row guest-row
    ${response === 'Coming' ? 'guest-coming' : ''}
    ${response === 'Not Coming' ? 'guest-not-coming' : ''}
    ${expanded ? 'expanded' : ''}"
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
      ${respCol ? `<div class="guest-actions">
        <button type="button" class="guest-btn yes ${response === 'Coming' ? 'active' : ''}"
                data-rsvp="Coming" title="Coming">✓</button>
        <button type="button" class="guest-btn no ${response === 'Not Coming' ? 'active' : ''}"
                data-rsvp="Not Coming" title="Not coming">✕</button>
      </div>` : ''}
      <button type="button" class="ql-more" data-action="expand">⋯</button>
    </div>
    ${expanded ? `
      ${respCol ? `<div class="rsvp-row">
        <span class="rsvp-label">RSVP:</span>
        ${['Coming', 'Pending', 'Not Coming'].map(v => `<button class="rsvp-chip ${response === v ? 'on' : ''}" data-rsvp="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join('')}
      </div>` : ''}
      ${renderInlineEditor(row, schema)}
    ` : ''}
  </div>`;
}

// ============================================================
// VIEW: Gifts / Cash
// ============================================================

async function renderGifts(schema) {
  setStatus('Loading…');
  try {
    const res = await apiGetRows(schema.sheet);
    if (res.error) throw new Error(res.error);
    const rows = res.rows || [];
    state.data[schema.sheet] = rows;

    if (rows.length > 0 && !schema.columns) schema.columns = Object.keys(rows[0]).filter(k => k !== '_row');
    const cols = schema.columns || [];
    const roles = detectFieldRoles(schema);
    Object.assign(schema, roles);

    const nameCol = cols.find(c => /name/i.test(c)) || cols[0];
    const amountCol = cols.find(c => /amount|value|contribution/i.test(c)) || '';
    const thankCol = roles.checkField || '';
    const dateCol = cols.find(c => /date/i.test(c)) || '';

    const total = rows.length;
    const thanked = thankCol ? rows.filter(r => isChecked(r[thankCol])).length : 0;
    const sumAmount = amountCol ? rows.reduce((s, r) => s + (Number(r[amountCol]) || 0), 0) : 0;

    const stats = [{ label: 'Total', value: total }];
    if (amountCol) stats.push({ label: 'Sum', value: money(sumAmount) });
    if (thankCol) stats.push({ label: 'Acknowledged', value: thanked });

    const q = (state.search[schema.sheet] || '').toLowerCase();
    const filtered = q ? rows.filter(r => cols.some(c => String(r[c] ?? '').toLowerCase().includes(q))) : rows;

    $('#view').innerHTML = `
      <div class="toolbar">
        <h1>${escapeHtml(schema.label)}</h1>
        <button class="btn btn-primary" id="gf-add">+ Add</button>
      </div>
      ${renderStats(stats)}
      ${thankCol && total ? renderProgress((thanked / total) * 100, 'Acknowledged') : ''}
      <div class="ql-controls">
        <input type="search" id="gf-search" placeholder="Search…" value="${escapeHtml(state.search[schema.sheet] || '')}">
      </div>
      <div id="gf-add-strip"></div>
      <div class="ql-list" id="gf-list">
        ${filtered.length === 0 ? `<div class="ql-empty">${q ? 'No matches' : 'Nothing yet'}</div>`
        : filtered.map(r => renderGiftRow(r, schema, { nameCol, amountCol, thankCol, dateCol })).join('')}
      </div>`;

    const search = $('#gf-search');
    if (search) search.oninput = debounce(() => { state.search[schema.sheet] = search.value; renderGifts(schema); }, 200);
    $('#gf-add').onclick = () => showQuickAdd(schema, roles, $('#gf-add-strip'));
    bindRowInteractions(schema);

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) { setStatus('Failed'); toast(err.message); }
}

function renderGiftRow(row, schema, { nameCol, amountCol, thankCol, dateCol }) {
  const id = rowId(row, schema);
  const key = schema.sheet + ':' + id;
  const expanded = state.expanded === key;
  const checked = thankCol ? isChecked(row[thankCol]) : false;
  const name = row[nameCol] || '—';
  const amount = amountCol ? row[amountCol] : '';
  const date = dateCol ? row[dateCol] : '';
  return `<div class="ql-row ${checked ? 'done' : ''} ${expanded ? 'expanded' : ''}" data-id="${escapeHtml(String(id))}" data-row="${row._row}">
    <div class="ql-row-main">
      ${thankCol ? `<button type="button" class="ql-check ${checked ? 'on' : ''}" data-action="toggle">${checked ? '✓' : ''}</button>` : ''}
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
  </div>`;
}

// ============================================================
// VIEW: Vendors (merged from 4 source sheets)
// ============================================================

async function renderVendors() {
  setStatus('Loading vendors…');
  try {
    const results = await Promise.all(VENDOR_SOURCES.map(s => apiGetRows(s.sheet)));

    const vendors = [];
    results.forEach((res, i) => {
      if (res.error) return;
      (res.rows || []).forEach(r => {
        vendors.push(normalizeVendor(r, VENDOR_SOURCES[i]));
      });
    });

    // Only show vendors with a name
    const named = vendors.filter(v => v.name);

    // Filter chips
    const kinds = ['All', ...Array.from(new Set(named.map(v => v.kind)))];
    const activeKind = state.filter._vendors || 'All';
    const q = (state.search._vendors || '').toLowerCase();

    let filtered = named;
    if (activeKind !== 'All') filtered = filtered.filter(v => v.kind === activeKind);
    if (q) filtered = filtered.filter(v => Object.values(v).some(val => String(val).toLowerCase().includes(q)));

    // Group by stage
    const stageOrder = ['Chosen/Approved', 'Paid', 'Waiting on Final Proposal', 'Quote Received', 'Call Scheduled', 'Inquiries Made', 'Contract Sent', 'Contract Signed', 'Deposit Made'];
    const byStage = {};
    filtered.forEach(v => {
      const st = v.stage || '— No stage —';
      (byStage[st] = byStage[st] || []).push(v);
    });
    const stages = Object.keys(byStage).sort((a, b) => {
      const ia = stageOrder.indexOf(a), ib = stageOrder.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    $('#view').innerHTML = `
      <div class="toolbar">
        <h1>Vendors</h1>
        <span class="pill">${named.length} total</span>
      </div>
      <div class="ql-controls">
        <input type="search" id="v-search" placeholder="Search vendors, types, phones…" value="${escapeHtml(state.search._vendors || '')}">
      </div>
      <div class="chips">
        ${kinds.map(k => `<button class="chip ${activeKind === k ? 'on' : ''}" data-kind="${escapeHtml(k)}">${escapeHtml(k)}</button>`).join('')}
      </div>
      ${stages.length === 0 ? `<div class="ql-empty">No vendors match</div>` :
        stages.map(stage => `
          <div class="tl-bucket">
            <div class="tl-bucket-header">
              <span class="tl-bucket-name">${escapeHtml(stage)}</span>
              <span class="tl-bucket-count">${byStage[stage].length}</span>
            </div>
            <div class="ql-list">
              ${byStage[stage].map(renderVendorRow).join('')}
            </div>
          </div>`).join('')}
    `;

    const search = $('#v-search');
    if (search) search.oninput = debounce(() => { state.search._vendors = search.value; renderVendors(); }, 200);
    $$('.chip[data-kind]').forEach(chip => {
      chip.onclick = () => { state.filter._vendors = chip.dataset.kind; renderVendors(); };
    });

    // Expand/collapse vendor card
    $('#view').onclick = (e) => {
      const card = e.target.closest('.vendor-card'); if (!card) return;
      card.classList.toggle('expanded');
    };

    // Edit stage via select
    $$('.vendor-stage-select').forEach(sel => {
      sel.onchange = async () => {
        const rowEl = sel.closest('.vendor-card');
        const source = rowEl.dataset.source;
        const rowNum = rowEl.dataset.row;
        const fieldName = rowEl.dataset.stageField;
        const newVal = sel.value;
        const res = await apiWrite('update', source, { [fieldName]: newVal }, null, rowNum);
        if (res.error) { toast('Save failed: ' + res.error); sel.value = rowEl.dataset.prevStage; return; }
        toast('Stage → ' + newVal);
        rowEl.dataset.prevStage = newVal;
      };
    });

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) { setStatus('Failed'); toast(err.message); }
}

function normalizeVendor(row, src) {
  const stageField = ['Stage of Communication', 'Stage'].find(k => row[k] !== undefined) || 'Stage of Communication';
  return {
    _source: src.sheet,
    _row: row._row,
    _stageField: stageField,
    kind: src.kind,
    name: pick(row, 'Wedding Vendor/Company', 'Name/Company', 'Vendor', 'Vendor/Company'),
    type: pick(row, 'Type', 'Food items'),
    stage: pick(row, 'Stage of Communication', 'Stage'),
    tier: pick(row, 'Tier'),
    contact: pick(row, 'Contact Person'),
    phone: pick(row, 'Phone number', 'Phone numbers'),
    address: pick(row, 'Address', 'Location'),
    city: pick(row, 'City/State'),
    price: pick(row, 'Price', 'Price(for comparison)'),
    notes: pick(row, 'Notes (Bride)', 'Notes'),
    _raw: row
  };
}

function renderVendorRow(v) {
  const phone = v.phone || '';
  const tel = telLink(phone);
  const wa = waLink(phone);
  return `<div class="ql-row vendor-card" data-source="${escapeHtml(v._source)}" data-row="${v._row}" data-stage-field="${escapeHtml(v._stageField)}" data-prev-stage="${escapeHtml(v.stage)}">
    <div class="ql-row-main">
      <div class="ql-row-info">
        <div class="ql-row-name">${escapeHtml(v.name)}</div>
        <div class="ql-row-meta">
          ${v.type ? `<span class="pill">${escapeHtml(v.type)}</span>` : ''}
          ${v.tier ? `<span class="pill">${escapeHtml(v.tier)}</span>` : ''}
          ${v.city ? `<span class="pill">${escapeHtml(v.city)}</span>` : ''}
        </div>
      </div>
      <button type="button" class="ql-more">⋯</button>
    </div>
    <div class="vendor-actions">
      <select class="vendor-stage-select">
        ${['Inquiries Made', 'Call Scheduled', 'Quote Received', 'Waiting on Final Proposal', 'Chosen/Approved', 'Paid', 'Cut - Budget', 'Cut - don\'t trust', 'Cut - Other']
      .map(s => `<option value="${s}" ${s === v.stage ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      ${phone ? `
        <a class="vendor-action" href="${escapeHtml(tel)}">📞 Call</a>
        <a class="vendor-action wa" href="${escapeHtml(wa)}" target="_blank" rel="noopener">💬 WhatsApp</a>
      ` : ''}
    </div>
    <div class="vendor-details">
      ${v.contact ? `<div><span class="vendor-dl">Contact:</span> ${escapeHtml(v.contact)}</div>` : ''}
      ${v.phone ? `<div><span class="vendor-dl">Phone:</span> ${escapeHtml(v.phone)}</div>` : ''}
      ${v.address ? `<div><span class="vendor-dl">Address:</span> ${escapeHtml(v.address)}</div>` : ''}
      ${v.price ? `<div><span class="vendor-dl">Price:</span> ${escapeHtml(String(v.price))}</div>` : ''}
      ${v.notes ? `<div><span class="vendor-dl">Notes:</span> ${escapeHtml(v.notes)}</div>` : ''}
    </div>
  </div>`;
}


// ============================================================
// VIEW: Global search
// ============================================================

async function renderSearch() {
  const q = state.globalSearch.trim();
  if (!q) { $('#view').innerHTML = '<h1>Search</h1><p class="muted">Type in the search box above.</p>'; return; }

  setStatus('Searching…');
  const sources = [
    ...state.schema.filter(s => s.type === 'data').map(s => s.sheet),
    ...VENDOR_SOURCES.map(s => s.sheet)
  ];
  const unique = Array.from(new Set(sources));

  // Fetch any missing sheets
  await Promise.all(unique.map(async name => {
    if (state.data[name]) return;
    const r = await apiGetRows(name);
    if (!r.error) state.data[name] = r.rows || [];
  }));

  const lower = q.toLowerCase();
  const results = [];
  unique.forEach(sheet => {
    const rows = state.data[sheet] || [];
    const matches = rows.filter(r => {
      for (const k of Object.keys(r)) {
        if (k === '_row') continue;
        const v = r[k];
        if (v == null) continue;
        if (String(v).toLowerCase().includes(lower)) return true;
      }
      return false;
    });
    if (matches.length > 0) results.push({ sheet, matches });
  });

  const schemaBySheet = {};
  state.schema.forEach(s => { schemaBySheet[s.sheet] = s; });

  $('#view').innerHTML = `
    <h1>Search results</h1>
    <p class="muted">"${escapeHtml(q)}" — ${results.reduce((s, r) => s + r.matches.length, 0)} matches across ${results.length} sheets</p>
    ${results.length === 0 ? '<div class="ql-empty">Nothing found</div>' :
      results.map(r => {
        const sch = schemaBySheet[r.sheet];
        return `<h2>${escapeHtml(sch ? sch.label : r.sheet)} <span class="pill">${r.matches.length}</span></h2>
          <div class="ql-list">
            ${r.matches.slice(0, 10).map(row => {
          // Show only non-empty fields in preview
          const preview = Object.entries(row)
            .filter(([k, v]) => k !== '_row' && v != null && v !== '' && String(v).length < 60)
            .slice(0, 3)
            .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`)
            .join(' · ');
          return `<div class="ql-row" style="cursor:default">
                <div class="ql-row-main">
                  <div class="ql-row-info">
                    <div class="ql-row-name">${escapeHtml(String(row[Object.keys(row)[1]] || '—'))}</div>
                    <div class="ql-row-meta">${preview}</div>
                  </div>
                </div>
              </div>`;
        }).join('')}
            ${r.matches.length > 10 ? `<div class="more">+ ${r.matches.length - 10} more</div>` : ''}
          </div>`;
      }).join('')}
  `;
  setStatus('Synced ' + new Date().toLocaleTimeString());
}

// ============================================================
// VIEW: Link
// ============================================================

function renderLinkView(schema) {
  $('#view').innerHTML = `
    <h1>${escapeHtml(schema.label)}</h1>
    <p>This view lives in the Google Sheet.
      <a href="${escapeHtml(schema.url)}" target="_blank" rel="noopener">Open it ↗</a></p>`;
  setStatus('External link');
}

// ============================================================
// Navigation
// ============================================================

function renderNav() {
  const nav = $('#nav'); if (!nav) return;

  const items = [];
  VIRTUAL_NAV.forEach(v => items.push({ route: v.route, label: v.label, order: v.order }));
  state.schema.filter(s => s.type !== 'link').forEach(s => {
    items.push({ route: s.sheet, label: s.label, order: s.sortOrder });
  });
  // Links (external)
  state.schema.filter(s => s.type === 'link').forEach(s => {
    items.push({ route: '__link__' + s.sheet, label: s.label + ' ↗', order: s.sortOrder, url: s.url });
  });

  items.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

  nav.innerHTML = items.map(it => {
    if (it.url) {
      return `<a href="${escapeHtml(it.url)}" target="_blank" rel="noopener" class="external-link">${escapeHtml(it.label)}</a>`;
    }
    const active = state.route === it.route ? 'class="active"' : '';
    return `<a href="#/${encodeURIComponent(it.route)}" ${active}>${escapeHtml(it.label)}</a>`;
  }).join('');
}

async function routeTo(route) {
  state.route = route;
  state.expanded = null;
  renderNav();
  await render();
}

// ============================================================
// Global search
// ============================================================

function bindGlobalSearch() {
  const input = $('#global-search'); if (!input) return;
  input.oninput = debounce(() => {
    const q = input.value.trim();
    state.globalSearch = input.value;
    if (!q) {
      if (state.route === '_search') routeTo(state.previousRoute || '_overview');
      return;
    }
    if (state.route !== '_search') state.previousRoute = state.route;
    state.route = '_search';
    renderNav();
    renderSearch();
  }, 250);
}

function initMenuToggle() {
  const btn = $('#menu-toggle');
  const sidebar = $('.sidebar');
  const backdrop = $('#menu-backdrop');
  if (!btn || !sidebar || !backdrop) return;

  btn.onclick = () => {
    sidebar.classList.toggle('open');
    backdrop.classList.toggle('show');
  };
  backdrop.onclick = () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
  };
  document.addEventListener('click', (e) => {
    if (e.target.closest('#nav a') || e.target.closest('.sidebar a')) {
      sidebar.classList.remove('open');
      backdrop.classList.remove('show');
    }
  });
} function initMenuToggle() {
  const btn = $('#menu-toggle');
  const sidebar = $('.sidebar');
  const backdrop = $('#menu-backdrop');
  const app = $('#app');
  if (!btn || !sidebar || !backdrop || !app) return;

  // Are we in the mobile drawer layout? (Must match the CSS breakpoint.)
  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

  // Restore persisted desktop collapse preference on boot.
  if (!isMobile() && localStorage.getItem('sidebarCollapsed') === '1') {
    app.classList.add('sidebar-collapsed');
  }

  btn.onclick = () => {
    if (isMobile()) {
      // Mobile: slide-in drawer, unchanged from before.
      sidebar.classList.toggle('open');
      backdrop.classList.toggle('show');
    } else {
      // Desktop: collapse / expand the grid column, persist the choice.
      const collapsed = app.classList.toggle('sidebar-collapsed');
      localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
    }
  };

  backdrop.onclick = () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
  };

  // Close the mobile drawer when a nav link is tapped.
  // (No-op on desktop, where the sidebar isn't a drawer.)
  document.addEventListener('click', (e) => {
    if (!isMobile()) return;
    if (e.target.closest('#nav a') || e.target.closest('.sidebar a')) {
      sidebar.classList.remove('open');
      backdrop.classList.remove('show');
    }
  });
}

// ============================================================
// Boot
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
    bindGlobalSearch();
    initMenuToggle();
    await render();
  } catch (err) { setStatus('Failed'); toast(err.message); }
}

window.addEventListener('hashchange', async () => {
  const route = decodeURIComponent(location.hash.replace('#/', ''));
  await routeTo(route);
});

const refreshBtn = $('#refresh-btn');
if (refreshBtn) refreshBtn.onclick = () => {
  state.data = {};
  state.dataTime = {};
  render();
};

boot();