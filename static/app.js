"use strict";
// defenv UI — plain DOM, no framework. Everything is scoped to the active space.

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = { db: null, tab: "vars", query: "", revealed: new Set(), selected: new Set() };
const SPACE = () => (state.db ? (state.db.activeSpaceId || (state.db.spaces[0] && state.db.spaces[0].id) || null) : null);

const ICON = {
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c6.5 0 10 7 10 7a17 17 0 0 1-3.3 4M6.6 6.6A17 17 0 0 0 2 11s3.5 7 10 7a10.9 10.9 0 0 0 3.4-.5"/><path d="m2 2 20 20"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.9-1"/></svg>',
  plus: '<svg class="plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"/></svg>',
  quote: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 7h3.2v3.2c0 2.3-1.5 3.9-3.7 4.3l-.4-1.3c1.1-.3 1.8-1 1.9-2H7V7zm6.6 0H17v3.2c0 2.3-1.5 3.9-3.7 4.3l-.4-1.3c1.1-.3 1.8-1 1.9-2h-1.6V7z"/></svg>',
  paste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 13h6M9 17h4"/></svg>',
};

// ---- API ----
async function rq(url, method = "GET", body) {
  const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data && data.error ? data.error : res.statusText);
  return data;
}
const api = {
  state: () => rq("/api/state"),
  addSpace: (name) => rq("/api/spaces", "POST", { name }),
  patchSpace: (id, patch) => rq("/api/spaces", "PATCH", { id, ...patch }),
  activateSpace: (id) => rq("/api/spaces", "PATCH", { id, activate: true }),
  delSpace: (id) => rq("/api/spaces?id=" + id, "DELETE"),
  exportSpace: (id) => rq("/api/spaces/export?id=" + id),
  importSpace: (payload) => rq("/api/spaces/import", "POST", { payload }),
  addGroup: (name) => rq("/api/groups", "POST", { spaceId: SPACE(), name }),
  patchGroup: (id, patch) => rq("/api/groups", "PATCH", { id, ...patch }),
  delGroup: (id) => rq("/api/groups?id=" + id, "DELETE"),
  addVar: (v) => rq("/api/variables", "POST", { spaceId: SPACE(), ...v }),
  patchVar: (id, patch) => rq("/api/variables", "PATCH", { id, ...patch }),
  moveVar: (id, groupId) => rq("/api/variables", "PATCH", { action: "move", id, groupId, beforeId: null }),
  delVar: (id) => rq("/api/variables?id=" + id, "DELETE"),
  addSchema: (name) => rq("/api/schemas", "POST", { spaceId: SPACE(), name }),
  patchSchema: (id, patch) => rq("/api/schemas", "PATCH", { id, ...patch }),
  toggleGroup: (id, groupId, on) => rq("/api/schemas", "PATCH", { action: "toggleGroup", id, groupId, on }),
  toggleVar: (id, variableId, on) => rq("/api/schemas", "PATCH", { action: "toggleVariable", id, variableId, on }),
  delSchema: (id) => rq("/api/schemas?id=" + id, "DELETE"),
  addProject: (name, path, schemaId) => rq("/api/projects", "POST", { spaceId: SPACE(), name, path, schemaId }),
  patchProject: (id, patch) => rq("/api/projects", "PATCH", { id, ...patch }),
  delProject: (id) => rq("/api/projects?id=" + id, "DELETE"),
  importEnv: (text, groupId, skipComments) => rq("/api/import", "POST", { spaceId: SPACE(), text, groupId, skipComments }),
  previewSchema: (schemaId) => rq("/api/generate", "POST", { schemaId }),
  previewProject: (projectId) => rq("/api/generate", "POST", { projectId }),
  generateProject: (projectId) => rq("/api/generate", "POST", { projectId, write: true }),
};

// ---- value quoting (mirrors the .env serializer for copy / display) ----
function quoteValue(v) {
  return '"' + String(v ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t") + '"';
}

// ---- download (append + delayed revoke so the browser actually saves) ----
function downloadFile(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime || "text/plain" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener"; a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
}

// ---- feedback ----
function toast(kind, msg) {
  const root = $("#toast-root");
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.textContent = msg;
  root.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
async function reload() { state.db = await api.state(); renderSpaces(); renderContent(); }
async function run(fn, okMsg) {
  try { const r = await fn(); await reload(); if (okMsg) toast("ok", okMsg); return r; }
  catch (e) { toast("err", e.message); }
}

// ---- space-scoped helpers ----
const sortBy = (arr, k) => [...arr].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0));
const groupsSorted = () => sortBy(state.db.groups.filter((g) => g.spaceId === SPACE()), "order");
const varsInGroup = (gid) => sortBy(state.db.variables.filter((v) => v.spaceId === SPACE() && v.groupId === gid), "order");
const schemasSorted = () => sortBy(state.db.schemas.filter((s) => s.spaceId === SPACE()), "order");
const projectsSorted = () => sortBy(state.db.projects.filter((p) => p.spaceId === SPACE()), "name");
const secretIds = () => state.db.variables.filter((v) => v.spaceId === SPACE() && v.secret).map((v) => v.id);
const groupOptions = (sel) => `<option value="">(ungrouped)</option>` + groupsSorted().map((g) => `<option value="${g.id}"${g.id === sel ? " selected" : ""}>${esc(g.name)}</option>`).join("");

