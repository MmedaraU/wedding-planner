// ============================================================
// Wedding Planner — schema-driven frontend
// ============================================================

const CONFIG = window.WEDDING_CONFIG;

const state = {
  schema: [],
  route: null,
  data: {},
  booted: false
};

// ---------- API ----------

async function apiGetSchema() {
  const url = `${CONFIG.apiUrl}?secret=${encodeURIComponent(CONFIG.secret)}&schema=true`;
  return (await fetch(url)).json();
}

async function apiGetRows(sheetName) {
  const url = `${CONFIG.apiUrl}?secret=${encodeURIComponent(CONFIG.secret)}&sheet=${encodeURIComponent(sheetName)}`;
  return (await fetch(url)).json();
}

async function apiWrite(action, sheetName, data, id) {
  const body = JSON.stringify({
    secret: CONFIG.secret, sheet: sheetName, action, data, id
  });
  return (await fetch(CONFIG.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body
  })).json();
}

// ---------- State ----------

function currentSchema() {
  return state.schema.find(s => s.sheet === state.route);
}

function defaultFieldsFor(schema) {
  const cols = schema.columns || [];
  return cols.map(c => ({ name: c, label: c, type: 'text' }));
}

async function loadCurrent() {
  const schema = currentSchema();
  if (!schema || schema.type === 'link') {
    render();
    return;
  }
  setStatus('Loading…');
  try {
    const res = await apiGetRows(schema.sheet);
    if (res.error) throw new Error(res.error);
    const rows = res.rows || [];

    if (rows.length > 0) {
      schema.columns = Object.keys(rows[0]).filter(k => k !== '_row');
    } else if (!schema.columns) {
      schema.columns = [];
    }

    if (!schema.fields || schema.fields.length === 0) {
      schema.fields = defaultFieldsFor(schema);
    }

    state.data[schema.sheet] = rows;
    setStatus('Synced ' + new Date().toLocaleTimeString());
    render();
  } catch (err) {
    setStatus('Failed to load');
    toast('Could not reach the sheet: ' + err.message);
  }
}

// ---------- UI helpers ----------

function setStatus(text) {
  document.getElementById('status').textContent = text;
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

// ---------- Render ----------

function renderNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = state.schema.map(s => {
    if (s.type === 'link') {
      return `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" class="external-link">${escapeHtml(s.label)} ↗</a>`;
    }
    const active = state.route === s.sheet ? 'class="active"' : '';
    return `<a href="#/${encodeURIComponent(s.sheet)}" ${active}>${escapeHtml(s.label)}</a>`;
  }).join('');
}

function render() {
  const schema = currentSchema();
  if (!schema) {
    document.getElementById('view').innerHTML = '<h1>No sheet selected</h1>';
    return;
  }
  if (schema.type === 'link') {
    document.getElementById('view').innerHTML = `
      <h1>${escapeHtml(schema.label)}</h1>
      <p>This view lives in the Google Sheet. <a href="${escapeHtml(schema.url)}" target="_blank" rel="noopener">Open it now ↗</a></p>
    `;
    return;
  }

  const rows = state.data[schema.sheet] || [];
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
      ? rows.map((row, i) => `<tr data-i="${i}">${cols.map(c => `<td>${escapeHtml(row[c])}</td>`).join('')}</tr>`).join('')
      : `<tr><td class="empty" colspan="${Math.max(cols.length, 1)}">No items yet</td></tr>`}
      </tbody>
    </table>
  `;

  document.getElementById('add-btn').onclick = () => openEditor(schema, null);
  view.querySelectorAll('tbody tr[data-i]').forEach(tr => {
    tr.onclick = () => openEditor(schema, rows[Number(tr.dataset.i)]);
  });

  renderNav();
}

// ---------- Editor modal ----------

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
      const checked = value === true || value === 'TRUE' || value === 'true';
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
      if (f.type === 'checkbox') data[f.name] = input.checked;
      else if (f.type === 'number') data[f.name] = input.value === '' ? '' : Number(input.value);
      else data[f.name] = input.value.trim();
    }

    const res = isEdit
      ? await apiWrite('update', schema.sheet, data, row[idFieldName])
      : await apiWrite('create', schema.sheet, data);

    if (res.error) { toast('Save failed: ' + res.error); return; }
    modal.hidden = true;
    await loadCurrent();
  };

  document.getElementById('cancel').onclick = () => { modal.hidden = true; };
  if (isEdit) {
    document.getElementById('del').onclick = async () => {
      if (!confirm('Delete this item?')) return;
      const res = await apiWrite('delete', schema.sheet, null, row[idFieldName]);
      if (res.error) { toast('Delete failed: ' + res.error); return; }
      modal.hidden = true;
      await loadCurrent();
    };
  }
}

// ---------- Boot ----------

async function boot() {
  try {
    setStatus('Loading schema…');
    const res = await apiGetSchema();
    if (res.error) throw new Error(res.error);
    state.schema = res.schema || [];
    state.booted = true;

    if (state.schema.length === 0) {
      document.getElementById('view').innerHTML = '<h1>No sheets configured</h1>';
      setStatus('Ready');
      return;
    }

    const hash = location.hash.replace('#/', '');
    state.route = hash ? decodeURIComponent(hash) : state.schema[0].sheet;
    renderNav();
    await loadCurrent();
  } catch (err) {
    setStatus('Failed');
    toast(err.message);
  }
}

window.addEventListener('hashchange', async () => {
  state.route = decodeURIComponent(location.hash.replace('#/', ''));
  await loadCurrent();
});

document.getElementById('refresh-btn').onclick = loadCurrent;

boot();
setInterval(() => { if (state.route && currentSchema()?.type !== 'link') loadCurrent(); }, 60000);