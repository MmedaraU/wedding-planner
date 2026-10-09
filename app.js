// ============================================================
// WEDDING PLANNER — SITE
//
// Schema-driven frontend that reads/writes a Google Sheet via
// an Apps Script Web App API.
//
// Architecture:
//   - boot() fetches the schema from the API (?schema=true)
//   - renderNav() builds the sidebar from the schema
//   - Each route dispatches to a view function via the VIEWS registry
//   - Each view reads its data from the API and renders a tailored layout
//   - Views fall back to renderTable() if not registered
// ============================================================

const CONFIG = window.WEDDING_CONFIG;

// ---------- Global state ----------

const state = {
  schema: [],         // [{ sheet, label, headerRow, dataStart, idColumn, visible, sortOrder, fields, type, url }]
  route: null,        // current sheet name or '_overview'
  data: {},           // { sheetName: [rows] }
  booted: false
};

// ============================================================
// API helpers
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

async function apiWrite(action, sheetName, data, id) {
  const body = JSON.stringify({
    secret: CONFIG.secret,
    sheet: sheetName,
    action,
    data,
    id
  });
  return (await fetch(CONFIG.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body
  })).json();
}

// ============================================================
// Utility helpers
// ============================================================

function currentSchema() {
  return state.schema.find(s => s.sheet === state.route);
}