// ---- render: Variables ----
function renderVars() {
  const q = state.query.trim().toLowerCase();
  const matches = (v) => !q || v.key.toLowerCase().includes(q) || (!v.secret && v.value.toLowerCase().includes(q)) || (v.description || "").toLowerCase().includes(q);
  let html = `<div class="toolbar">
    <button class="btn-primary" data-act="new-variable">${ICON.plus}Variable</button>
    <button class="btn" data-act="new-group">${ICON.plus}Group</button>
    <button class="btn" data-act="paste">${ICON.paste}Paste .env</button>
    <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn" data-act="collapse-all">Collapse all</button>
      <button class="btn" data-act="expand-all">Expand all</button>
      <button class="btn" data-act="show-all">Show all</button>
      <button class="btn" data-act="hide-all">Hide all</button>
    </div>
  </div>`;

  const selCount = state.db.variables.filter((v) => v.spaceId === SPACE() && state.selected.has(v.id)).length;
  if (selCount > 0) html += `<div class="selbar">
    <span><b>${selCount}</b> selected</span>
    <button class="btn" data-act="move-selected">Move to group…</button>
    <button class="danger-btn" data-act="del-selected">Delete ${selCount}</button>
    <button class="lnk" data-act="clear-sel">Clear selection</button>
  </div>`;

  for (const g of groupsSorted()) {
    const all = varsInGroup(g.id);
    const nameHit = g.name.toLowerCase().includes(q);
    const vars = q && !nameHit ? all.filter(matches) : all;
    if (q && !nameHit && vars.length === 0) continue;
    html += `<div class="card ${g.collapsed ? "collapsed" : ""}">
      <div class="ghead">
        <button class="lnk" data-act="toggle-group" data-id="${g.id}"><span class="caret">▾</span></button>
        <input class="gname" value="${esc(g.name)}" data-change="group-name" data-id="${g.id}" />
        <span class="count">${all.length}</span>
        <div class="acts">
          <button class="lnk" data-act="add-var" data-id="${g.id}">+ var</button>
          <button class="lnk danger" data-act="del-group" data-id="${g.id}">delete</button>
        </div>
      </div>
      <div class="collapsible ${g.collapsed ? "closed" : ""}"><div class="inner">
        ${vars.length ? vars.map(varRow).join("") : `<div class="empty">No variables here yet.</div>`}
      </div></div>
    </div>`;
  }

  const loose = q ? varsInGroup(null).filter(matches) : varsInGroup(null);
  if (!(q && loose.length === 0)) {
    html += `<div class="card dashed">
      <div class="ghead"><span class="gname" style="color:var(--faint)">ungrouped</span><span class="count">${varsInGroup(null).length}</span>
        <div class="acts"><button class="lnk" data-act="add-var-ungrouped">+ var</button></div></div>
      <div class="inner">${loose.length ? loose.map(varRow).join("") : `<div class="empty">Nothing ungrouped.</div>`}</div>
    </div>`;
  }
  return html;
}
function varRow(v) {
  const revealed = !v.secret || state.revealed.has(v.id);
  const eye = v.secret ? `<button class="iconbtn ${revealed ? "on" : ""}" data-act="reveal" data-id="${v.id}" title="${revealed ? "Hide" : "Show"} value">${revealed ? ICON.eye : ICON.eyeOff}</button>` : "";
  const copy = `<button class="iconbtn" data-act="copy" data-id="${v.id}" title="Copy value">${ICON.copy}</button>`;
  const lock = `<button class="iconbtn ${v.secret ? "on" : ""}" data-act="toggle-secret" data-id="${v.id}" title="${v.secret ? "Secret (click to unmark)" : "Mark as secret"}">${v.secret ? ICON.lock : ICON.unlock}</button>`;
  const quote = `<button class="iconbtn ${v.quoted ? "on" : ""}" data-act="toggle-quote" data-id="${v.id}" title="${v.quoted ? "Exported with double quotes" : "Force double quotes on export"}">${ICON.quote}</button>`;
  const sel = state.selected.has(v.id);
  return `<div class="vitem ${sel ? "selected" : ""}" data-vid="${v.id}">
    <div class="row">
      <input type="checkbox" class="selbox" data-sel="${v.id}" ${sel ? "checked" : ""} title="Select for deletion" />
      <input class="cell" value="${esc(v.key)}" data-change="var-key" data-id="${v.id}" spellcheck="false" />
      <input class="cell" type="${revealed ? "text" : "password"}" value="${esc(v.value)}" placeholder="value" data-change="var-value" data-id="${v.id}" spellcheck="false" />
      <div class="acticons">${eye}${copy}${quote}${lock}</div>
      <select class="gsel" data-change="var-group" data-id="${v.id}">${groupOptions(v.groupId || "")}</select>
    </div>
    <div class="vdesc"><input value="${esc(v.description || "")}" placeholder="note / description (optional)" data-change="var-desc" data-id="${v.id}" spellcheck="false" /></div>
  </div>`;
}

