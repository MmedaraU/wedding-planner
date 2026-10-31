// ============================================================
// WEDDING PLANNER — COMPANION APP
// ============================================================

const CONFIG = window.WEDDING_CONFIG;

// Vendor sources are derived from _app_config at runtime.
// Any row with a value in the `vendorKind` column is treated as a vendor source.
function getVendorSources() {
  return (state.schema || [])
    .filter(s => s.vendorKind)
    .map(s => ({ sheet: s.sheet, kind: s.vendorKind }));
}

const VIRTUAL_NAV = [
  { route: '_today', label: 'Today', order: 0 },
  { route: '_overview', label: 'Overview', order: 5 },
  { route: '_team', label: 'Team', order: 15 },
  { route: '_vendors', label: 'Vendors', order: 55 },
  { route: '_gifts', label: 'Gifts & Cash', order: 65 },
  { route: '_logistics', label: 'Logistics', order: 75 }
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
  'Guest List': "Who's coming, who's pending, who still needs an invite",
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
const GUEST_CACHE_TTL_MS = 60 * 1000;  // 60s — Guest List changes externally

async function apiGetRows(sheetName, force) {
  const now = Date.now();
  state.dataTime = state.dataTime || {};
  const cached = state.data[sheetName];
  const cachedAt = state.dataTime[sheetName] || 0;
  const ttl = sheetName === 'Guest List' ? GUEST_CACHE_TTL_MS : CACHE_TTL_MS;

  if (!force && cached && (now - cachedAt) < ttl) {
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
  // Match YYYY-MM-DD optionally followed by HH:MM(:SS)?
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const day = Number(m[3]);
    const h = m[4] ? Number(m[4]) : 0;
    const mi = m[5] ? Number(m[5]) : 0;
    const sec = m[6] ? Number(m[6]) : 0;
    return new Date(y, mo, day, h, mi, sec);
  }
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

function toISODateTime(val) {
  const d = parseSheetDate(val);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
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
  // Skip if the "ID" column is actually the checkbox column
  if (idField && idField !== schema.checkField) {
    const val = row[idField];
    // getDisplayValues() returns booleans as strings "TRUE"/"FALSE",
    // so we must catch both real booleans and their string forms.
    const s = String(val ?? '').trim().toLowerCase();
    if (s && s !== 'true' && s !== 'false') {
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
function fmtTime(val) {
  if (!val) return '';
  const s = String(val);

  // Matches "HH:mm" anywhere in the string (e.g., "2028-12-14 14:30:00" or "12/14/2028 08:00")
  const match = s.match(/\b(\d{1,2}):(\d{2})/);
  if (match) {
    let hours = Number(match[1]);
    const minutes = match[2];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
  }

  return '';
}
// ============================================================
// Field role detection (resilient)
// ============================================================

const CHECK_RE = /\b(returned|packed|done|thanked|arrived|signed|completed|bought|booked|received|sent|paid|decided)\b/i;
const NAME_RE = /\b(name|names|item|task|thing|vendor|description|title|guest|company|chore|question|activity)\b/i;
const STATUS_RE = /\b(status|stage|response|state|category)\b/i;
const DATE_RE = /\b(date|due|when|deadline|time)\b/i;

// Additional patterns that flag a row as a section header, even when not ALL CAPS.
// Matches things like "Part 1: ...", "Section 2", "Chapter III", "A. Something".
const SECTION_PATTERNS = [
  /^part\s+[\dIVX]+/i,
  /^section\s+[\dIVX]+/i,
  /^chapter\s+[\dIVX]+/i,
  /^[A-Z]\.\s+\S/,          // "A. Something"
  /^\d+\.\s+[A-Z]/          // "1. Something"
];

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
  const n = String(name);
  if (/date|due|when|deadline/i.test(n)) return 'date';
  if (/time/i.test(n)) return 'datetime-local'; // 👈 Added this line
  if (/notes?|comment|detail|description/i.test(n)) return 'textarea';
  if (/phone|tel|mobile/i.test(n)) return 'text';
  if (/price|cost|amount|budgeted|actual|deposit|qty|quantity/i.test(n)) return 'number';
  if (/response|status|category|stage|tier/i.test(n)) return 'select';
  return 'text';
}

// Look up dropdown options for a column from the schema's validations.
// Returns an array (possibly empty) of option strings.
function optionsForColumn(schema, columnName) {
  if (!schema || !schema.validations || !columnName) return [];
  // Exact match first
  if (schema.validations[columnName]) return schema.validations[columnName];
  // Case-insensitive fallback (sheet headers are exact, but be safe)
  const lower = String(columnName).toLowerCase();
  const hit = Object.keys(schema.validations)
    .find(k => k.toLowerCase() === lower);
  return hit ? schema.validations[hit] : [];
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

    // Skip subtotal/total rows outright
    if (/^(sub-?total|total|grand total)\b/i.test(name)) return;
    if (SKIP_AS_HEADER.test(name)) return;

    const noCheckbox = !isChecked(r[roles.checkField]);

    const hasLetters = /[A-Za-z]/.test(name);
    const isAllCaps = hasLetters && name === name.toUpperCase();
    const matchesPattern = SECTION_PATTERNS.some(re => re.test(name));

    // A row is a section header when:
    //   - it has no checkbox, AND
    //   - it either reads as ALL CAPS or matches one of the section patterns, AND
    //   - it has no value in any of the money columns (so priced items
    //     that happen to be ALL CAPS don't get promoted by mistake)
    const hasBudgetData = pick(r, 'budgeted', 'Budgeted', 'Budgeted Cost') !== '';
    const hasActualData = pick(r, 'actual', 'Actual', 'Actual Cost') !== '';
    const hasDepositData = pick(r, 'deposit', 'Deposit', 'Paid', 'Deposit Made') !== '';
    const isUnpriced = !hasBudgetData && !hasActualData && !hasDepositData;

    if (noCheckbox && (isAllCaps || matchesPattern) && isUnpriced) {
      currentSection = name;
      return;
    }

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
    input = `<input id="${id}" name="${name}" type="date" value="${escapeHtml(toISODate(value))}">`;
  } else if (type === 'datetime-local') {
    input = `<input id="${id}" name="${name}" type="datetime-local" value="${escapeHtml(toISODateTime(value))}">`;
  } else if (type === 'number') {
    // 👇 NEW FIX: Strip commas and symbols so type="number" works
    let numVal = value;
    if (typeof value === 'string') {
      numVal = value.replace(/[^0-9.-]+/g, '');
    }
    input = `<input id="${id}" name="${name}" type="number" value="${escapeHtml(numVal ?? '')}">`;
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
  const checkField = schema.checkField || detectFieldRoles(schema).checkField;
  const baseFields = (schema.fields && schema.fields.length)
    ? schema.fields
    : cols.map(c => ({ name: c, label: c, type: guessType(c) }));

  // Force checkbox type for the check field; attach dropdown options.
  const fields = baseFields.map(f => {
    if (checkField && f.name === checkField) {
      return { ...f, type: 'checkbox' };
    }
    const opts = optionsForColumn(schema, f.name);
    return opts.length ? { ...f, options: opts } : f;
  });

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
  // Reset any view-level click handler a previous view may have bound.
  // Views that need one bind it themselves during renderView(); views
  // that use their own container (like Guests via #g-list) leave this
  // null, so their handlers aren't duplicated by a leftover.
  const view = $('#view');
  if (view) view.onclick = null;

  await renderView();
  injectSubtitle();
}

// ============================================================
// VIEW: Day-Of Schedule (Custom Grouping)
// ============================================================
async function renderDayOfSchedule(schema) {
  setStatus('Loading schedule…');
  try {
    // 1. Fetch the schedule rows
    const res = await apiGetRows(schema.sheet);
    if (res.error) throw new Error(res.error);
    const rows = res.rows || [];
    state.data[schema.sheet] = rows;

    // 2. Fetch the meta dates (TM, Wedding, etc.)
    const ov = await apiGetOverview();
    const meta = ov.meta || {};

    if (rows.length > 0 && !schema.columns) schema.columns = Object.keys(rows[0]).filter(k => k !== '_row');
    const cols = schema.columns || [];
    const roles = detectFieldRoles(schema);

    const doneCol = roles.checkField || 'Done';
    const nameCol = roles.nameField || 'Activity';
    const timeCol = roles.dateField || 'Time';

    // Helper to get the event label based on the date
    const getEventLabel = (dateObj) => {
      if (!dateObj) return '';
      const dStr = dateObj.toDateString();

      if (meta.tm_date && parseSheetDate(meta.tm_date)?.toDateString() === dStr) return 'Traditional Marriage';
      if (meta.wedding_date && parseSheetDate(meta.wedding_date)?.toDateString() === dStr) return 'Wedding & Reception';
      if (meta.friends_night_date && parseSheetDate(meta.friends_night_date)?.toDateString() === dStr) return 'Friends Night';

      return '';
    };

    // 3. Group by Date
    const grouped = {};
    rows.forEach(r => {
      const rawTime = r[timeCol];
      const dateObj = parseSheetDate(rawTime);

      const dateKey = dateObj
        ? dateObj.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : 'Unscheduled';

      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(r);
    });

    // 4. Sort the dates
    const sortedDates = Object.keys(grouped).sort((a, b) => {
      if (a === 'Unscheduled') return 1;
      if (b === 'Unscheduled') return -1;
      return parseSheetDate(grouped[a][0][timeCol]) - parseSheetDate(grouped[b][0][timeCol]);
    });

    // 5. Sort tasks within each date
    sortedDates.forEach(date => {
      grouped[date].sort((a, b) => {
        const timeA = parseSheetDate(a[timeCol])?.getTime() || 0;
        const timeB = parseSheetDate(b[timeCol])?.getTime() || 0;
        return timeA - timeB;
      });
    });

    const total = rows.length;
    const doneCount = roles.checkField ? rows.filter(r => isChecked(r[doneCol])).length : 0;
    const pct = total ? (doneCount / total) * 100 : 0;

    $('#view').innerHTML = `
      <div class="toolbar">
        <h1>${escapeHtml(schema.label)}</h1>
        <button class="btn btn-primary" id="dos-add">+ Add Item</button>
      </div>
      
      ${renderProgress(pct, 'Day-Of Progress')}
      <div id="dos-add-strip"></div>

      ${sortedDates.length === 0 ? `<div class="ql-empty">Nothing scheduled yet</div>` :
        sortedDates.map(date => {
          const dateObj = parseSheetDate(grouped[date][0][timeCol]);
          const eventLabel = getEventLabel(dateObj);

          // Combine label and date (e.g., "Traditional Marriage — Thursday, December 14")
          const headerText = eventLabel ? `${eventLabel} — ${date}` : date;

          return `
          <div class="tl-bucket">
            <div class="tl-bucket-header" style="margin-top: 24px;">
              <span class="tl-bucket-name" style="color: var(--grad-to); font-size: 16px;">${escapeHtml(headerText)}</span>
              <span class="tl-bucket-count">${grouped[date].length} items</span>
            </div>
            <div class="ql-list">
              ${grouped[date].map(r => {
            const id = rowId(r, schema);
            const isDone = isChecked(r[doneCol]);
            // Format time (e.g., "8:00 AM")
            const timeStr = fmtTime(r[timeCol]);

            return `<div class="ql-row ${isDone ? 'done' : ''}" data-id="${escapeHtml(String(id))}" data-row="${r._row}">
                  <div class="ql-row-main">
                    <button type="button" class="ql-check ${isDone ? 'on' : ''}" data-action="toggle">${isDone ? '✓' : ''}</button>
                    <div class="ql-row-info" data-action="expand">
                      <div class="ql-row-name">${escapeHtml(r[nameCol] || '—')}</div>
                    </div>
                    ${timeStr ? `<span class="pill" style="background: var(--surface-alt); border-color: var(--border); font-weight: 600; color: var(--text);">${escapeHtml(timeStr)}</span>` : ''}
                    <button type="button" class="ql-more" data-action="expand">⋯</button>
                  </div>
                  ${state.expanded === schema.sheet + ':' + id ? renderInlineEditor(r, schema) : ''}
                </div>`;
          }).join('')}
            </div>
          </div>`;
        }).join('')}
    `;

    bindRowInteractions(schema);
    $('#dos-add').onclick = () => showQuickAdd(schema, roles, $('#dos-add-strip'));

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed'); toast(err.message);
  }
}

async function renderView() {
  if (state.route === '_overview') return renderOverview();
  if (state.route === '_today') return renderToday();
  if (state.route === '_vendors') return renderVendors();
  if (state.route === '_search') return renderSearch();
  if (state.route === '_team') return renderTeamPage();
  if (state.route === '_gifts') return renderGiftsCash();
  if (state.route === '_logistics') return renderLogistics();

  const schema = currentSchema();
  if (!schema) { $('#view').innerHTML = '<h1>Not found</h1>'; return; }
  if (schema.type === 'link') return renderLinkView(schema);

  const map = {
    renderTimeline: renderTimeline,
    renderQuickList: renderQuickList,
    renderBudget: renderBudget,
    renderGuests: renderGuests,
    renderGifts: renderGifts,
    renderDayOfSchedule: renderDayOfSchedule // 👈 Add this line
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

    // Savings Stats
    const goal = stats.savings_goal || 30000000;
    const saved = stats.total_saved || 0;
    const remaining = Math.max(0, goal - saved);
    const pct = goal ? (saved / goal) * 100 : 0;
    const monthsLeft = stats.savings_months_left || 1;
    const monthlyTarget = Math.ceil(remaining / monthsLeft);

    $('#view').innerHTML = `
      <h1>Overview</h1>
      
      <!-- HERO -->
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

      <!-- KEY DATES -->
      ${datesGroup.length ? `
        <details class="meta-accordion" open>
          <summary>Key Dates</summary>
          <table class="info-table meta-table"><tbody>
            ${datesGroup.map(d => renderMetaRow('Dates', d)).join('')}
          </tbody></table>
        </details>
      ` : ''}

      <!-- DASHBOARD GRID -->
      <div class="overview-grid">
        
        <!-- Progress Column -->
        <div>
          <h2>Progress</h2>
          ${renderStats([
      { label: 'Guests confirmed', value: `${stats.guests_coming || 0} / ${stats.guests_total || 0}` },
      { label: 'Plan tasks done', value: `${stats.planning_done || 0} / ${stats.planning_total || 0}` },
      { label: 'Bridal tasks done', value: `${stats.bridal_done || 0} / ${stats.bridal_total || 0}` }
    ])}
          <div style="margin-top: 24px;">
            ${renderProgress(planPct, 'Planning schedule')}
            ${renderProgress(bridalPct, 'Bridal list')}
            ${renderProgress(guestPct, 'Guest confirmations')}
          </div>
        </div>

        <!-- Finance Column -->
        <div>
          <h2>Finances</h2>
          <div class="stats" style="grid-template-columns: 1fr 1fr;">
            
            <!-- Editable Savings Card -->
            <div class="stat editable-stat" data-key="savings" data-label="Total Saved" title="Click to edit base savings">
              <div class="stat-label">Total Saved</div>
              <div class="stat-value">${money(saved)}</div>
            </div>

            <!-- Editable Goal Card -->
            <div class="stat editable-stat" data-key="savings_goal" data-label="Target Goal" title="Click to edit goal">
              <div class="stat-label">Target Goal</div>
              <div class="stat-value">${money(goal)}</div>
            </div>

            <div class="stat">
              <div class="stat-label">Remaining</div>
              <div class="stat-value">${money(remaining)}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Target / Month</div>
              <div class="stat-value">${money(monthlyTarget)}</div>
              <div class="stat-hint">${monthsLeft} months left</div>
            </div>

          </div>
          
          <div style="margin-top: 24px;">
            ${renderProgress(pct, 'Savings Progress')}
            ${renderProgress(budgetUsedPct, 'Budget Used (Actual vs Budgeted)')}
          </div>
        </div>
      </div>

      <h2>Wedding Details</h2>
      <div class="meta-grid">
        ${Object.entries(metaGrouped)
        .filter(([g]) => !['Dates', 'Couple', 'Team', 'Budget'].includes(g))
        .map(([g, items]) => {
          const hiddenKeys = ['contact_email', 'savings', 'cash_at_hand'];
          const visibleItems = items.filter(it => !hiddenKeys.includes(it.key));
          if (visibleItems.length === 0) return '';

          return `
              <details class="meta-accordion">
                <summary>${escapeHtml(g)}</summary>
                <table class="info-table meta-table"><tbody>
                  ${visibleItems.map(it => renderMetaRow(g, it)).join('')}
                </tbody></table>
              </details>`;
        }).join('')}
      </div>
    `;
    bindOverviewMeta(meta);
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

function bindOverviewMeta(meta) {
  const view = $('#view'); if (!view) return;

  view.onclick = async (e) => {
    // 1. Intercept clicks on editable stat cards
    const editableStat = e.target.closest('.editable-stat');
    if (editableStat && !editableStat.classList.contains('editing')) {
      const key = editableStat.dataset.key;
      const label = editableStat.dataset.label;
      const currentValue = key === 'savings' ? (meta.savings || '') : (meta.savings_goal || '');

      editableStat.classList.add('editing');
      editableStat.innerHTML = `
        <div class="stat-label">${label}</div>
        <input type="number" class="stat-input" value="${currentValue}" style="width: 100%; padding: 6px; font-size: 16px; border: 1px solid var(--accent); border-radius: 4px; margin: 4px 0; font-family: inherit;">
        <div style="display: flex; gap: 4px; justify-content: flex-end;">
          <button type="button" class="btn btn-ghost" data-action="cancel-stat" style="padding: 2px 6px; font-size: 11px;">Cancel</button>
          <button type="button" class="btn btn-primary" data-action="save-stat" style="padding: 2px 6px; font-size: 11px;">Save</button>
        </div>
      `;
      const input = editableStat.querySelector('input');
      input.focus();
      input.select();
      return;
    }

    // 2. Handle Save/Cancel for the stat cards
    const saveStatBtn = e.target.closest('[data-action="save-stat"]');
    if (saveStatBtn) {
      const stat = saveStatBtn.closest('.editable-stat');
      const key = stat.dataset.key;
      const input = stat.querySelector('input');
      const newValue = input.value;

      const res = await apiWrite('update', '_app_meta', { value: newValue }, key);
      if (res.error) return toast('Save failed: ' + res.error);
      toast('Saved');
      return renderOverview();
    }

    const cancelStatBtn = e.target.closest('[data-action="cancel-stat"]');
    if (cancelStatBtn) {
      return renderOverview(); // Re-render resets the card state
    }

    // 3. Existing Meta Row logic for the tables
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
    const res = await apiWrite(action, 'Team', data, null, team?._row);
    if (res.error) return toast('Save failed: ' + res.error);
    modal.remove();
    toast(isEdit ? 'Saved' : 'Added');
    renderTeamPage();
  };

  modal.querySelector('[data-action="cancel"]').onclick = () => modal.remove();
  if (isEdit) {
    modal.querySelector('[data-action="delete"]').onclick = async () => {
      if (!confirm('Delete this team member?')) return;
      const res = await apiWrite('deleteTeam', 'Team', null, null, team._row);
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

  // Look up the row as it was rendered, from the cache the view loaded.
  const original = (state.data[schema.sheet] || [])
    .find(r => String(rowId(r, schema)) === String(id));

  // Normalise for comparison so we don't flag false positives:
  //   - null / undefined / '' all collapse to ''
  //   - "2027-12-12T00:00:00.000Z" and "2027-12-12" compare equal
  //   - numbers compare as their string forms
  const norm = v => {
    if (v == null) return '';
    const s = String(v).trim();
    if (!s) return '';
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    return s;
  };

  // Build a payload containing only fields whose value actually differs
  // from the row's original value. Untouched fields — including
  // formula-driven date cells — are omitted entirely.
  const changed = {};
  Object.entries(data).forEach(([k, v]) => {
    const orig = original ? original[k] : undefined;
    if (norm(v) !== norm(orig)) changed[k] = v;
  });

  if (Object.keys(changed).length === 0) {
    state.expanded = null;
    toast('No changes');
    return render();
  }

  const res = await apiWrite('update', schema.sheet, changed, id, rowEl.dataset.row);
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
      const base = { name: realName, label: realName, type: guessType(realName) };
      const opts = optionsForColumn(schema, realName);
      return opts.length ? { ...base, options: opts } : base;
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
    // Ensure the overview payload is available so we can read
    // stats.budget_available for the Available card below. Cached for
    // 5 minutes, so this is a no-op on repeat visits.
    if (!state.data.__overview) await apiGetOverview();

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

    const num = v => {
      if (!v) return 0;
      if (typeof v === 'number') return v;
      const cleaned = String(v).replace(/[^0-9.-]+/g, '');
      return Number(cleaned) || 0;
    };
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
  ${schema.sheet === 'budget_flat' ? `
    <div class="view-warning">
      ⚠️ If you insert or delete rows in the Budget sheet, go to Workbook Tools ➡️ Refresh budget_flat from Budget
    </div>` : ''}
  ${(() => {
        const ov = state.data.__overview || {};
        const available = (ov.stats && typeof ov.stats.budget_available === 'number')
          ? ov.stats.budget_available
          : null;
        const hint = available == null
          ? 'Budget!B19 minus deposits'
          : (available < 0 ? 'over budget' : 'cash on hand');
        return renderStats([
          { label: 'Budgeted', value: money(totalBudgeted) },
          { label: 'Actual cost', value: money(totalActual) },
          { label: 'Paid', value: money(totalPaid) },
          { label: 'Outstanding', value: money(outstanding) },
          { label: 'Available', value: available == null ? '—' : money(available), hint }
        ]);
      })()}
      ${renderProgress(totalActual ? (totalPaid / totalActual) * 100 : 0, 'Paid so far')}
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

      const availableSections = Object.keys(bySection).filter(s => s !== 'Other');

      let sectionField = null;
      if (sectionColName) {
        sectionField = { name: sectionColName, label: 'Section', options: availableSections };
      } else if (availableSections.length > 0) {
        sectionField = { name: '_section', label: 'Section', options: availableSections };
      }

      const fields = [
        itemColName && { name: itemColName, label: 'Item' },
        sectionField,
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
  const num = v => {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    const cleaned = String(v).replace(/[^0-9.-]+/g, '');
    return Number(cleaned) || 0;
  };
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
    const countCol = cols.find(c => /number|count|expect/i.test(c)) || '';

    const total = rows.reduce((s, r) => s + (Number(r[countCol]) || 0), 0);
    const coming = rows.filter(r => r[respCol] === 'Coming').reduce((s, r) => s + (Number(r[countCol]) || 0), 0);
    const pending = rows.filter(r => !r[respCol] || r[respCol] === 'Pending').reduce((s, r) => s + (Number(r[countCol]) || 0), 0);
    const unreviewedCount = catCol
      ? rows.filter(r => String(r[catCol] || '') === 'RSVP (auto-added)').length
      : 0;

    const bucketOf = r => {
      const raw = catCol ? String(r[catCol] || '') : '';
      if (/bride/i.test(raw)) return 'Bride';
      if (/groom/i.test(raw)) return 'Groom';
      return 'Other';
    };
    const allBuckets = ['Bride', 'Groom', 'Other'];
    const presentBuckets = catCol
      ? allBuckets.filter(b => rows.some(r => bucketOf(r) === b))
      : [];

    const activeCat = state.filter[schema.sheet] || 'All';
    const respFilters = ['All', 'Coming', 'Pending', 'Not Coming'];
    const activeResp = state.filter[schema.sheet + '_resp'] || 'All';
    const q = (state.search[schema.sheet] || '').toLowerCase();

    let filtered = rows;
    if (activeCat !== 'All' && catCol) filtered = filtered.filter(r => bucketOf(r) === activeCat);
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
      { label: 'Pending', value: pending }
    ])}
      ${renderProgress(total ? (coming / total) * 100 : 0, 'Confirmed')}
      ${unreviewedCount > 0 ? `
        <div style="background: #FFF8E1; border-left: 3px solid var(--accent);
                    padding: 12px 16px; border-radius: var(--radius-sm);
                    margin-bottom: 16px; font-size: 13px;">
          <strong>${unreviewedCount}</strong> new RSVP${unreviewedCount !== 1 ? 's' : ''} awaiting review.
          <button class="btn btn-primary" id="show-unreviewed" style="margin-left: 12px; padding: 4px 10px; font-size: 11px;">
            Show them
          </button>
        </div>
      ` : ''}
      <div class="ql-controls">
        <input type="search" id="g-search" placeholder="Search guests…" value="${escapeHtml(state.search[schema.sheet] || '')}">
        <div class="chips">
          ${respFilters.map(f =>
      `<button class="chip chip-resp ${activeResp === f ? 'on' : ''}" data-resp-filter="${escapeHtml(f)}">${escapeHtml(f)}</button>`
    ).join('')}
        </div>
      </div>
      ${presentBuckets.length ? `<div class="chips">
        <button class="chip ${activeCat === 'All' ? 'on' : ''}" data-cat="All">All</button>
        ${presentBuckets.map(b => `<button class="chip ${activeCat === b ? 'on' : ''}" data-cat="${escapeHtml(b)}">${escapeHtml(b)}</button>`).join('')}
      </div>` : ''}
      <div id="g-add-strip"></div>
      <div class="ql-list" id="g-list">
        ${filtered.length === 0
        ? `<div class="ql-empty">${q || activeCat !== 'All' ? 'No matches' : 'No guests yet'}</div>`
        : filtered.map(r => renderGuestRow(r, schema, { nameCol, catCol, respCol })).join('')}
      </div>`;

    const search = $('#g-search');
    if (search) search.oninput = debounce(() => { state.search[schema.sheet] = search.value; renderGuests(schema); }, 200);

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

    const showUnreviewedBtn = $('#show-unreviewed');
    if (showUnreviewedBtn) {
      showUnreviewedBtn.onclick = () => {
        state.search[schema.sheet] = 'rsvp (auto-added)';
        renderGuests(schema);
      };
    }

    $('#g-list').onclick = async (e) => {
      const rowEl = e.target.closest('.ql-row'); if (!rowEl) return;
      const id = rowEl.dataset.id;

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
function renderGuestRow(row, schema, { nameCol, catCol, respCol }) {
  const id = rowId(row, schema);
  const key = schema.sheet + ':' + id;
  const expanded = state.expanded === key;
  const name = row[nameCol] || '—';
  const response = respCol ? row[respCol] : '';
  const category = catCol ? row[catCol] : '';
  const responseClass = response === 'Coming' ? 'pill-green' : response === 'Not Coming' ? 'pill-red' : '';
  const showCategory = catCol && (state.filter[schema.sheet] || 'All') === 'All';
  const unreviewed = category === 'RSVP (auto-added)';
  return `<div class="ql-row guest-row
    ${response === 'Coming' ? 'guest-coming' : ''}
    ${response === 'Not Coming' ? 'guest-not-coming' : ''}
    ${unreviewed ? 'unreviewed' : ''}
    ${expanded ? 'expanded' : ''}"
    data-id="${escapeHtml(String(id))}" data-row="${row._row}">
    <div class="ql-row-main">
      <div class="ql-row-info" data-action="expand">
        <div class="ql-row-name">${escapeHtml(name)}</div>
        <div class="ql-row-meta">
          ${showCategory && category ? `<span class="pill">${escapeHtml(category)}</span>` : ''}
          ${response ? `<span class="pill ${responseClass}">${escapeHtml(response)}</span>` : ''}
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
// VIEW: Gifts & Cash (merged)
// ============================================================

async function renderGiftsCash() {
  setStatus('Loading gifts & cash…');
  try {
    const [gRes, cRes] = await Promise.all([
      apiGetRows('Gifts Received'),
      apiGetRows('Cash Contributions')
    ]);

    // 1. Filter out ghost rows (blank names) and tag them
    const gifts = (gRes.rows || [])
      .filter(r => String(r['Name of Person'] || '').trim() !== '')
      .map(r => ({ ...r, _kind: 'gift' }));

    const cash = (cRes.rows || [])
      .filter(r => String(r['Name of Person'] || '').trim() !== '')
      .map(r => ({ ...r, _kind: 'cash' }));

    const giftSchema = state.schema.find(s => s.sheet === 'Gifts Received');
    const cashSchema = state.schema.find(s => s.sheet === 'Cash Contributions');

    // 2. Teach the app the columns so the inline editor works
    if (giftSchema && !giftSchema.columns && gifts.length > 0) {
      giftSchema.columns = Object.keys(gifts[0]).filter(k => k !== '_row' && k !== '_kind');
    }
    if (cashSchema && !cashSchema.columns && cash.length > 0) {
      cashSchema.columns = Object.keys(cash[0]).filter(k => k !== '_row' && k !== '_kind');
    }

    const activeKind = state.filter._gifts_cash || 'All';
    const activeThanks = state.filter._gifts_thanks || 'All';
    const q = (state.search._gifts_cash || '').toLowerCase();

    let rows = [...gifts, ...cash];
    if (activeKind === 'Gifts') rows = gifts;
    if (activeKind === 'Cash') rows = cash;
    if (activeThanks === 'Pending') rows = rows.filter(r => !isChecked(r['Said Thank You']));
    if (activeThanks === 'Thanked') rows = rows.filter(r => isChecked(r['Said Thank You']));

    if (q) {
      rows = rows.filter(r =>
        Object.values(r).some(v => String(v).toLowerCase().includes(q))
      );
    }

    // 3. Robust sum parser for Naira
    const num = v => {
      if (v == null || v === '') return 0;
      if (typeof v === 'number') return v;
      const cleaned = String(v).replace(/[^0-9.-]+/g, '');
      return Number(cleaned) || 0;
    };

    const cashSum = cash.reduce((s, r) => s + num(r['Amount']), 0);
    const allRows = [...gifts, ...cash];
    const pending = allRows.filter(r => !isChecked(r['Said Thank You']));
    const thanked = allRows.filter(r => isChecked(r['Said Thank You']));

    // Split for grouped rendering
    const pendingRows = rows.filter(r => !isChecked(r['Said Thank You']));
    const thankedRows = rows.filter(r => isChecked(r['Said Thank You']));

    $('#view').innerHTML = `
      <div class="toolbar">
        <h1>Gifts &amp; Cash</h1>
        <button class="btn btn-primary" id="gc-add">+ Add</button>
      </div>
      
      ${cashSum > 0 ? `
        <div style="background:var(--success-soft); border-left:3px solid var(--success);
                    padding:12px 16px; border-radius:var(--radius);
                    margin-bottom:16px; font-size:14px;">
          <strong>Total cash received:</strong>
          <span style="font-size:20px; font-weight:700; color:var(--success-text);">
            ${money(cashSum)}
          </span>
          <span class="muted" style="margin-left:8px;">
            across ${cash.length} contribution${cash.length === 1 ? '' : 's'}
          </span>
        </div>
      ` : ''}
      
      ${renderStats([
      { label: 'Gifts', value: gifts.length },
      { label: 'Cash gifts', value: cash.length },
      { label: 'To thank', value: pending.length, hint: pending.length ? 'needs action' : 'all caught up' },
      { label: 'Thanked', value: `${thanked.length} / ${allRows.length}` }
    ])}
      
      ${allRows.length ? renderProgress((thanked.length / allRows.length) * 100, 'Acknowledged') : ''}
      
      <div class="ql-controls">
        <input type="search" id="gc-search" placeholder="Search names, gifts, amounts…" value="${escapeHtml(state.search._gifts_cash || '')}">
      </div>
      
      <div class="chips">
        ${['All', 'Gifts', 'Cash'].map(k =>
      `<button class="chip ${activeKind === k ? 'on' : ''}" data-kind="${k}">${k}</button>`
    ).join('')}
      </div>
      
      <div class="chips">
        ${[
        { key: 'All', label: `All (${allRows.length})` },
        { key: 'Pending', label: `To thank (${pending.length})` },
        { key: 'Thanked', label: `Thanked (${thanked.length})` }
      ].map(c =>
        `<button class="chip ${activeThanks === c.key ? 'on' : ''}"
                    data-thanks="${c.key}">${escapeHtml(c.label)}</button>`
      ).join('')}
      </div>
      
      <div id="gc-add-strip"></div>
      
      <div class="ql-list" id="gc-list">
        ${rows.length === 0
        ? `<div class="ql-empty">${q ? 'No matches' : 'Nothing yet'}</div>`
        : renderGiftsCashGrouped(pendingRows, thankedRows, giftSchema, cashSchema, activeThanks)
      }
      </div>
    `;

    const search = $('#gc-search');
    if (search) search.oninput = debounce(() => {
      state.search._gifts_cash = search.value;
      renderGiftsCash();
    }, 200);

    $$('.chip[data-kind]').forEach(chip => {
      chip.onclick = () => {
        state.filter._gifts_cash = chip.dataset.kind;
        renderGiftsCash();
      };
    });

    $$('.chip[data-thanks]').forEach(chip => {
      chip.onclick = () => {
        state.filter._gifts_thanks = chip.dataset.thanks;
        renderGiftsCash();
      };
    });

    $('#gc-add').onclick = () => showGiftsCashAdd();

    $('#gc-list').onclick = async (e) => {
      const rowEl = e.target.closest('.ql-row');
      if (!rowEl) return;
      const id = rowEl.dataset.id;
      const kind = rowEl.dataset.kind;
      const schema = kind === 'gift' ? giftSchema : cashSchema;
      if (!schema) return;

      const action = e.target.closest('[data-action]')?.dataset.action;

      if (action === 'toggle') {
        return toggleCheck(schema, detectFieldRoles(schema), id, rowEl);
      }
      if (action === 'expand') return toggleExpand(schema, id);
      if (action === 'cancel') { state.expanded = null; return renderGiftsCash(); }
      if (action === 'save') return saveInline(schema, id, rowEl);
      if (action === 'delete') {
        if (!confirm('Delete this item?')) return;
        const res = await apiWrite('delete', schema.sheet, null, id, rowEl.dataset.row);
        if (res.error) return toast('Delete failed: ' + res.error);
        state.expanded = null;
        toast('Deleted');
        renderGiftsCash();
      }
    };

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed');
    toast(err.message);
  }
}

function renderGiftsCashGrouped(pendingRows, thankedRows, giftSchema, cashSchema, activeThanks) {
  const renderRow = r =>
    renderGiftsCashRow(r, r._kind === 'gift' ? giftSchema : cashSchema);

  const sections = [];

  if (pendingRows.length) {
    sections.push(`
      <div class="section-header">
        <span class="section-header-name">To thank</span>
        <span class="section-header-count">${pendingRows.length}</span>
      </div>
      ${pendingRows.map(renderRow).join('')}
    `);
  }

  if (thankedRows.length && activeThanks !== 'Pending') {
    sections.push(`
      <div class="section-header">
        <span class="section-header-name">Already thanked</span>
        <span class="section-header-count">${thankedRows.length}</span>
      </div>
      ${thankedRows.map(renderRow).join('')}
    `);
  }

  return sections.join('');
}

function renderGiftsCashRow(row, schema) {
  const id = rowId(row, schema);
  const key = schema.sheet + ':' + id;
  const expanded = state.expanded === key;
  const checked = isChecked(row['Said Thank You']);
  const name = row['Name of Person'] || '—';
  const isGift = row._kind === 'gift';
  const amount = isGift ? row['Gift'] : row['Amount'];
  const date = isGift ? row['Date we got gift'] : row['Date'];
  const badge = isGift
    ? '<span class="pill">🎁 Gift</span>'
    : '<span class="pill pill-green">💰 Cash</span>';

  return `<div class="ql-row ${checked ? 'done' : ''} ${expanded ? 'expanded' : ''}"
              data-id="${escapeHtml(String(id))}"
              data-row="${row._row}"
              data-kind="${row._kind}">
    <div class="ql-row-main">
      <button type="button" class="ql-check ${checked ? 'on' : ''}" data-action="toggle">${checked ? '✓' : ''}</button>
      <div class="ql-row-info" data-action="expand">
        <div class="ql-row-name">${escapeHtml(name)}</div>
        <div class="ql-row-meta">
          ${badge}
          ${amount ? `<span class="pill">${escapeHtml(isGift ? String(amount) : money(amount))}</span>` : ''}
          ${date ? `<span class="ql-row-date">${escapeHtml(fmtDateShort(date))}</span>` : ''}
        </div>
      </div>
      <button type="button" class="ql-more" data-action="expand">⋯</button>
    </div>
    ${expanded ? renderInlineEditor(row, schema) : ''}
  </div>`;
}

function showGiftsCashAdd() {
  const strip = $('#gc-add-strip');
  if (!strip) return;
  if (strip.firstChild) { strip.innerHTML = ''; return; }

  strip.innerHTML = `
    <div class="ql-quick-add" id="gc-quick-add">
      <div class="field field-compact">
        <label>Type</label>
        <select id="gc-type">
          <option value="gift">Gift</option>
          <option value="cash">Cash</option>
        </select>
      </div>
      <div class="field field-compact">
        <label>Name</label>
        <input id="gc-name" placeholder="Name of person">
      </div>
      <div class="field field-compact" id="gc-gift-field">
        <label>Gift</label>
        <input id="gc-gift" placeholder="What they gave">
      </div>
      <div class="field field-compact" id="gc-cash-field" style="display:none">
        <label>Amount (₦)</label>
        <input id="gc-amount" type="number" placeholder="0">
      </div>
      <div class="ql-quick-actions">
        <button type="button" class="btn" data-action="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="create">Add</button>
      </div>
    </div>
  `;

  const form = $('#gc-quick-add');
  const typeSel = $('#gc-type');
  const giftField = $('#gc-gift-field');
  const cashField = $('#gc-cash-field');

  typeSel.onchange = () => {
    giftField.style.display = typeSel.value === 'gift' ? '' : 'none';
    cashField.style.display = typeSel.value === 'cash' ? '' : 'none';
  };

  form.onclick = async (e) => {
    const action = e.target.dataset.action;
    if (action === 'cancel') { strip.innerHTML = ''; return; }
    if (action !== 'create') return;

    const name = $('#gc-name').value.trim();
    if (!name) return toast('Please enter a name');

    const type = typeSel.value;
    const sheetName = type === 'gift' ? 'Gifts Received' : 'Cash Contributions';
    const data = type === 'gift'
      ? { 'Name of Person': name, 'Gift': $('#gc-gift').value.trim() }
      : { 'Name of Person': name, 'Amount': $('#gc-amount').value };

    const res = await apiWrite('create', sheetName, data);
    if (res.error) return toast('Add failed: ' + res.error);
    toast('Added');
    strip.innerHTML = '';
    renderGiftsCash();
  };
}

// ============================================================
// VIEW: Logistics (Venue + New Home + Rentals merged)
// ============================================================

async function renderLogistics() {
  setStatus('Loading logistics…');
  try {
    const [vRes, nRes, rRes] = await Promise.all([
      apiGetRows('Things to get to and from venue'),
      apiGetRows('Things to take back to new home'),
      apiGetRows('Rentals Tracker')
    ]);

    // 1. Filter out blank/ghost rows and tag them with their destination
    const venue = (vRes.rows || [])
      .filter(r => String(r['Item'] || '').trim() !== '')
      .map(r => ({ ...r, _destination: 'venue' }));

    const home = (nRes.rows || [])
      .filter(r => String(r['Item'] || '').trim() !== '')
      .map(r => ({ ...r, _destination: 'home' }));

    const rentals = (rRes.rows || [])
      .filter(r => String(r['Item'] || '').trim() !== '')
      .map(r => ({ ...r, _destination: 'rental' }));

    const vSchema = state.schema.find(s => s.sheet === 'Things to get to and from venue');
    const hSchema = state.schema.find(s => s.sheet === 'Things to take back to new home');
    const rSchema = state.schema.find(s => s.sheet === 'Rentals Tracker');

    // 2. Teach the app the columns so the inline editor works
    if (vSchema && !vSchema.columns && venue.length > 0) vSchema.columns = Object.keys(venue[0]).filter(k => k !== '_row' && k !== '_destination');
    if (hSchema && !hSchema.columns && home.length > 0) hSchema.columns = Object.keys(home[0]).filter(k => k !== '_row' && k !== '_destination');
    if (rSchema && !rSchema.columns && rentals.length > 0) rSchema.columns = Object.keys(rentals[0]).filter(k => k !== '_row' && k !== '_destination');

    const activeKind = state.filter._logistics || 'All';
    const q = (state.search._logistics || '').toLowerCase();

    // 3. Filter based on active tab and search query
    let rows = [...venue, ...home, ...rentals];
    if (activeKind === 'Venue') rows = venue;
    if (activeKind === 'New home') rows = home;
    if (activeKind === 'Rentals') rows = rentals;

    if (q) {
      rows = rows.filter(r =>
        Object.values(r).some(v => String(v).toLowerCase().includes(q))
      );
    }

    // 4. Sort: pending items first, then by status order
    const statusOrder = {
      'Not started': 0,
      'Packed for venue': 1,
      'Taken to venue': 2,
      'Packed': 3,
      'Packed for home': 4,
      'At new home': 5,
      'Returned home': 6
    };

    rows.sort((a, b) => {
      if (a._destination === 'rental' && b._destination === 'rental') {
        const aR = isChecked(a['Returned']);
        const bR = isChecked(b['Returned']);
        if (aR !== bR) return aR ? 1 : -1;
        return (a._row || 0) - (b._row || 0);
      }

      const sa = statusOrder[a['Status']] ?? 99;
      const sb = statusOrder[b['Status']] ?? 99;
      if (sa !== sb) return sa - sb;
      return (a._row || 0) - (b._row || 0);
    });

    // 5. Calculate stats for the top cards
    const venueOpen = venue.filter(r => (r['Status'] || 'Not started') !== 'Returned home').length;
    const homeOpen = home.filter(r => (r['Status'] || 'Not started') !== 'At new home').length;
    const rentalsOpen = rentals.filter(r => !isChecked(r['Returned'])).length;

    $('#view').innerHTML = `
      <div class="toolbar">
        <h1>Logistics</h1>
        <button class="btn btn-primary" id="lg-add">+ Add item</button>
      </div>
      
      ${renderStats([
      { label: 'Venue — open', value: venueOpen, hint: `${venue.length} total` },
      { label: 'New home — open', value: homeOpen, hint: `${home.length} total` },
      { label: 'Rentals — due back', value: rentalsOpen, hint: `${rentals.length} total` }
    ])}
      
      <div class="ql-controls">
        <input type="search" id="lg-search" placeholder="Search items…" value="${escapeHtml(state.search._logistics || '')}">
      </div>
      
      <div class="chips">
        ${['All', 'Venue', 'New home', 'Rentals'].map(k =>
      `<button class="chip ${activeKind === k ? 'on' : ''}" data-kind="${k}">${k}</button>`
    ).join('')}
      </div>
      
      <div id="lg-add-strip"></div>
      
      <div class="ql-list" id="lg-list">
        ${rows.length === 0
        ? `<div class="ql-empty">${q ? 'No matches' : 'Nothing here yet'}</div>`
        : rows.map(r => {
          let schema = vSchema;
          if (r._destination === 'home') schema = hSchema;
          if (r._destination === 'rental') schema = rSchema;
          return renderLogisticsRow(r, schema, r._destination);
        }).join('')
      }
      </div>
    `;

    // Bind Search
    const search = $('#lg-search');
    if (search) search.oninput = debounce(() => {
      state.search._logistics = search.value;
      renderLogistics();
    }, 200);

    // Bind Filter Chips
    $$('.chip[data-kind]').forEach(chip => {
      chip.onclick = () => {
        state.filter._logistics = chip.dataset.kind;
        renderLogistics();
      };
    });

    // Bind Add Button
    $('#lg-add').onclick = () => showLogisticsAdd(vSchema, hSchema, rSchema);

    // Bind Row Clicks (Expand, Delete, etc.)
    $('#lg-list').onclick = async (e) => {
      // If they clicked the dropdown, don't expand the row
      if (e.target.closest('.logistics-status-select')) return;

      const rowEl = e.target.closest('.ql-row');
      if (!rowEl) return;
      const id = rowEl.dataset.id;
      const sheetName = rowEl.dataset.sheet;

      let schema = vSchema;
      if (sheetName === 'Things to take back to new home') schema = hSchema;
      if (sheetName === 'Rentals Tracker') schema = rSchema;

      if (!schema) return;
      const action = e.target.closest('[data-action]')?.dataset.action;

      if (action === 'expand') return toggleExpand(schema, id);
      if (action === 'cancel') { state.expanded = null; return renderLogistics(); }
      if (action === 'save') return saveInline(schema, id, rowEl);
      if (action === 'delete') {
        if (!confirm('Delete this item?')) return;
        const res = await apiWrite('delete', schema.sheet, null, id, rowEl.dataset.row);
        if (res.error) return toast('Delete failed: ' + res.error);
        state.expanded = null;
        toast('Deleted');
        renderLogistics();
      }
    };

    // Bind Inline Status Dropdowns (Venue, Home, and Rentals)
    $$('.logistics-status-select').forEach(sel => {
      sel.onchange = async (e) => {
        e.stopPropagation();
        const rowEl = sel.closest('.ql-row');
        const id = rowEl.dataset.id;
        const sheetName = rowEl.dataset.sheet;
        const newValue = sel.value;

        let schema = vSchema;
        let payload = {};

        if (sheetName === 'Rentals Tracker') {
          schema = rSchema;
          // Map the dropdown string back to a boolean for the sheet
          payload = { 'Returned': newValue === 'true' };
        } else {
          if (sheetName === 'Things to take back to new home') schema = hSchema;
          payload = { 'Status': newValue };
        }

        sel.disabled = true;

        const res = await apiWrite('update', schema.sheet, payload, id, rowEl.dataset.row);

        if (res.error) {
          toast('Save failed: ' + res.error);
          sel.value = sel.dataset.prev; // rollback on failure
          sel.disabled = false;
        } else {
          toast('Status updated');
          renderLogistics(); // re-render to re-sort and update counts
        }
      };
    });

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed');
    toast(err.message);
  }
}

function renderLogisticsRow(row, schema, destination) {
  const id = rowId(row, schema);
  const key = schema.sheet + ':' + id;
  const expanded = state.expanded === key;
  const name = row['Item'] || '—';

  let metaHtml = '';
  let isDone = false;

  if (destination === 'rental') {
    isDone = isChecked(row['Returned']);

    // 1. Gather Rental Specific Data
    const qty = row['Quantity'] ? `<span class="pill">Qty: ${row['Quantity']}</span>` : '';
    const vendor = row['Vendor/Person'] ? `<span class="pill">🏢 ${escapeHtml(row['Vendor/Person'])}</span>` : '';
    const returnDateRaw = row['Date of Expected Return'];
    const returnTimeRaw = row['Time to return'];

    // 2. Smart Date Formatting
    let dateHtml = '';
    if (returnDateRaw) {
      const d = parseSheetDate(returnDateRaw);
      const daysLeft = daysUntil(returnDateRaw);

      let dateStr = d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
      const timeStr = fmtTime(returnTimeRaw);

      if (timeStr) dateStr += ` at ${timeStr}`;

      let dateClass = '';
      if (!isDone && daysLeft !== null) {
        if (daysLeft < 0) dateClass = 'pill-red';       // Overdue
        else if (daysLeft === 0) dateClass = 'pill-amber'; // Due today
      }

      dateHtml = `<span class="pill ${dateClass}">📅 Due ${dateStr}</span>`;
    }

    // 3. The Dropdown (mapped to boolean strings)
    const statusHtml = `
      <select class="logistics-status-select" data-action="update-status" data-prev="${isDone}">
        <option value="false" ${!isDone ? 'selected' : ''}>Needs return</option>
        <option value="true" ${isDone ? 'selected' : ''}>Returned</option>
      </select>
    `;

    metaHtml = `
      <span class="pill" style="background:#eef0fb; color:#1e2a6a;">📦 Rental</span>
      ${statusHtml}
      ${qty}
      ${vendor}
      ${dateHtml}
    `;

  } else {
    // Venue & Home logic remains the same
    const badge = destination === 'venue'
      ? '<span class="pill">🏛 Venue run</span>'
      : '<span class="pill">🏠 New home</span>';

    const status = row['Status'] || 'Not started';
    isDone = status === 'Returned home' || status === 'At new home';

    const statuses = destination === 'venue'
      ? ['Not started', 'Packed for venue', 'Taken to venue', 'Packed for home', 'Returned home']
      : ['Not started', 'Packed', 'At new home'];

    const statusHtml = `
      <select class="logistics-status-select" data-action="update-status" data-prev="${escapeHtml(status)}">
        ${statuses.map(s => `<option value="${s}" ${s === status ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    `;

    const person = row['Person Responsible'] ? `<span class="pill">${escapeHtml(row['Person Responsible'])}</span>` : '';
    const location = row['Last known Location'] || row['Location'] ? `<span class="pill">📍 ${escapeHtml(row['Last known Location'] || row['Location'])}</span>` : '';

    metaHtml = `
      ${badge}
      ${statusHtml}
      ${person}
      ${location}
    `;
  }

  return `<div class="ql-row ${isDone ? 'done' : ''} ${expanded ? 'expanded' : ''}"
              data-id="${escapeHtml(String(id))}"
              data-row="${row._row}"
              data-sheet="${escapeHtml(schema.sheet)}">
    <div class="ql-row-main">
      
      <div class="ql-row-info" data-action="expand">
        <div class="ql-row-name">${escapeHtml(name)}</div>
        <div class="ql-row-meta">
          ${metaHtml}
        </div>
      </div>
      <button type="button" class="ql-more" data-action="expand">⋯</button>
    </div>
    ${expanded ? renderInlineEditor(row, schema) : ''}
  </div>`;
}

function showLogisticsAdd(vSchema, hSchema, rSchema) {
  const strip = $('#lg-add-strip');
  if (!strip) return;
  if (strip.firstChild) { strip.innerHTML = ''; return; }

  strip.innerHTML = `
    <div class="ql-quick-add" id="lg-quick-add">
      <div class="field field-compact">
        <label>Type</label>
        <select id="lg-dest">
          <option value="venue">Venue run</option>
          <option value="home">New home</option>
          <option value="rental">Rental</option>
        </select>
      </div>
      <div class="field field-compact">
        <label>Item</label>
        <input id="lg-name" placeholder="What are you carrying?">
      </div>
      <div class="field field-compact">
        <label>Person / Vendor</label>
        <input id="lg-person" placeholder="Who's handling it?">
      </div>
      <div class="ql-quick-actions">
        <button type="button" class="btn" data-action="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="create">Add</button>
      </div>
    </div>
  `;

  const form = $('#lg-quick-add');
  form.onclick = async (e) => {
    const action = e.target.dataset.action;
    if (action === 'cancel') { strip.innerHTML = ''; return; }
    if (action !== 'create') return;

    const name = $('#lg-name').value.trim();
    if (!name) return toast('Please enter an item');

    const dest = $('#lg-dest').value;
    let schema = vSchema;
    if (dest === 'home') schema = hSchema;
    if (dest === 'rental') schema = rSchema;
    if (!schema) return toast('Destination config missing');

    const data = { 'Item': name };
    const person = $('#lg-person').value.trim();

    if (dest === 'rental') {
      data['Vendor/Person'] = person;
      data['Returned'] = false;
    } else {
      data['Status'] = 'Not started';
      data['Person Responsible'] = person;
    }

    const res = await apiWrite('create', schema.sheet, data);
    if (res.error) return toast('Add failed: ' + res.error);
    toast('Added');
    strip.innerHTML = '';
    renderLogistics();
  };
}
// ============================================================
// VIEW: Vendors (merged from 4 source sheets)
// ============================================================

async function renderVendors() {
  setStatus('Loading vendors…');
  try {
    const sources = getVendorSources();
    const results = await Promise.all(sources.map(s => apiGetRows(s.sheet)));

    const vendors = [];
    results.forEach((res, i) => {
      if (res.error) return;
      (res.rows || []).forEach(r => {
        vendors.push(normalizeVendor(r, sources[i]));
      });
    });

    const named = vendors.filter(v => v.name);

    // Filters
    const kinds = ['All', ...Array.from(new Set(named.map(v => v.kind)))];
    const activeKind = state.filter._vendors || 'All';
    const activeStatus = state.filter._vendors_status || 'Active';
    const q = (state.search._vendors || '').toLowerCase();

    let filtered = named;

    // Status Filter: Default hides 'Cut' vendors
    // Define what it means to be successfully chosen
    const chosenStages = [
      'Chosen/Approved', 'Contract Sent', 'Contract Received', 'Contract Signed',
      'Contract Returned', 'Deposit Made', 'Shipped', 'Arrived', 'Picked Up'
    ];

    if (activeStatus === 'Active') {
      filtered = filtered.filter(v => !String(v.stage).startsWith('Cut'));
    } else if (activeStatus === 'Chosen') {
      filtered = filtered.filter(v => chosenStages.includes(v.stage));
    }

    if (activeKind !== 'All') {
      filtered = filtered.filter(v => v.kind === activeKind);
    }
    if (q) {
      filtered = filtered.filter(v => Object.values(v).some(val => String(val).toLowerCase().includes(q)));
    }

    // Alphabetical Sort (No more grouping by stage buckets)
    filtered.sort((a, b) => a.name.localeCompare(b.name));

    $('#view').innerHTML = `
      <div class="toolbar">
        <h1>Vendors</h1>
        <div class="toolbar-actions">
          <span class="pill">${named.length} total</span>
          <button class="btn btn-primary" id="v-add">+ Add vendor</button>
        </div>
      </div>
      
      <div id="v-add-strip"></div>

      <div class="ql-controls">
        <input type="search" id="v-search" placeholder="Search vendors, types, phones…" value="${escapeHtml(state.search._vendors || '')}">
      </div>
      
      <div class="chips">
        ${kinds.map(k => `<button class="chip ${activeKind === k ? 'on' : ''}" data-kind="${escapeHtml(k)}">${escapeHtml(k)}</button>`).join('')}
      </div>
      
      <div class="chips" style="margin-top:-4px;">
        <button class="chip ${activeStatus === 'Active' ? 'on' : ''}" data-status="Active">Active (No Cuts)</button>
        <button class="chip ${activeStatus === 'Chosen' ? 'on' : ''}" data-status="Chosen">Chosen/Approved</button>
        <button class="chip ${activeStatus === 'All' ? 'on' : ''}" data-status="All">Show All</button>
      </div>

      ${filtered.length === 0 ? `<div class="ql-empty">No vendors match</div>` : `
        <div class="ql-list">
          ${filtered.map(renderVendorRow).join('')}
        </div>
      `}
    `;

    const search = $('#v-search');
    if (search) search.oninput = debounce(() => { state.search._vendors = search.value; renderVendors(); }, 200);

    $$('.chip[data-kind]').forEach(chip => {
      chip.onclick = () => { state.filter._vendors = chip.dataset.kind; renderVendors(); };
    });

    $$('.chip[data-status]').forEach(chip => {
      chip.onclick = () => { state.filter._vendors_status = chip.dataset.status; renderVendors(); };
    });

    $('#v-add').onclick = () => showVendorAdd(sources, $('#v-add-strip'), named);

    $('#view').onclick = (e) => {
      const editBtn = e.target.closest('.vendor-edit-btn');
      if (editBtn) {
        const card = editBtn.closest('.vendor-card');
        if (!card) return;
        const source = card.dataset.source;
        const rowNum = Number(card.dataset.row);
        const vendor = named.find(v => v._source === source && v._row === rowNum);
        if (vendor) openVendorEditor(card, vendor);
        return;
      }
      if (e.target.closest('.vendor-actions')) return;
      if (e.target.closest('select, a, button, input, textarea')) return;
      const card = e.target.closest('.vendor-card');
      if (!card) return;
      card.classList.toggle('expanded');
    };

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

function showVendorAdd(sources, strip, existingVendors) {
  if (!strip) return;
  if (strip.firstChild) { strip.innerHTML = ''; return; }

  const sourceOptions = sources.map(s => `<option value="${escapeHtml(s.sheet)}">${escapeHtml(s.kind)} Vendor</option>`).join('');
  const allTypes = Array.from(new Set(existingVendors.map(v => v.type).filter(Boolean))).sort();

  strip.innerHTML = `<div class="ql-quick-add" id="v-quick-add">
    <div class="field field-compact">
      <label>Source Sheet</label>
      <select id="v-source">${sourceOptions}</select>
    </div>
    <div class="field field-compact">
      <label>Vendor / Company</label>
      <input id="v-name" placeholder="Name" required>
    </div>
    <div class="field field-compact">
      <label>Type</label>
      <select id="v-type">
        <option value="">— Select Type —</option>
        ${allTypes.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
        <option value="Other">Other (Type manually)</option>
      </select>
      <input id="v-type-other" placeholder="Enter new type" style="display:none; margin-top:4px;">
    </div>
    <div class="field field-compact">
      <label>Phone</label>
      <input id="v-phone" placeholder="Phone number" type="tel">
    </div>
    <div class="field field-compact">
      <label>Stage</label>
      <select id="v-stage"></select>
    </div>
    <div class="ql-quick-actions">
      <button type="button" class="btn" data-action="cancel">Cancel</button>
      <button type="button" class="btn btn-primary" data-action="create">Add</button>
    </div>
  </div>`;

  const form = $('#v-quick-add');
  const sourceSel = $('#v-source');
  const stageSel = $('#v-stage');

  // Function to load the correct stages for the selected sheet
  const updateStages = () => {
    const sheetName = sourceSel.value;
    const schema = state.schema.find(s => s.sheet === sheetName);

    // All sheets now use 'Stage of Communication'
    let opts = optionsForColumn(schema, 'Stage of Communication');

    if (!opts || opts.length === 0) {
      opts = ['Inquiries Made', 'Call Scheduled', 'Quote Received', 'Waiting on Final Proposal', 'Chosen/Approved', 'Paid'];
    }

    stageSel.innerHTML = `<option value="">— No stage —</option>` +
      opts.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  };

  // Run once on load, and every time the sheet changes
  updateStages();
  sourceSel.onchange = updateStages;

  form.querySelector('input')?.focus();

  $('#v-type').onchange = (e) => {
    $('#v-type-other').style.display = e.target.value === 'Other' ? 'block' : 'none';
    if (e.target.value === 'Other') $('#v-type-other').focus();
  };

  form.onclick = async (e) => {
    const action = e.target.dataset.action;
    if (action === 'cancel') { strip.innerHTML = ''; return; }
    if (action !== 'create') return;

    const sourceSheet = sourceSel.value;
    const name = $('#v-name').value.trim();
    if (!name) return toast('Please enter a vendor name');

    let typeVal = $('#v-type').value;
    if (typeVal === 'Other') typeVal = $('#v-type-other').value.trim();

    const columnMap = {
      'Wedding Vendor Sourcing': { name: 'Wedding Vendor/Company', type: 'Type', phone: 'Phone number', stage: 'Stage of Communication' },
      'Household Vendor Sourcing': { name: 'Name/Company', type: 'Type', phone: 'Phone number', stage: 'Stage of Communication' },
      'Food Vendor Sourcing': { name: 'Vendor', type: 'Food items', phone: 'Phone number', stage: 'Stage of Communication' },
      'Honeymoon Vendor Sourcing': { name: 'Vendor/Company', type: 'Type', phone: 'Phone number', stage: 'Stage of Communication' }
    };

    const map = columnMap[sourceSheet];
    if (!map) return toast('Unknown vendor sheet');

    const data = {};
    data[map.name] = name;
    if (typeVal) data[map.type] = typeVal;

    const phoneVal = $('#v-phone').value.trim();
    if (phoneVal) data[map.phone] = phoneVal;

    const stageVal = stageSel.value;
    if (stageVal) data[map.stage] = stageVal;

    const res = await apiWrite('create', sourceSheet, data);
    if (res.error) return toast('Add failed: ' + res.error);

    toast('Vendor added');
    strip.innerHTML = '';
    renderVendors();
  };
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

  // Dynamically get the options from the sheet's data validation
  const schema = state.schema.find(s => s.sheet === v._source);
  let stageOptions = optionsForColumn(schema, v._stageField);

  // Fallback just in case the sheet has no validations set up
  if (!stageOptions || stageOptions.length === 0) {
    stageOptions = ['Inquiries Made', 'Call Scheduled', 'Quote Received', 'Waiting on Final Proposal', 'Chosen/Approved', 'Paid', 'Cut - Budget', 'Cut - don\'t trust', 'Cut - Other'];
  }

  // Make sure the current stage is in the list so it shows up properly
  if (v.stage && !stageOptions.includes(v.stage)) {
    stageOptions.push(v.stage);
  }

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
        ${stageOptions.map(s => `<option value="${s}" ${s === v.stage ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      ${phone ? `
        <a class="vendor-action" href="${escapeHtml(tel)}">📞 Call</a>
        <a class="vendor-action wa" href="${escapeHtml(wa)}" target="_blank" rel="noopener">💬 WhatsApp</a>
      ` : ''}
      <button type="button" class="vendor-action vendor-edit-btn">✎ Edit</button>
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

function openVendorEditor(card, vendor) {
  const existing = card.querySelector('.vendor-editor');
  if (existing) { existing.remove(); return; }

  const raw = vendor._raw || {};
  const findKey = (...cands) => {
    for (const c of cands) {
      if (raw[c] !== undefined) return c;
    }
    return '';
  };

  const fieldDefs = [
    { key: findKey('Wedding Vendor/Company', 'Name/Company', 'Vendor', 'Vendor/Company'), label: 'Name' },
    { key: findKey('Type', 'Food items'), label: 'Type' },
    { key: findKey('Contact Person'), label: 'Contact person' },
    { key: findKey('Phone number', 'Phone numbers'), label: 'Phone' },
    { key: findKey('Address', 'Location'), label: 'Address' },
    { key: findKey('City/State'), label: 'City / State' },
    { key: findKey('Price', 'Price(for comparison)'), label: 'Price' },
    { key: findKey('Notes (Bride)', 'Notes'), label: 'Notes', type: 'textarea' }
  ].filter(f => f.key);

  const fields = fieldDefs.map(f => ({
    name: f.key,
    label: f.label,
    type: f.type || guessType(f.key)
  }));

  const editor = document.createElement('div');
  editor.className = 'vendor-editor ql-editor';
  editor.innerHTML = `
    ${fields.map(f => renderField(f, raw[f.name])).join('')}
    <div class="ql-editor-actions">
      <button type="button" class="btn" data-action="cancel">Cancel</button>
      <button type="button" class="btn btn-primary" data-action="save">Save</button>
    </div>
  `;

  const details = card.querySelector('.vendor-details');
  card.insertBefore(editor, details);

  editor.onclick = async (e) => {
    e.stopPropagation();
    const action = e.target.dataset.action;
    if (action === 'cancel') { editor.remove(); return; }
    if (action !== 'save') return;

    const data = readForm(editor);
    const res = await apiWrite('update', vendor._source, data, null, vendor._row);
    if (res.error) { toast('Save failed: ' + res.error); return; }
    toast('Saved');
    editor.remove();
    renderVendors();
  };
}

// ============================================================
// VIEW: Global search
// ============================================================

async function renderSearch() {
  const q = state.globalSearch.trim();
  if (!q) { $('#view').innerHTML = '<h1>Search</h1><p class="muted">Type in the search box above.</p>'; return; }

  setStatus('Searching…');
  const sources = state.schema
    .filter(s => s.type === 'data')
    .map(s => s.sheet);
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

          const id = sch ? rowId(row, sch) : row._row;

          return `<div class="ql-row search-result-row" 
                       data-route="${escapeHtml(r.sheet)}" 
                       data-id="${escapeHtml(String(id))}" 
                       style="cursor:pointer">
                <div class="ql-row-main">
                  <div class="ql-row-info">
                    <div class="ql-row-name">${escapeHtml(String(row[Object.keys(row)[1]] || '—'))}</div>
                    <div class="ql-row-meta">${preview}</div>
                  </div>
                  <div class="ql-more" style="color: var(--accent); font-weight: bold;">→</div>
                </div>
              </div>`;
        }).join('')}
            ${r.matches.length > 10 ? `<div class="more">+ ${r.matches.length - 10} more</div>` : ''}
          </div>`;
      }).join('')}
  `;

  // Bind click events to the search results
  $$('.search-result-row').forEach(el => {
    el.onclick = () => {
      const route = el.dataset.route;
      const id = el.dataset.id;

      // Store the intended expansion, then change the URL hash
      state.pendingExpand = { sheet: route, id: id };
      location.hash = '#/' + encodeURIComponent(route);
    };
  });

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

  // Hide the merged sheets so they don't show up as individual tabs
  const HIDDEN_SHEETS = [
    'Gifts Received',
    'Cash Contributions',
    'Things to get to and from venue',
    'Things to take back to new home',
    'Rentals Tracker'
  ];

  const items = [];
  VIRTUAL_NAV.forEach(v => items.push({ route: v.route, label: v.label, order: v.order }));

  // Add all visible sheets EXCEPT the hidden ones
  state.schema
    .filter(s => s.visible && s.type !== 'link' && !HIDDEN_SHEETS.includes(s.sheet))
    .forEach(s => {
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

  // Check if we arrived here from a search result
  if (state.pendingExpand && state.pendingExpand.sheet === route) {
    state.expanded = route + ':' + state.pendingExpand.id;
    state.pendingExpand = null; // clear it so it doesn't stick
  } else {
    state.expanded = null;
  }

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
  const body = document.body;
  if (!btn || !sidebar || !backdrop) return;

  // Must match the CSS breakpoint (max-width: 900px / min-width: 901px).
  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

  // Restore persisted desktop collapse preference on boot.
  if (!isMobile() && localStorage.getItem('sidebarCollapsed') === '1') {
    body.classList.add('sidebar-collapsed');
  }

  btn.onclick = () => {
    if (isMobile()) {
      // Mobile: slide-in drawer, unchanged from before.
      sidebar.classList.toggle('open');
      backdrop.classList.toggle('show');
    } else {
      // Desktop: collapse / expand via a body-level class so the CSS
      // can also reposition the toggle button (which is a sibling of
      // #app, not a descendant). Persist the choice.
      const collapsed = body.classList.toggle('sidebar-collapsed');
      localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
    }
  };

  backdrop.onclick = () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
  };

  // Close the mobile drawer when a nav link is tapped.
  // Guarded so it's a no-op on desktop, where the sidebar isn't a drawer.
  document.addEventListener('click', (e) => {
    if (!isMobile()) return;
    if (e.target.closest('#nav a') || e.target.closest('.sidebar a')) {
      sidebar.classList.remove('open');
      backdrop.classList.remove('show');
    }
  });
}


// ============================================================
// AUTHENTICATION & BOOT
// ============================================================

async function boot() {
  const savedSecret = localStorage.getItem('wedding_secret');

  if (savedSecret) {
    // If they already logged in previously, skip the login screen
    CONFIG.secret = savedSecret;
    document.getElementById('login-screen').style.display = 'none';
    await startApp();
  } else {
    // Show the login screen
    const loginBtn = document.getElementById('login-btn');
    const loginInput = document.getElementById('login-password');
    const loginError = document.getElementById('login-error');

    loginInput.focus();

    const attemptLogin = async () => {
      const enteredSecret = loginInput.value.trim();
      if (!enteredSecret) return;

      loginBtn.textContent = 'Checking...';
      loginError.style.display = 'none';

      // Temporarily set the secret to test it
      CONFIG.secret = enteredSecret;

      try {
        const res = await apiGetSchema();
        if (res.error === 'unauthorized') {
          // Wrong password
          loginBtn.textContent = 'Unlock';
          loginError.style.display = 'block';
          loginInput.value = '';
        } else {
          // Success! Save to browser and boot the app
          localStorage.setItem('wedding_secret', enteredSecret);
          document.getElementById('login-screen').style.display = 'none';
          await startApp();
        }
      } catch (err) {
        loginBtn.textContent = 'Unlock';
        loginError.textContent = 'Network error. Try again.';
        loginError.style.display = 'block';
      }
    };

    loginBtn.onclick = attemptLogin;
    loginInput.onkeydown = (e) => { if (e.key === 'Enter') attemptLogin(); };
  }
}

// Move the actual app startup logic here
async function startApp() {
  try {
    setStatus('Loading schema…');
    const res = await apiGetSchema();
    if (res.error) throw new Error(res.error);

    state.schema = res.schema || [];
    state.booted = true;

    if (!state.schema.length) {
      showBootError('No views configured', 'The spreadsheet has no visible sheets set up.');
      return;
    }

    const hash = location.hash.replace('#/', '');
    state.route = hash ? decodeURIComponent(hash) : '_overview';

    renderNav();
    bindGlobalSearch();
    initMenuToggle();
    await render();
  } catch (err) {
    showBootError('Could not load the app', err.message);
  }
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

const lockBtn = $('#lock-btn');
if (lockBtn) lockBtn.onclick = () => {
  localStorage.removeItem('wedding_secret');
  location.reload(); // This reloads the page and shows the login screen again
};
// Start the app
boot();