function setStatus(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

function toast(msg) {
  const el = document.getElementById('toast');
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
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return String(d);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function isChecked(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 'Yes' || v === 1;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (isNaN(target)) return null;
  const diff = target - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function defaultFieldsFor(schema) {
  const cols = schema.columns || [];
  return cols.map(c => ({ name: c, label: c, type: 'text' }));
}

// ============================================================
// Shared render building blocks
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

// ============================================================
// View registry
// ============================================================

const VIEWS = {
  '_overview': renderOverview,
  'Guest List': renderGuests,
  'budget_flat': renderBudget,
  'Wedding Vendor Sourcing': renderVendors,
  'Planning Schedule': renderTasks,
  'To do list': renderTasks,
  'Rentals Tracker': renderChecklist,
  'Gifts Received': renderChecklist,
  'Cash Contributions': renderChecklist,
  'Name Change Checklist': renderChecklist,
  'New Home': renderChecklist,
  'Things to get to and from venue': renderChecklist,
  'Things to take back to new home': renderChecklist,
  '_default': renderTable
};

async function render() {
  // Overview is a virtual route — handle it before looking up a schema
  if (state.route === '_overview') {
    return renderOverview();
  }

  const schema = currentSchema();
  if (!schema) {
    document.getElementById('view').innerHTML = '<h1>Sheet not found</h1>';
    return;
  }

  if (schema.type === 'link') {
    renderLinkView(schema);
    return;
  }

  const viewFn = VIEWS[schema.sheet] || VIEWS._default;
  await viewFn(schema);
}

// ============================================================
// Overview
// ============================================================

async function renderOverview() {
  setStatus('Loading overview…');
  try {
    const res = await apiGetOverview();
    if (res.error) throw new Error(res.error);
    const { meta = {}, metaGrouped = {}, stats = {} } = res;

    const weddingDate = meta.wedding_date ? new Date(meta.wedding_date) : null;
    const days = daysUntil(meta.wedding_date);

    const coupleGroup = metaGrouped.Couple || [];
    const coupleName = (coupleGroup.find(x => x.key === 'couple_names') || {}).value || '—';
    const hashtag = (coupleGroup.find(x => x.key === 'hashtag') || {}).value || '';

    const datesGroup = metaGrouped.Dates || [];

    const budgetUsedPct = stats.budget_budgeted
      ? (stats.budget_actual / stats.budget_budgeted) * 100
      : 0;
    const guestPct = stats.guests_total
      ? (stats.guests_coming / stats.guests_total) * 100
      : 0;

    const view = document.getElementById('view');
    view.innerHTML = `
      <h1>Overview</h1>

      <div class="hero">
        <div class="hero-left">
          <div class="hero-couple">${escapeHtml(coupleName)}</div>
          <div class="hero-date">${escapeHtml(meta.wedding_date || '')}</div>
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
        <table class="info-table">
          <tbody>
            ${datesGroup.map(d => `
              <tr>
                <td class="info-label">${escapeHtml(d.label)}</td>
                <td>${escapeHtml(d.value || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : ''}

      <h2>Progress</h2>
      ${renderStats([
      { label: 'Guests confirmed', value: `${stats.guests_coming || 0} / ${stats.guests_total || 0}` },
      { label: 'Budget spent', value: `${Math.round(budgetUsedPct)}%` },
      { label: 'Plan tasks done', value: `${stats.planning_done || 0} / ${stats.planning_total || 0}` },
      { label: 'Vendors chosen', value: `${stats.vendors_chosen || 0} / ${stats.vendors_total || 0}` }
    ])}

      ${renderProgress(guestPct, 'Guest confirmations')}
      ${renderProgress(budgetUsedPct, 'Budget used')}

      ${Object.entries(metaGrouped)
        .filter(([group]) => !['Couple', 'Dates'].includes(group))
        .map(([group, items]) => `
          <div class="meta-group">
            <div class="meta-group-name">${escapeHtml(group)}</div>
            <table class="info-table">
              <tbody>
                ${items.map(it => `
                  <tr>
                    <td class="info-label">${escapeHtml(it.label)}</td>
                    <td>${escapeHtml(String(it.value || ''))}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `).join('')}
    `;

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed to load');
    toast('Could not load overview: ' + err.message);
  }
}

// ============================================================
// Guests view
// ============================================================

async function renderGuests(schema) {
  setStatus('Loading guests…');
  try {
    const res = await apiGetRows('Guest List');
    if (res.error) throw new Error(res.error);
    const rows = res.rows || [];
    state.data['Guest List'] = rows;
    if (rows.length > 0) schema.columns = Object.keys(rows[0]).filter(k => k !== '_row');
    if (!schema.fields || schema.fields.length === 0) schema.fields = defaultFieldsFor(schema);

    const total = rows.reduce((s, r) => s + (Number(r['Number to expect']) || 0), 0);
    const coming = rows
      .filter(r => r['Guest Response'] === 'Coming')
      .reduce((s, r) => s + (Number(r['Number to expect']) || 0), 0);
    const pending = rows
      .filter(r => !r['Guest Response'] || r['Guest Response'] === 'Pending')
      .reduce((s, r) => s + (Number(r['Number to expect']) || 0), 0);
    const needHotel = rows.filter(r => r['Accomodation Option'] === 'Hotel').length;

    const byCategory = {};
    rows.forEach(r => {
      const c = r.Category || 'Other';
      if (!byCategory[c]) byCategory[c] = { count: 0, coming: 0, guests: [] };
      byCategory[c].count += 1;
      if (r['Guest Response'] === 'Coming') byCategory[c].coming += 1;
      byCategory[c].guests.push(r);
    });

    const view = document.getElementById('view');
    view.innerHTML = `
      <div class="toolbar">
        <h1>Guests</h1>
        <button class="btn btn-primary" id="add-btn">+ Add guest</button>
      </div>

      ${renderStats([
      { label: 'Expected', value: total },
      { label: 'Coming', value: coming },
      { label: 'Pending', value: pending },
      { label: 'Need hotel', value: needHotel }
    ])}

      ${renderProgress(total ? (coming / total) * 100 : 0, 'Confirmed')}

      <h2>By category</h2>
      <div class="section-cards">
        ${Object.entries(byCategory).map(([name, cat]) => `
          <div class="section-card">
            <div class="section-name">${escapeHtml(name)}</div>
            <div class="section-numbers">
              <span class="spent">${cat.coming}</span>
              <span class="muted">of ${cat.count} confirmed</span>
            </div>
            ${renderProgress(cat.count ? (cat.coming / cat.count) * 100 : 0, '')}
            <div class="section-items">
              ${cat.guests.slice(0, 5).map(g => `
                <div class="budget-item" data-guest-name="${escapeHtml(g.Names)}">
                  <div class="bi-name">${escapeHtml(g.Names)}</div>
                  <div class="bi-amounts">
                    ${g['Guest Response'] === 'Coming' ? '<span class="pill pill-green">Coming</span>' : ''}
                    ${g['Accomodation Option'] === 'Hotel' ? '<span class="pill pill-amber">Hotel</span>' : ''}
                  </div>
                </div>
              `).join('')}
              ${cat.guests.length > 5 ? `<div class="more">+ ${cat.guests.length - 5} more</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    document.getElementById('add-btn').onclick = () => openEditor(schema, null);
    view.querySelectorAll('.budget-item[data-guest-name]').forEach(el => {
      el.onclick = () => {
        const guest = rows.find(r => r.Names === el.dataset.guestName);
        if (guest) openEditor(schema, guest);
      };
    });

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed');
    toast(err.message);
  }
}

// ============================================================
// Budget view
// ============================================================

async function renderBudget(schema) {
  setStatus('Loading budget…');
  try {
    const res = await apiGetRows('budget_flat');
    if (res.error) throw new Error(res.error);
    const rows = res.rows || [];
    state.data['budget_flat'] = rows;
    if (rows.length > 0) schema.columns = Object.keys(rows[0]).filter(k => k !== '_row');
    if (!schema.fields || schema.fields.length === 0) schema.fields = defaultFieldsFor(schema);

    const totalBudgeted = rows.reduce((s, r) => s + (Number(r.budgeted) || 0), 0);
    const totalActual = rows.reduce((s, r) => s + (Number(r.actual) || 0), 0);
    const totalPaid = rows.reduce((s, r) => s + (Number(r.deposit) || 0), 0);
    const outstanding = totalActual - totalPaid;
    const remaining = totalBudgeted - totalActual;

    const bySection = {};
    rows.forEach(r => {
      const sec = r.section || 'Other';
      if (!bySection[sec]) bySection[sec] = { budgeted: 0, actual: 0, paid: 0, items: [] };
      bySection[sec].budgeted += Number(r.budgeted) || 0;
      bySection[sec].actual += Number(r.actual) || 0;
      bySection[sec].paid += Number(r.deposit) || 0;
      bySection[sec].items.push(r);
    });

    const view = document.getElementById('view');
    view.innerHTML = `
      <div class="toolbar">
        <h1>Budget</h1>
        <button class="btn btn-primary" id="add-btn">+ Add expense</button>
      </div>

      ${renderStats([
      { label: 'Budgeted', value: money(totalBudgeted) },
      { label: 'Spent', value: money(totalActual), hint: remaining >= 0 ? money(remaining) + ' left' : money(-remaining) + ' over' },
      { label: 'Paid', value: money(totalPaid) },
      { label: 'Outstanding', value: money(outstanding) }
    ])}

      ${renderProgress(totalBudgeted ? (totalActual / totalBudgeted) * 100 : 0, 'Spent vs budgeted')}

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
                ${sec.items.slice(0, 5).map(it => renderBudgetItem(it, rows)).join('')}
                ${sec.items.length > 5 ? `<div class="more">+ ${sec.items.length - 5} more</div>` : ''}
              </div>
            </div>
          `;
    }).join('')}
      </div>
    `;

    document.getElementById('add-btn').onclick = () => openEditor(schema, null);
    view.querySelectorAll('.budget-item[data-row]').forEach(el => {
      el.onclick = () => {
        const idx = Number(el.dataset.row);
        if (rows[idx]) openEditor(schema, rows[idx]);
      };
    });

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed');
    toast(err.message);
  }
}

function renderBudgetItem(row, allRows) {
  const idx = allRows.indexOf(row);
  const budgeted = Number(row.budgeted) || 0;
  const actual = Number(row.actual) || 0;
  const paid = Number(row.deposit) || 0;
  const over = actual > budgeted && budgeted > 0;
  const fullyPaid = actual > 0 && paid >= actual;

  return `
    <div class="budget-item ${over ? 'over' : ''}" data-row="${idx}">
      <div class="bi-name">${escapeHtml(row.item || '—')}</div>
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

// ============================================================
// Vendors view (pipeline)
// ============================================================

async function renderVendors(schema) {
  setStatus('Loading vendors…');
  try {
    const res = await apiGetRows('Wedding Vendor Sourcing');
    if (res.error) throw new Error(res.error);
    const rows = res.rows || [];
    state.data['Wedding Vendor Sourcing'] = rows;
    if (rows.length > 0) schema.columns = Object.keys(rows[0]).filter(k => k !== '_row');
    if (!schema.fields || schema.fields.length === 0) schema.fields = defaultFieldsFor(schema);

    const stages = ['Inquiries Made', 'Call Scheduled', 'Quote Received', 'Chosen/Approved', 'Paid', 'Cut'];
    const byStage = {};
    stages.forEach(s => byStage[s] = []);
    rows.forEach(r => {
      const stage = r['Stage of Communication'] || 'Inquiries Made';
      if (!byStage[stage]) byStage[stage] = [];
      byStage[stage].push(r);
    });

    const chosen = rows.filter(r => r['Stage of Communication'] === 'Chosen/Approved').length;
    const paid = rows.filter(r => r['Stage of Communication'] === 'Paid').length;

    const view = document.getElementById('view');
    view.innerHTML = `
      <div class="toolbar">
        <h1>Vendors</h1>
        <button class="btn btn-primary" id="add-btn">+ Add vendor</button>
      </div>

      ${renderStats([
      { label: 'In pipeline', value: rows.length },
      { label: 'Chosen', value: chosen },
      { label: 'Paid', value: paid }
    ])}

      <div class="pipeline">
        ${stages.map(stage => `
          <div class="pipeline-column">
            <div class="pipeline-header">
              <span>${escapeHtml(stage)}</span>
              <span class="pill">${byStage[stage].length}</span>
            </div>
            <div class="pipeline-items">
              ${byStage[stage].map(v => {
      const idx = rows.indexOf(v);
      return `
                  <div class="pipeline-card" data-row="${idx}">
                    <div class="vc-name">${escapeHtml(v['Wedding Vendor/Company'] || '—')}</div>
                    ${v.Type ? `<div class="vc-type">${escapeHtml(v.Type)}</div>` : ''}
                    ${v.Price ? `<div class="vc-price">${money(v.Price)}</div>` : ''}
                  </div>
                `;
    }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    document.getElementById('add-btn').onclick = () => openEditor(schema, null);
    view.querySelectorAll('.pipeline-card[data-row]').forEach(el => {
      el.onclick = () => {
        const idx = Number(el.dataset.row);
        if (rows[idx]) openEditor(schema, rows[idx]);
      };
    });

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed');
    toast(err.message);
  }
}

// ============================================================
// Tasks view (progress by phase)
// ============================================================

async function renderTasks(schema) {
  setStatus('Loading tasks…');
  try {
    const res = await apiGetRows(schema.sheet);
    if (res.error) throw new Error(res.error);
    const rows = res.rows || [];
    state.data[schema.sheet] = rows;
    if (rows.length > 0) schema.columns = Object.keys(rows[0]).filter(k => k !== '_row');
    if (!schema.fields || schema.fields.length === 0) schema.fields = defaultFieldsFor(schema);

    const cols = schema.columns;
    // Detect the "done" column and "task" column from the schema's columns
    const doneCol = cols.find(c => /done|completed|finished/i.test(c));
    const taskCol = cols.find(c => /task|item|title/i.test(c)) || cols[0];

    const doneCount = doneCol ? rows.filter(r => isChecked(r[doneCol])).length : 0;
    const total = rows.length;
    const pct = total ? (doneCount / total) * 100 : 0;

    // Group by phase if a Phase column exists, otherwise one bucket
    const phaseCol = cols.find(c => /phase|section|stage/i.test(c));
    const byPhase = {};
    rows.forEach(r => {
      const phase = phaseCol ? (r[phaseCol] || 'All') : 'All';
      if (!byPhase[phase]) byPhase[phase] = [];
      byPhase[phase].push(r);
    });

    const view = document.getElementById('view');
    view.innerHTML = `
      <div class="toolbar">
        <h1>${escapeHtml(schema.label)}</h1>
        <button class="btn btn-primary" id="add-btn">+ Add</button>
      </div>

      ${renderStats([
      { label: 'Total', value: total },
      { label: 'Done', value: doneCount },
      { label: 'Remaining', value: total - doneCount }
    ])}

      ${renderProgress(pct, 'Progress')}

      ${Object.entries(byPhase).map(([phase, tasks]) => {
      const phaseDone = doneCol ? tasks.filter(t => isChecked(t[doneCol])).length : 0;
      const phasePct = tasks.length ? (phaseDone / tasks.length) * 100 : 0;
      return `
          <h2>${escapeHtml(phase)}</h2>
          ${renderProgress(phasePct, '')}
          <div class="task-list">
            ${tasks.slice(0, 15).map(t => {
        const idx = rows.indexOf(t);
        const idValue = t[schema.columns[schema.idColumn - 1]];
        return `
                <div class="task-row ${isChecked(t[doneCol]) ? 'done' : ''}">
                  <label>
                    <input type="checkbox" ${isChecked(t[doneCol]) ? 'checked' : ''}
                           data-row="${idx}" data-id="${escapeHtml(idValue)}">
                    <span>${escapeHtml(t[taskCol] || '—')}</span>
                  </label>
                </div>
              `;
      }).join('')}
            ${tasks.length > 15 ? `<div class="more">+ ${tasks.length - 15} more</div>` : ''}
          </div>
        `;
    }).join('')}
    `;

    document.getElementById('add-btn').onclick = () => openEditor(schema, null);
    view.querySelectorAll('input[type=checkbox][data-row]').forEach(cb => {
      cb.onchange = async () => {
        const idx = Number(cb.dataset.row);
        const row = rows[idx];
        if (!row || !doneCol) return;
        const updated = { ...row };
        updated[doneCol] = cb.checked;
        const res = await apiWrite('update', schema.sheet, updated, cb.dataset.id);
        if (res.error) {
          toast('Save failed: ' + res.error);
          cb.checked = !cb.checked;
          return;
        }
        row[doneCol] = cb.checked;
        toast(cb.checked ? 'Done' : 'Reopened');
      };
    });

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed');
    toast(err.message);
  }
}

// ============================================================
// Checklist view (simple: stats + list with checkboxes)
// ============================================================

async function renderChecklist(schema) {
  setStatus('Loading…');
  try {
    const res = await apiGetRows(schema.sheet);
    if (res.error) throw new Error(res.error);
    const rows = res.rows || [];
    state.data[schema.sheet] = rows;
    if (rows.length > 0) schema.columns = Object.keys(rows[0]).filter(k => k !== '_row');
    if (!schema.fields || schema.fields.length === 0) schema.fields = defaultFieldsFor(schema);

    const cols = schema.columns;
    // Find the "done" checkbox column, if any
    const checkCol = cols.find(c => /returned|packed|done|thanked|arrived|signed|completed|returned/i.test(c));

    const doneCount = checkCol ? rows.filter(r => isChecked(r[checkCol])).length : 0;
    const total = rows.length;
    const pct = total ? (doneCount / total) * 100 : 0;
    const nameCol = cols[0];

    const view = document.getElementById('view');
    view.innerHTML = `
      <div class="toolbar">
        <h1>${escapeHtml(schema.label)}</h1>
        <button class="btn btn-primary" id="add-btn">+ Add</button>
      </div>

      ${renderStats([
      { label: 'Total', value: total },
      { label: 'Completed', value: doneCount },
      { label: 'Remaining', value: total - doneCount }
    ])}

      ${renderProgress(pct, 'Progress')}

      <div class="task-list">
        ${rows.length ? rows.map((r, idx) => {
      const idValue = r[cols[schema.idColumn - 1]];
      return `
            <div class="task-row ${checkCol && isChecked(r[checkCol]) ? 'done' : ''}">
              <label>
                ${checkCol
          ? `<input type="checkbox" ${isChecked(r[checkCol]) ? 'checked' : ''}
                            data-row="${idx}" data-id="${escapeHtml(idValue)}">`
          : `<span style="width:16px;display:inline-block"></span>`}
                <span data-row="${idx}" data-id="${escapeHtml(idValue)}" class="clickable">
                  ${escapeHtml(r[nameCol] || '—')}
                </span>
              </label>
            </div>
          `;
    }).join('') : '<div class="task-row" style="text-align:center;color:var(--muted);padding:24px">No items yet</div>'}
      </div>
    `;

    document.getElementById('add-btn').onclick = () => openEditor(schema, null);

    // Click name to open editor
    view.querySelectorAll('.clickable[data-row]').forEach(el => {
      el.onclick = (e) => {
        e.preventDefault();
        const idx = Number(el.dataset.row);
        if (rows[idx]) openEditor(schema, rows[idx]);
      };
    });

    // Toggle checkbox on change
    if (checkCol) {
      view.querySelectorAll('input[type=checkbox][data-row]').forEach(cb => {
        cb.onchange = async () => {
          const idx = Number(cb.dataset.row);
          const row = rows[idx];
          if (!row) return;
          const updated = { ...row };
          updated[checkCol] = cb.checked;
          const res = await apiWrite('update', schema.sheet, updated, cb.dataset.id);
          if (res.error) {
            toast('Save failed: ' + res.error);
            cb.checked = !cb.checked;
            return;
          }
          row[checkCol] = cb.checked;
        };
      });
    }

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed');
    toast(err.message);
  }
}

// ============================================================
// Generic table view (fallback)
// ============================================================

async function renderTable(schema) {
  setStatus('Loading…');
  try {
    const res = await apiGetRows(schema.sheet);
    if (res.error) throw new Error(res.error);
    const rows = res.rows || [];
    state.data[schema.sheet] = rows;
    if (rows.length > 0) schema.columns = Object.keys(rows[0]).filter(k => k !== '_row');
    if (!schema.fields || schema.fields.length === 0) schema.fields = defaultFieldsFor(schema);

    const cols = schema.columns || [];
    const view = document.getElementById('view');
    view.innerHTML = `
      <div class="toolbar">
        <h1>${escapeHtml(schema.label)}</h1>
        <button class="btn btn-primary" id="add-btn">+ Add</button>
      </div>
      <table>
        <thead><tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows.length
        ? rows.map((row, i) => `<tr data-row="${i}">${cols.map(c => `<td>${escapeHtml(row[c])}</td>`).join('')}</tr>`).join('')
        : `<tr><td class="empty" colspan="${Math.max(cols.length, 1)}">No items yet</td></tr>`}
        </tbody>
      </table>
    `;

    document.getElementById('add-btn').onclick = () => openEditor(schema, null);
    view.querySelectorAll('tbody tr[data-row]').forEach(tr => {
      tr.onclick = () => openEditor(schema, rows[Number(tr.dataset.row)]);
    });

    setStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setStatus('Failed');
    toast(err.message);
  }
}

// ============================================================
// Link view (external sheet)
// ============================================================

function renderLinkView(schema) {
  document.getElementById('view').innerHTML = `
    <h1>${escapeHtml(schema.label)}</h1>
    <p>This view lives in the Google Sheet. <a href="${escapeHtml(schema.url)}" target="_blank" rel="noopener">Open it now ↗</a></p>
  `;
  setStatus('External link');
}

// ============================================================
// Editor modal
// ============================================================

function openEditor(schema, row) {
  const isEdit = !!row;
  const modal = document.getElementById('modal');
  const title = document.getElementById('modal-title');
  const form = document.getElementById('modal-form');

  title.textContent = isEdit ? 'Edit' : 'Add';

  const idFieldName = (schema.columns || [])[schema.idColumn - 1];

  form.innerHTML = schema.fields.map(f => {
    const value = row ? row[f.name] : '';
    const id = `f-${f.name}`;
    let input;

    if (f.type === 'select') {
      const opts = (f.options || []).map(o =>
        `<option value="${escapeHtml(o)}" ${o === value ? 'selected' : ''}>${escapeHtml(o || '—')}</option>`
      ).join('');
      input = `<select id="${id}" name="${f.name}">${opts}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea id="${id}" name="${f.name}">${escapeHtml(value)}</textarea>`;
    } else if (f.type === 'checkbox') {
      const checked = isChecked(value);
      return `<div class="field field-checkbox"><label><input type="checkbox" id="${id}" name="${f.name}" ${checked ? 'checked' : ''}> ${escapeHtml(f.label)}</label></div>`;
    } else {
      input = `<input type="${f.type}" id="${id}" name="${f.name}" value="${escapeHtml(value)}">`;
    }
    return `<div class="field"><label for="${id}">${escapeHtml(f.label)}</label>${input}</div>`;
  }).join('') + `
    <div class="modal-actions">
      ${isEdit ? '<button type="button" class="btn btn-danger" id="del">Delete</button>' : ''}
      <button type="button" class="btn" id="cancel">Cancel</button>
      <button type="submit" class="btn btn-primary">Save</button>
    </div>
  `;

  modal.hidden = false;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = {};
    for (const f of schema.fields) {
      const input = form.elements[f.name];
      if (!input) continue;
      if (f.type === 'checkbox') data[f.name] = input.checked;
      else if (f.type === 'number') data[f.name] = input.value === '' ? '' : Number(input.value);
      else data[f.name] = input.value.trim();
    }

    const res = isEdit
      ? await apiWrite('update', schema.sheet, data, row[idFieldName])
      : await apiWrite('create', schema.sheet, data);

    if (res.error) { toast('Save failed: ' + res.error); return; }
    modal.hidden = true;
    await render();
  };

  document.getElementById('cancel').onclick = () => { modal.hidden = true; };
  if (isEdit) {
    document.getElementById('del').onclick = async () => {
      if (!confirm('Delete this item?')) return;
      const res = await apiWrite('delete', schema.sheet, null, row[idFieldName]);
      if (res.error) { toast('Delete failed: ' + res.error); return; }
      modal.hidden = true;
      await render();
    };
  }
}

// ============================================================
// Navigation
// ============================================================

function renderNav() {
  const nav = document.getElementById('nav');
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
  renderNav();
  await render();
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

const refreshBtn = document.getElementById('refresh-btn');
if (refreshBtn) {
  refreshBtn.onclick = () => render();
}

boot();
setInterval(() => {
  if (state.route && currentSchema()?.type !== 'link') render();
}, 60000);