// ---- render: Schemas ----
function schemaResolvedKeys(schema) {
  const keys = new Set();
  for (const gid of schema.groupIds) for (const v of state.db.variables) if (v.spaceId === schema.spaceId && v.groupId === gid) keys.add(v.key);
  for (const vid of schema.variableIds) { const v = state.db.variables.find((x) => x.id === vid); if (v) keys.add(v.key); }
  return keys;
}
function renderRequired(s) {
  const req = s.required || [];
  if (!req.length) return `<div class="required"><div class="req-head"><span class="label" style="margin:0">Required keys</span><button class="lnk" data-act="edit-required" data-id="${s.id}">+ add</button></div><span class="hint">No contract yet — add the keys this schema must produce.</span></div>`;
  const resolved = schemaResolvedKeys(s);
  const missing = req.filter((k) => !resolved.has(k));
  return `<div class="required">
    <div class="req-head"><span class="label" style="margin:0">Required keys</span><button class="lnk" data-act="edit-required" data-id="${s.id}">edit</button></div>
    <div class="chips">${req.map((k) => `<span class="chip ${resolved.has(k) ? "ok" : "missing"}">${esc(k)}</span>`).join("")}</div>
    ${missing.length ? `<div class="missing-note">Missing ${missing.length}: ${missing.map(esc).join(", ")}</div>` : `<div class="ok-note">✓ all ${req.length} required key(s) present</div>`}
  </div>`;
}
function renderSchemas() {
  const groupName = (id) => { const g = state.db.groups.find((x) => x.id === id); return g ? g.name : "?"; };
  const varKey = (id) => { const v = state.db.variables.find((x) => x.id === id); return v ? v.key : "?"; };
  let html = `<div class="toolbar"><button class="btn-primary" data-act="new-schema">+ Schema</button>
    <span class="hint">A schema composes whole groups plus loose variables into one .env.</span></div>`;
  const schemas = schemasSorted();
  if (!schemas.length) html += `<p class="hint">No schemas in this space yet. Create one, then pick which groups and variables it includes.</p>`;
  for (const s of schemas) {
    const looseOnly = s.variableIds.filter((id) => { const v = state.db.variables.find((x) => x.id === id); return v && (!v.groupId || !s.groupIds.includes(v.groupId)); });
    html += `<div class="card pad">
      <div class="titlebar"><h3>${esc(s.name)}</h3>
        <div class="acts">
          <button class="lnk" data-act="compose" data-id="${s.id}">compose</button>
          <button class="lnk" data-act="rename-schema" data-id="${s.id}">rename</button>
          <button class="lnk" data-act="preview-schema" data-id="${s.id}">preview .env</button>
          <button class="lnk danger" data-act="del-schema" data-id="${s.id}">delete</button>
        </div>
      </div>
      <div class="chips">
        ${s.groupIds.map((id) => `<span class="chip group">▣ ${esc(groupName(id))}</span>`).join("")}
        ${looseOnly.map((id) => `<span class="chip var">${esc(varKey(id))}</span>`).join("")}
        ${s.groupIds.length === 0 && looseOnly.length === 0 ? `<span class="hint">empty — click “compose”.</span>` : ""}
      </div>
      ${renderRequired(s)}
    </div>`;
  }
  return html;
}

// ---- render: Projects ----
function renderProjects() {
  const schemaName = (id) => { const s = state.db.schemas.find((x) => x.id === id); return s ? s.name : null; };
  const noSchema = schemasSorted().length === 0;
  let html = `<div class="toolbar"><button class="btn-primary" data-act="new-project" ${noSchema ? "disabled" : ""}>+ Project</button>
    <span class="hint">${noSchema ? "Create a schema first." : "A project links a path to a schema, then generates its .env."}</span></div>`;
  const projects = projectsSorted();
  if (!projects.length) html += `<p class="hint">No projects in this space yet.</p>`;
  for (const p of projects) {
    const sn = schemaName(p.schemaId);
    html += `<div class="card pad">
      <div class="titlebar"><h3>${esc(p.name)}</h3>
        ${sn ? `<span class="chip schema">schema: ${esc(sn)}</span>` : `<span class="chip warn">no schema</span>`}
        <div class="acts">
          <button class="lnk" data-act="preview-project" data-id="${p.id}">preview</button>
          <button class="lnk" data-act="edit-project" data-id="${p.id}">edit</button>
          <button class="lnk danger" data-act="del-project" data-id="${p.id}">delete</button>
        </div>
      </div>
      <div class="prow"><code class="path">${esc(p.path)}</code>
        <button class="btn-primary" style="margin-left:auto" data-act="gen-project" data-id="${p.id}" ${sn ? "" : "disabled"}>Generate .env</button>
      </div>
    </div>`;
  }
  return html;
}

function renderSpaces() {
  const sel = $("#space-select");
  if (!sel) return;
  sel.innerHTML = sortBy(state.db.spaces, "order").map((c) => `<option value="${c.id}"${c.id === SPACE() ? " selected" : ""}>${esc(c.name)}</option>`).join("");
}
function renderContent() {
  if (!state.db || !state.db.spaces.length) {
    $("#content").innerHTML = `<div class="empty-state">
      <h2>Welcome to defenv</h2>
      <p class="hint">Create a space to get started — one space per microservice or project.</p>
      <button class="btn-primary" data-act="new-space">${ICON.plus}Create a space</button>
    </div>`;
    return;
  }
  $("#content").innerHTML = state.tab === "vars" ? renderVars() : state.tab === "schemas" ? renderSchemas() : renderProjects();
}

// ---- modals ----
let _onClose = null;
function closeModal() { const h = _onClose; _onClose = null; $("#modal-root").innerHTML = ""; if (h) h(); }
function openModal(title, bodyHtml, opts = {}) {
  _onClose = opts.onClose || null;
  const root = $("#modal-root");
  root.innerHTML = `<div class="overlay" data-act="overlay"><div class="modal ${opts.wide ? "wide" : ""}"><h3>${esc(title)}</h3>${bodyHtml}</div></div>`;
  $(".overlay", root).addEventListener("click", (e) => { if (e.target.classList.contains("overlay")) closeModal(); });
  if (opts.onMount) opts.onMount(root);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT") {
      const save = root.querySelector("[data-act=modal-save]");
      if (save) { e.preventDefault(); save.click(); }
    }
  });
  const f = root.querySelector("[autofocus]");
  if (f) f.focus();
}
function actionsHtml(saveLabel = "Save") {
  return `<div class="modal-acts"><button class="btn" data-act="modal-cancel">Cancel</button><button class="btn-primary" data-act="modal-save">${esc(saveLabel)}</button></div>`;
}

function modalSpace(space) {
  openModal(space ? "Rename space" : "New space",
    `<p class="hint" style="margin:0 0 8px">A space is an isolated set of variables, groups, schemas, and projects — e.g. one per microservice.</p>
     <input class="fld mono" id="m-name" placeholder="microservice1" value="${space ? esc(space.name) : ""}" autofocus />${actionsHtml(space ? "Save" : "Create")}`,
    { onMount: (r) => {
      $("[data-act=modal-cancel]", r).onclick = closeModal;
      $("[data-act=modal-save]", r).onclick = async () => {
        const name = $("#m-name", r).value.trim(); if (!name) return;
        if (space) { await run(() => api.patchSpace(space.id, { name }), "Space renamed"); closeModal(); return; }
        const c = await run(() => api.addSpace(name));
        if (c) { state.revealed.clear(); state.tab = "vars"; document.querySelectorAll(".pill").forEach((x) => x.classList.toggle("active", x.getAttribute("data-tab") === "vars")); await run(() => api.activateSpace(c.id), `Space "${name}" created`); closeModal(); }
      };
    } });
}

function modalGroup(group) {
  openModal(group ? "Rename group" : "New group",
    `<input class="fld" id="m-name" placeholder="group name" value="${group ? esc(group.name) : ""}" autofocus />${actionsHtml(group ? "Save" : "Create")}`,
    { onMount: (r) => {
      $("[data-act=modal-cancel]", r).onclick = closeModal;
      $("[data-act=modal-save]", r).onclick = async () => { const name = $("#m-name", r).value.trim(); if (!name) return; await run(() => group ? api.patchGroup(group.id, { name }) : api.addGroup(name), group ? "Group renamed" : "Group created"); closeModal(); };
    } });
}

function modalVariable(groupId) {
  openModal("New variable",
    `<label class="label">Key</label><input class="fld mono" id="m-key" placeholder="DATABASE_URL" autofocus />
     <label class="label">Value</label><input class="fld mono" id="m-val" placeholder="postgres://…" />
     <label class="label">Note / description (optional)</label><input class="fld" id="m-desc" placeholder="what this variable is for" />
     <div style="display:flex;gap:12px;align-items:center;margin-top:10px">
       <select class="fld" id="m-group" style="flex:1">${groupOptions(groupId || "")}</select>
       <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)"><input type="checkbox" id="m-secret" /> secret</label>
       <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)"><input type="checkbox" id="m-quote" /> double quotes</label>
     </div>${actionsHtml("Create")}`,
    { onMount: (r) => {
      $("[data-act=modal-cancel]", r).onclick = closeModal;
      $("[data-act=modal-save]", r).onclick = async () => {
        const key = $("#m-key", r).value.trim(); if (!key) return;
        await run(() => api.addVar({ key, value: $("#m-val", r).value, description: $("#m-desc", r).value || undefined, groupId: $("#m-group", r).value || null, secret: $("#m-secret", r).checked, quoted: $("#m-quote", r).checked }), "Variable created");
        closeModal();
      };
    } });
}

function modalSchema(schema) {
  openModal(schema ? "Rename schema" : "New schema",
    `<input class="fld mono" id="m-name" placeholder="project-x" value="${schema ? esc(schema.name) : ""}" autofocus />${actionsHtml(schema ? "Save" : "Create & compose")}`,
    { onMount: (r) => {
      $("[data-act=modal-cancel]", r).onclick = closeModal;
      $("[data-act=modal-save]", r).onclick = async () => {
        const name = $("#m-name", r).value.trim(); if (!name) return;
        if (schema) { await run(() => api.patchSchema(schema.id, { name }), "Schema renamed"); closeModal(); return; }
        const created = await run(() => api.addSchema(name), "Schema created");
        if (created) modalCompose(created.id);
      };
    } });
}

function composeCount(schema) {
  const inGroups = new Set(state.db.variables.filter((v) => v.spaceId === schema.spaceId && v.groupId && schema.groupIds.includes(v.groupId)).map((v) => v.id));
  return inGroups.size + schema.variableIds.filter((id) => !inGroups.has(id)).length;
}

function modalCompose(schemaId) {
  const schema = state.db.schemas.find((s) => s.id === schemaId);
  if (!schema) return;
  const groups = groupsSorted();
  const loose = sortBy(state.db.variables.filter((v) => v.spaceId === schema.spaceId && v.groupId === null), "key");
  const body = `<p class="hint" style="margin:0 0 12px">Pick whole groups and any loose variables. The .env resolves to <b id="cc" style="color:var(--brand)">${composeCount(schema)}</b> variable(s).</p>
    <div class="two">
      <div><div class="label">Groups</div><div class="picklist">
        ${groups.length ? groups.map((g) => `<label class="pick"><input type="checkbox" data-tg="${g.id}" ${schema.groupIds.includes(g.id) ? "checked" : ""}/><span class="k">${esc(g.name)}</span><span class="n">${varsInGroup(g.id).length}</span></label>`).join("") : `<p class="hint">No groups yet.</p>`}
      </div></div>
      <div><div class="label">Loose variables</div><div class="picklist">
        ${loose.length ? loose.map((v) => `<label class="pick"><input type="checkbox" data-tv="${v.id}" ${schema.variableIds.includes(v.id) ? "checked" : ""}/><span class="k">${esc(v.key)}</span></label>`).join("") : `<p class="hint">No ungrouped variables.</p>`}
      </div></div>
    </div>
    <div class="modal-acts"><button class="btn-primary" data-act="modal-cancel">Done</button></div>`;
  openModal(`Compose “${schema.name}”`, body, {
    wide: true,
    onClose: () => renderContent(),
    onMount: (r) => {
      const cc = $("#cc", r);
      $("[data-act=modal-cancel]", r).onclick = closeModal;
      const wire = (attr, arrName, call) => r.querySelectorAll(`[${attr}]`).forEach((cb) => cb.addEventListener("change", () => {
        const id = cb.getAttribute(attr), on = cb.checked, prev = schema[arrName].slice();
        schema[arrName] = on ? [...schema[arrName].filter((x) => x !== id), id] : schema[arrName].filter((x) => x !== id);
        cc.textContent = composeCount(schema);
        call(schema.id, id, on).catch((e) => { schema[arrName] = prev; cc.textContent = composeCount(schema); cb.checked = !on; toast("err", e.message); });
      }));
      wire("data-tg", "groupIds", api.toggleGroup);
      wire("data-tv", "variableIds", api.toggleVar);
    },
  });
}

function modalMoveSelected() {
  const ids = state.db.variables.filter((v) => v.spaceId === SPACE() && state.selected.has(v.id)).map((v) => v.id);
  if (!ids.length) return;
  openModal("Move to group",
    `<p class="hint" style="margin:0 0 8px">Move ${ids.length} selected variable${ids.length > 1 ? "s" : ""} to:</p>
     <select class="fld" id="m-group" autofocus>${groupOptions("")}</select>${actionsHtml("Move")}`,
    { onMount: (r) => {
      $("[data-act=modal-cancel]", r).onclick = closeModal;
      $("[data-act=modal-save]", r).onclick = async () => {
        const gid = $("#m-group", r).value || null;
        let moved = 0, skipped = 0, lastErr = "";
        for (const vid of ids) { try { await api.moveVar(vid, gid); moved++; } catch (e) { skipped++; lastErr = e.message; } }
        state.selected.clear();
        await reload();
        closeModal();
        if (skipped) toast("err", `Moved ${moved}, skipped ${skipped} (name clash in target group)`);
        else toast("ok", `Moved ${moved} variable${moved > 1 ? "s" : ""}`);
      };
    } });
}

function modalRequired(schema) {
  openModal(`Required keys — ${schema.name}`,
    `<p class="hint" style="margin:0 0 8px">One key per line (commas or spaces also work). The schema is checked against these — any key its groups and loose variables do not produce is shown in <b style="color:var(--danger)">red</b>.</p>
     <textarea class="fld mono" id="m-req" placeholder="DATABASE_URL&#10;JWT_SECRET&#10;PORT" style="min-height:160px">${esc((schema.required || []).join("\n"))}</textarea>${actionsHtml("Save")}`,
    { wide: true, onMount: (r) => {
      $("[data-act=modal-cancel]", r).onclick = closeModal;
      $("[data-act=modal-save]", r).onclick = async () => {
        const keys = [...new Set($("#m-req", r).value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))];
        await run(() => api.patchSchema(schema.id, { required: keys }), "Required keys saved");
        closeModal();
      };
    } });
}

function modalProject(project) {
  const schemas = schemasSorted();
  const sel = project ? project.schemaId : (schemas[0] && schemas[0].id) || "";
  const opts = schemas.map((s) => `<option value="${s.id}"${s.id === sel ? " selected" : ""}>${esc(s.name)}</option>`).join("");
  openModal(project ? "Edit project" : "New project",
    `<label class="label">Name</label><input class="fld" id="m-name" placeholder="my-app" value="${project ? esc(project.name) : ""}" autofocus />
     <label class="label">Path (directory or .env file)</label><input class="fld mono" id="m-path" placeholder="/code/my-app" value="${project ? esc(project.path) : ""}" />
     <label class="label">Schema</label><select class="fld" id="m-schema">${opts}</select>${actionsHtml(project ? "Save" : "Create")}`,
    { onMount: (r) => {
      $("[data-act=modal-cancel]", r).onclick = closeModal;
      $("[data-act=modal-save]", r).onclick = async () => {
        const name = $("#m-name", r).value.trim(), path = $("#m-path", r).value.trim(), schemaId = $("#m-schema", r).value;
        if (!name || !path || !schemaId) return;
        await run(() => project ? api.patchProject(project.id, { name, path, schemaId }) : api.addProject(name, path, schemaId), project ? "Project updated" : "Project created");
        closeModal();
      };
    } });
}

function modalPaste() {
  openModal("Paste .env",
    `<p class="hint" style="margin:0 0 8px">KEY=VALUE lines become variables in this space. New keys land in the chosen group. A <code>#</code> comment directly above a line is kept as the note for that variable.</p>
     <textarea class="fld mono" id="m-text" placeholder="DATABASE_URL=postgres://…&#10;JWT_SECRET=…"></textarea>
     <div style="display:flex;gap:14px;align-items:center;margin-top:10px;flex-wrap:wrap"><span class="label" style="margin:0">into group</span>
       <select class="fld" id="m-group" style="flex:1;min-width:140px">${groupOptions("")}</select>
       <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);white-space:nowrap"><input type="checkbox" id="m-skip" /> skip comments</label></div>${actionsHtml("Import")}`,
    { wide: true, onMount: (r) => {
      $("[data-act=modal-cancel]", r).onclick = closeModal;
      $("[data-act=modal-save]", r).onclick = async () => {
        const text = $("#m-text", r).value; if (!text.trim()) return;
        const rep = await run(() => api.importEnv(text, $("#m-group", r).value || null, $("#m-skip", r).checked));
        if (rep) { toast("ok", `Imported: ${rep.created.length} new, ${rep.updated.length} updated`); closeModal(); }
      };
    } });
}

function modalPreview(result, title) {
  openModal(title,
    `<p class="hint" style="margin:0 0 8px">${result.count} variable(s)${result.path ? ` → <code class="mono">${esc(result.path)}</code>` : ""}</p>
     <pre class="env">${esc(result.content)}</pre>
     <div class="modal-acts"><button class="btn" data-act="copy">Copy</button><button class="btn" data-act="download">Download</button><button class="btn-primary" data-act="modal-cancel">Close</button></div>`,
    { wide: true, onMount: (r) => {
      $("[data-act=modal-cancel]", r).onclick = closeModal;
      $("[data-act=copy]", r).onclick = () => navigator.clipboard.writeText(result.content).then(() => toast("ok", "Copied to clipboard"));
      $("[data-act=download]", r).onclick = () => downloadFile(".env", result.content, "text/plain");
    } });
}

// ---- delegated events on #content ----
function wireContent() {
  const c = $("#content");
  c.addEventListener("click", (e) => {
    // selection: a row's checkbox, or clicking the row body (not its inputs)
    const selEl = e.target.closest("[data-sel]");
    if (selEl) { const sid = selEl.getAttribute("data-sel"); state.selected.has(sid) ? state.selected.delete(sid) : state.selected.add(sid); renderContent(); return; }
    const vit = e.target.closest(".vitem");
    if (vit && !e.target.closest("input, select, textarea, button, a, label")) {
      const vid = vit.getAttribute("data-vid");
      if (vid) { state.selected.has(vid) ? state.selected.delete(vid) : state.selected.add(vid); renderContent(); return; }
    }
    const t = e.target.closest("[data-act]"); if (!t) return;
    const act = t.getAttribute("data-act"), id = t.getAttribute("data-id");
    if (act === "new-space") modalSpace(null);
    else if (act === "new-variable") modalVariable(null);
    else if (act === "new-group") modalGroup(null);
    else if (act === "paste") modalPaste();
    else if (act === "add-var") modalVariable(id);
    else if (act === "add-var-ungrouped") modalVariable(null);
    else if (act === "del-group") { if (confirm("Delete this group? Its variables become ungrouped.")) run(() => api.delGroup(id)); }
    else if (act === "toggle-group") { const g = state.db.groups.find((x) => x.id === id); run(() => api.patchGroup(id, { collapsed: !g.collapsed })); }
    else if (act === "clear-sel") { state.selected.clear(); renderContent(); }
    else if (act === "collapse-all" || act === "expand-all") {
      const collapsed = act === "collapse-all";
      const gs = groupsSorted().filter((g) => g.collapsed !== collapsed);
      if (!gs.length) return;
      (async () => { try { for (const g of gs) await api.patchGroup(g.id, { collapsed }); await reload(); } catch (e) { toast("err", e.message); await reload(); } })();
    }
    else if (act === "move-selected") modalMoveSelected();
    else if (act === "del-selected") {
      const ids = state.db.variables.filter((v) => v.spaceId === SPACE() && state.selected.has(v.id)).map((v) => v.id);
      if (!ids.length) return;
      if (!confirm(`Delete ${ids.length} variable${ids.length > 1 ? "s" : ""}? This cannot be undone.`)) return;
      (async () => { try { for (const vid of ids) await api.delVar(vid); state.selected.clear(); await reload(); toast("ok", `Deleted ${ids.length} variable${ids.length > 1 ? "s" : ""}`); } catch (err) { toast("err", err.message); await reload(); } })();
    }
    else if (act === "reveal") {
      if (state.revealed.has(id)) state.revealed.delete(id); else state.revealed.add(id);
      const on = state.revealed.has(id);
      const inp = c.querySelector(`input[data-change=var-value][data-id="${id}"]`);
      if (inp) inp.type = on ? "text" : "password";
      t.classList.toggle("on", on); t.title = on ? "Hide value" : "Show value"; t.innerHTML = on ? ICON.eye : ICON.eyeOff;
    } else if (act === "copy") {
      const inp = c.querySelector(`input[data-change=var-value][data-id="${id}"]`);
      const v = state.db.variables.find((x) => x.id === id);
      const raw = inp ? inp.value : (v ? v.value : "");
      const text = v && v.quoted ? quoteValue(raw) : raw;
      navigator.clipboard.writeText(text).then(() => toast("ok", v && v.quoted ? "Copied (quoted)" : "Copied"));
    } else if (act === "toggle-secret") { const v = state.db.variables.find((x) => x.id === id); run(() => api.patchVar(id, { secret: !v.secret })); }
    else if (act === "toggle-quote") { const v = state.db.variables.find((x) => x.id === id); run(() => api.patchVar(id, { quoted: !v.quoted })); }
    else if (act === "show-all") { secretIds().forEach((i) => state.revealed.add(i)); renderContent(); }
    else if (act === "hide-all") { state.revealed.clear(); renderContent(); }
    else if (act === "new-schema") modalSchema(null);
    else if (act === "compose") modalCompose(id);
    else if (act === "rename-schema") modalSchema(state.db.schemas.find((s) => s.id === id));
    else if (act === "preview-schema") run(() => api.previewSchema(id)).then((res) => res && modalPreview(res, "schema .env"));
    else if (act === "del-schema") { if (confirm("Delete this schema?")) run(() => api.delSchema(id)); }
    else if (act === "edit-required") modalRequired(state.db.schemas.find((s) => s.id === id));
    else if (act === "new-project") modalProject(null);
    else if (act === "edit-project") modalProject(state.db.projects.find((p) => p.id === id));
    else if (act === "preview-project") run(() => api.previewProject(id)).then((res) => res && modalPreview(res, "project → .env"));
    else if (act === "gen-project") run(() => api.generateProject(id)).then((res) => res && toast("ok", `Generated ${res.count} vars → ${res.path}`));
    else if (act === "del-project") { if (confirm("Delete this project?")) run(() => api.delProject(id)); }
  });
  c.addEventListener("change", (e) => {
    const t = e.target.closest("[data-change]"); if (!t) return;
    const kind = t.getAttribute("data-change"), id = t.getAttribute("data-id");
    if (kind === "group-name") run(() => api.patchGroup(id, { name: t.value }));
    else if (kind === "var-key") run(() => api.patchVar(id, { newKey: t.value }));
    else if (kind === "var-value") run(() => api.patchVar(id, { value: t.value }));
    else if (kind === "var-desc") run(() => api.patchVar(id, { description: t.value }));
    else if (kind === "var-group") run(() => api.moveVar(id, t.value || null));
  });
}

// ---- shell ----
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#theme-toggle").textContent = theme === "dark" ? "☀" : "☾";
  try { localStorage.setItem("defenv-theme", theme); } catch (_) {}
}
function initShell() {
  document.querySelectorAll(".pill[data-tab]").forEach((p) => p.addEventListener("click", () => {
    state.tab = p.getAttribute("data-tab");
    document.querySelectorAll(".pill").forEach((x) => x.classList.toggle("active", x === p));
    $("#searchwrap").style.visibility = state.tab === "vars" ? "visible" : "hidden";
    renderContent();
  }));
  $("#search").addEventListener("input", (e) => { state.query = e.target.value; $("#search-clear").hidden = !e.target.value; renderContent(); });
  $("#search-clear").addEventListener("click", () => { const i = $("#search"); i.value = ""; state.query = ""; $("#search-clear").hidden = true; renderContent(); i.focus(); });
  $("#theme-toggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  $("#space-select").addEventListener("change", (e) => { state.revealed.clear(); state.selected.clear(); run(() => api.activateSpace(e.target.value)); });
  $("#space-new").addEventListener("click", () => modalSpace(null));
  $("#space-rename").addEventListener("click", () => { const ctx = state.db.spaces.find((x) => x.id === SPACE()); if (ctx) modalSpace(ctx); });
  $("#space-delete").addEventListener("click", () => { const ctx = state.db.spaces.find((x) => x.id === SPACE()); if (ctx && confirm(`Delete space "${ctx.name}" and everything in it?`)) run(() => api.delSpace(ctx.id)); });
  $("#space-export").addEventListener("click", async () => {
    try {
      const data = await api.exportSpace(SPACE());
      const sp = state.db.spaces.find((x) => x.id === SPACE());
      downloadFile(`${(sp ? sp.name : "space").replace(/[^a-z0-9_.-]+/gi, "-")}.defenv.json`, JSON.stringify(data, null, 2), "application/json");
      toast("ok", "Space exported");
    } catch (e) { toast("err", e.message); }
  });
  $("#space-import").addEventListener("click", () => $("#space-import-file").click());
  $("#space-import-file").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = "";
    if (!file) return;
    let payload;
    try { payload = JSON.parse(await file.text()); } catch { toast("err", "That file is not valid JSON."); return; }
    const sp = await run(() => api.importSpace(payload));
    if (sp) { state.revealed.clear(); state.tab = "vars"; document.querySelectorAll(".pill").forEach((x) => x.classList.toggle("active", x.getAttribute("data-tab") === "vars")); await run(() => api.activateSpace(sp.id), `Imported space "${sp.name}"`); }
  });
}

(async function boot() {
  let theme = "light";
  try { theme = localStorage.getItem("defenv-theme") || "light"; } catch (_) {}
  setTheme(theme);
  initShell();
  wireContent();
  await reload();
})();
