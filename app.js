"use strict";
const $app = document.getElementById("app");
let ME = null, DOC = null, TAB = "home", Q = "", EDIT = false, PROG = null;

// ---------- helpers (all text goes through textContent; nothing is parsed as HTML) ----------
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
function toast(m) { const t = document.getElementById("toast"); t.textContent = m; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2600); }
/* Public read-only build: content ships as content.json, no accounts; onboarding progress is kept in this browser only. */
async function api(method, path, body) {
  if (path === "/api/me") return { user: "guest", role: "viewer" };
  if (path === "/api/content" && method === "GET") {
    const r = await fetch("content.json");
    if (!r.ok) throw new Error("Could not load content.json");
    return r.json();
  }
  if (path === "/api/progress") {
    if (method === "PUT") { localStorage.setItem("pulse-a-progress", JSON.stringify(body.done || [])); return body; }
    return { done: JSON.parse(localStorage.getItem("pulse-a-progress") || "[]") };
  }
  throw new Error("This public copy is read-only");
}
const canEdit = () => ME && (ME.role === "admin" || ME.role === "editor");
async function save(msg) {
  try { DOC = await api("PUT", "/api/content", DOC); toast(msg || "Saved"); }
  catch (e) { toast(e.message); DOC = await api("GET", "/api/content"); }
  render();
}
function uid(p) { return p + Math.random().toString(36).slice(2, 8); }
const safeUrl = u => /^https?:\/\//.test(u) ? u : null;

function form(title, fields, init, onOk) {
  const dlg = h("dialog");
  const inputs = {};
  const f = h("form", { method: "dialog" }, h("h3", {}, title));
  for (const [key, label, kind, opts] of fields) {
    let el;
    if (kind === "area") el = h("textarea", { rows: 3 });
    else if (kind === "select") el = h("select", {}, opts.map(o => h("option", { value: o }, o)));
    else el = h("input", { type: kind || "text" });
    el.value = init[key] ?? "";
    inputs[key] = el;
    f.append(h("label", {}, label), el);
  }
  const err = h("div", { class: "err" });
  f.append(err, h("div", { class: "acts end" },
    h("button", { class: "btn ghost", type: "button", onclick: () => dlg.close() }, "Cancel"),
    h("button", { class: "btn", type: "submit" }, "Save")));
  f.addEventListener("submit", ev => {
    ev.preventDefault();
    const out = {}; for (const k in inputs) out[k] = inputs[k].value.trim();
    try { onOk(out); dlg.close(); } catch (e) { err.textContent = e.message; }
  });
  dlg.append(f); document.body.append(dlg); dlg.addEventListener("close", () => dlg.remove()); dlg.showModal();
}
function needUrl(u) { if (u && !safeUrl(u)) throw new Error("URL must start with http:// or https://"); }

// ---------- views ----------
function docBadge(w) {
  if (w < 130) return h("span", { class: "badge b-thin", title: "Page word count at last scan" }, `thin docs · ~${w} words`);
  if (w < 250) return h("span", { class: "badge b-ok" }, `short docs · ~${w} words`);
  return h("span", { class: "badge b-good" }, `~${w} words`);
}
function resolveRelated(name) {
  for (const g of DOC.appGroups) for (const a of g.apps) if (a.name === name) return { app: a };
  for (const s of DOC.docSections) for (const i of s.items) if (i.title === name) return { link: i };
  return null;
}
function appCard(g, a) {
  const chips = (a.related || []).map(r => {
    const t = resolveRelated(r);
    if (t && t.app) return h("a", { class: "chip", href: "#", onclick: ev => { ev.preventDefault(); Q = ""; jump(t.app.name); } }, r);
    if (t && t.link && safeUrl(t.link.url)) return h("a", { class: "chip", href: t.link.url, target: "_blank", rel: "noopener" }, r + " ↗");
    return h("span", { class: "chip" }, r);
  });
  return h("div", { class: "card", "data-app": a.name },
    h("h3", {}, a.name), docBadge(a.words || 0), h("p", {}, a.desc), a.codeNote ? h("p", { class: "note" }, a.codeNote) : null,
    chips.length ? h("div", { class: "chips" }, chips) : null,
    h("div", { class: "acts" },
      safeUrl(a.url) ? h("a", { class: "btn sm", href: a.url, target: "_blank", rel: "noopener" }, "Open docs page") : null,
      safeUrl(a.code) ? h("a", { class: "btn sm ghost", href: a.code, target: "_blank", rel: "noopener", title: a.codeNote || "Source on GitHub" }, "Code ↗") : null,
      EDIT ? [h("button", { class: "btn sm ghost", onclick: () => editApp(g, a) }, "Edit"), h("button", { class: "btn sm danger", onclick: () => { if (confirm("Delete " + a.name + "?")) { g.apps = g.apps.filter(x => x !== a); save("Deleted"); } } }, "Delete")] : null));
}
function jump(name) {
  render();
  const el = [...document.querySelectorAll("[data-app]")].find(e => e.dataset.app === name);
  if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("hl"); setTimeout(() => el.classList.remove("hl"), 2200); }
}
function editApp(g, a) {
  const isNew = !a;
  a = a || { name: "", url: "", desc: "", words: 0, related: [] };
  form(isNew ? "Add app" : "Edit " + a.name, [["name", "Name"], ["url", "Docs URL (https://…)", "url"], ["code", "Code URL (GitHub, optional)", "url"], ["codeNote", "Code status note (optional)"], ["desc", "What it does", "area"], ["related", "Related items (comma-separated names of other apps or doc pages)"], ["words", "Docs page word count (optional)"]],
    { ...a, related: (a.related || []).join(", "), words: a.words || 0 }, v => {
      if (!v.name) throw new Error("Name is required"); needUrl(v.url);
      const nw = parseInt(v.words || "0", 10); if (isNaN(nw)) throw new Error("Word count must be a number");
      needUrl(v.code);
      const next = { name: v.name, url: v.url, code: v.code, codeNote: v.codeNote, desc: v.desc, words: nw, related: v.related.split(",").map(s => s.trim()).filter(Boolean) };
      if (isNew) g.apps.push(next); else Object.assign(a, next);
      save("Saved");
    });
}
function viewApps() {
  const q = Q.toLowerCase();
  const out = [];
  for (const g of DOC.appGroups) {
    const apps = g.apps.filter(a => !q || (a.name + " " + a.desc + " " + (a.related || []).join(" ")).toLowerCase().includes(q));
    if (!apps.length && !EDIT) continue;
    out.push(h("section", { class: "grp" }, h("h2", {}, g.name, ` (${apps.length})`), h("p", { class: "d" }, g.desc),
      EDIT ? h("button", { class: "btn sm", onclick: () => editApp(g, null) }, "+ Add app to this group") : null,
      h("div", { class: "cards" }, apps.map(a => appCard(g, a)))));
  }
  return [h("div", { class: "tools" },
    h("input", { type: "text", id: "q", placeholder: "Filter apps by name, description, related…", value: Q, oninput: ev => { Q = ev.target.value; const p = ev.target.selectionStart; render(); const n = document.getElementById("q"); n.focus(); n.setSelectionRange(p, p); } })),
    out.length ? out : h("p", {}, "No apps match.")];
}
function editLink(sec, it) {
  const isNew = !it;
  it = it || { title: "", url: "", note: "" };
  form(isNew ? "Add link" : "Edit link", [["title", "Title"], ["url", "URL (https://…, leave empty if none)", "url"], ["note", "Note", "area"]], it, v => {
    if (!v.title) throw new Error("Title is required"); needUrl(v.url);
    if (isNew) sec.items.push(v); else Object.assign(it, v);
    save("Saved");
  });
}
function viewDocs() {
  const q = Q.toLowerCase();
  const out = [];
  for (const s of DOC.docSections) {
    const items = s.items.filter(i => !q || (i.title + " " + i.note).toLowerCase().includes(q));
    if (!items.length && !EDIT) continue;
    out.push(h("section", { class: "grp" }, h("h2", {}, s.name), EDIT ? h("button", { class: "btn sm", onclick: () => editLink(s, null) }, "+ Add link") : null,
      h("ul", { class: "links" }, items.map(i => h("li", {},
        h("div", {}, safeUrl(i.url) ? h("a", { class: "t", href: i.url, target: "_blank", rel: "noopener" }, i.title + " ↗") : h("span", { class: "t" }, i.title), i.note ? h("div", { class: "note" }, i.note) : null),
        EDIT ? h("div", { class: "acts" }, h("button", { class: "btn sm ghost", onclick: () => editLink(s, i) }, "Edit"), h("button", { class: "btn sm danger", onclick: () => { if (confirm("Delete this link?")) { s.items = s.items.filter(x => x !== i); save("Deleted"); } } }, "×")) : null)))));
  }
  return [h("div", { class: "tools" }, h("input", { type: "text", id: "q", placeholder: "Filter documentation…", value: Q, oninput: ev => { Q = ev.target.value; const p = ev.target.selectionStart; render(); const n = document.getElementById("q"); n.focus(); n.setSelectionRange(p, p); } }),
    EDIT ? h("button", { class: "btn ghost", onclick: () => form("Add section", [["name", "Section name"]], {}, v => { if (!v.name) throw new Error("Name is required"); DOC.docSections.push({ id: uid("s"), name: v.name, items: [] }); save("Section added"); }) }, "+ Add section") : null), out];
}
function editCheck(c) {
  const isNew = !c;
  const groups = [...new Set(DOC.checklist.map(x => x.group))];
  c = c || { group: groups[0] || "General", text: "", note: "", owner: "", due: "", source: "" };
  form(isNew ? "Add checklist item" : "Edit item", [["group", "Group (type a new name to create one)"], ["text", "Task"], ["note", "Details", "area"], ["owner", "Owner"], ["due", "Due date", "date"], ["source", "Source"]], c, v => {
    if (!v.text || !v.group) throw new Error("Group and task are required");
    if (isNew) DOC.checklist.push({ id: uid("c"), done: false, ...v }); else Object.assign(c, v);
    save("Saved");
  });
}
function viewChecklist() {
  const groups = [...new Set(DOC.checklist.map(c => c.group))];
  const total = DOC.checklist.length, done = DOC.checklist.filter(c => c.done).length;
  const out = [h("div", { class: "tools" }, h("strong", {}, `${done} of ${total} done`), EDIT ? h("button", { class: "btn", onclick: () => editCheck(null) }, "+ Add item") : null),
    h("div", { class: "prog" }, (() => { const i = h("i"); i.style.width = (total ? 100 * done / total : 0) + "%"; return i; })())];
  for (const g of groups) {
    const items = DOC.checklist.filter(c => c.group === g);
    const d = items.filter(c => c.done).length;
    out.push(h("section", { class: "grp" }, h("h2", {}, g, ` (${d}/${items.length})`),
      h("div", { class: "mt8" }, items.map(c => h("div", { class: "chk" + (c.done ? " done" : "") },
        h("input", { type: "checkbox", checked: c.done, disabled: !canEdit(), onchange: ev => { c.done = ev.target.checked; save(); } }),
        h("div", { class: "grow" }, h("div", { class: "tx" }, c.text), c.note ? h("div", { class: "note" }, c.note) : null,
          h("div", { class: "meta" }, [c.owner && "Owner: " + c.owner, c.due && "Due: " + c.due, c.source && "Source: " + c.source].filter(Boolean).join("  ·  "))),
        EDIT ? h("div", { class: "acts" }, h("button", { class: "btn sm ghost", onclick: () => editCheck(c) }, "Edit"), h("button", { class: "btn sm danger", onclick: () => { if (confirm("Delete this item?")) { DOC.checklist = DOC.checklist.filter(x => x !== c); save("Deleted"); } } }, "×")) : null)))));
  }
  return out;
}
async function viewAdmin() {
  const box = h("div", {});
  const users = await api("GET", "/api/users");
  const draw = list => {
    box.replaceChildren(
      h("h2", {}, "Accounts"),
      h("p", { class: "note" }, "Admin = everything including this page. Editor = change content and tick the checklist. Viewer = read only. Role changes take effect immediately and sign that person out."),
      h("table", {}, h("tr", {}, h("th", {}, "User"), h("th", {}, "Role"), h("th", {}, "")),
        list.map(u => h("tr", {}, h("td", {}, u.name),
          h("td", {}, h("select", { onchange: async ev => { try { draw(await api("PUT", "/api/users", { username: u.name, role: ev.target.value })); toast("Role updated"); } catch (e) { toast(e.message); draw(await api("GET", "/api/users")); } } },
            ["admin", "editor", "viewer"].map(r => h("option", { value: r, selected: r === u.role }, r)))),
          h("td", {}, h("button", { class: "btn sm danger", onclick: async () => { if (!confirm("Remove " + u.name + "?")) return; try { draw(await api("DELETE", "/api/users", { username: u.name })); } catch (e) { toast(e.message); } } }, "Remove"))))),
      h("p", {}, h("button", { class: "btn", onclick: () => form("Add or reset a user", [["username", "Username (a-z, 0-9, . _ -)"], ["password", "Password (10+ characters)", "password"], ["role", "Role", "select", ["viewer", "editor", "admin"]]], { role: "viewer" }, async v => { try { draw(await api("POST", "/api/users", v)); toast("User saved"); } catch (e) { toast(e.message); } }) }, "+ Add user / reset password")),
      h("h2", {}, "Your password"),
      h("p", {}, h("button", { class: "btn ghost", onclick: () => form("Change your password", [["old", "Current password", "password"], ["new", "New password (10+ characters)", "password"]], {}, async v => { try { await api("POST", "/api/password", v); toast("Password changed"); } catch (e) { toast(e.message); } }) }, "Change password")),
      h("h2", {}, "About this hub"),
      h("p", { class: "note" }, DOC.meta.note || ""), h("p", { class: "note" }, `Version ${DOC.version}` + (DOC.meta.lastEdited ? ` · last edited ${DOC.meta.lastEdited} by ${DOC.meta.lastEditedBy}` : "") + ". The last 50 versions are kept on the server in data/history/."));
  };
  draw(users);
  return box;
}

const KIND = { read: ["Read", "k-read"], do: ["Do", "k-do"], ask: ["Ask", "k-ask"] };
async function setProg(id, on) {
  on ? PROG.add(id) : PROG.delete(id);
  try { await api("PUT", "/api/progress", { done: [...PROG] }); } catch (e) { toast(e.message); }
  render();
}
function editStep(tr, st) {
  const isNew = !st;
  st = st || { title: "", url: "", kind: "read", minutes: 10, why: "" };
  form(isNew ? "Add step" : "Edit step", [["title", "Title"], ["url", "URL (optional)", "url"], ["kind", "Type", "select", ["read", "do", "ask"]], ["minutes", "Estimated minutes"], ["why", "Why it matters", "area"]], st, v => {
    if (!v.title) throw new Error("Title is required"); needUrl(v.url);
    const m = parseInt(v.minutes || "0", 10); if (isNaN(m) || m < 0) throw new Error("Minutes must be a number");
    const next = { title: v.title, url: v.url, kind: v.kind, minutes: m, why: v.why };
    if (isNew) tr.steps.push({ id: uid("o"), ...next }); else Object.assign(st, next);
    save("Saved");
  });
}
function editTerm(list, it, label) {
  const isNew = !it; it = it || { term: "", text: "" };
  form(isNew ? "Add " + label : "Edit " + label, [["term", "Name"], ["text", "Description", "area"]], it, v => {
    if (!v.term) throw new Error("Name is required");
    if (isNew) list.push(v); else Object.assign(it, v);
    save("Saved");
  });
}
function termTable(key, title, label) {
  const list = DOC[key] = DOC[key] || [];
  return h("section", { class: "grp" }, h("h2", {}, title), EDIT ? h("button", { class: "btn sm", onclick: () => editTerm(list, null, label) }, "+ Add") : null,
    h("table", { class: "mt8" }, list.map(it => h("tr", {}, h("th", {}, it.term), h("td", {}, it.text),
      EDIT ? h("td", {}, h("button", { class: "btn sm ghost", onclick: () => editTerm(list, it, label) }, "Edit"), " ", h("button", { class: "btn sm danger", onclick: () => { if (confirm("Delete?")) { const i = list.indexOf(it); list.splice(i, 1); save("Deleted"); } } }, "×")) : null))));
}
function viewOnboarding() {
  const ob = DOC.onboarding || { welcome: "", tracks: [] };
  const all = ob.tracks.flatMap(t => t.steps);
  const done = all.filter(x => PROG.has(x.id)).length;
  const left = all.filter(x => !PROG.has(x.id)).reduce((a, x) => a + (x.minutes || 0), 0);
  const out = [h("p", {}, ob.welcome),
    h("div", { class: "tools" }, h("strong", {}, `Your progress: ${done} of ${all.length} steps`), h("span", { class: "note" }, `about ${Math.round(left / 6) / 10} hours left`)),
    h("div", { class: "prog" }, (() => { const i = h("i"); i.style.width = (all.length ? 100 * done / all.length : 0) + "%"; return i; })())];
  if ((DOC.headsUp || []).length) out.push(h("div", { class: "admon" }, h("span", { class: "admon-label" }, "Important"), h("p", { class: "admon-title" }, "Known gaps in the docs"), h("ul", {}, DOC.headsUp.map(x => h("li", {}, x)))));
  for (const tr of ob.tracks) {
    const d = tr.steps.filter(x => PROG.has(x.id)).length;
    out.push(h("section", { class: "grp" }, h("h2", {}, tr.name, ` (${d}/${tr.steps.length})`), h("p", { class: "d" }, tr.desc),
      EDIT ? h("button", { class: "btn sm", onclick: () => editStep(tr, null) }, "+ Add step") : null,
      h("div", { class: "mt8" }, tr.steps.map(st => h("div", { class: "chk" + (PROG.has(st.id) ? " done" : "") },
        h("input", { type: "checkbox", checked: PROG.has(st.id), onchange: ev => setProg(st.id, ev.target.checked) }),
        h("div", { class: "grow" },
          h("div", { class: "tx" }, h("span", { class: "kind " + KIND[st.kind][1] }, KIND[st.kind][0]), " ", safeUrl(st.url) ? h("a", { href: st.url, target: "_blank", rel: "noopener" }, st.title + " ↗") : st.title),
          st.why ? h("div", { class: "note" }, st.why) : null, st.minutes ? h("div", { class: "meta" }, `~${st.minutes} min`) : null),
        EDIT ? h("div", { class: "acts" }, h("button", { class: "btn sm ghost", onclick: () => editStep(tr, st) }, "Edit"), h("button", { class: "btn sm danger", onclick: () => { if (confirm("Delete this step?")) { tr.steps = tr.steps.filter(x => x !== st); save("Deleted"); } } }, "×")) : null)))));
  }
  out.push(termTable("terms", "Key terms", "term"), termTable("departments", "Departments", "department"));
  return out;
}
const NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
let SEL = null;
const ST = { none: "No code found", branch: "Code on a branch", external: "Private repo", unknown: "Unknown" };
function changesFor(name) { return (DOC.changes || []).filter(c => (c.impacts || []).includes(name)); }
function viewArch() {
  const A = DOC.architecture; if (!A) return h("p", {}, "No architecture data yet.");
  const W = 205, H = 28, GX = 55, GY = 8, TOP = 34;
  const cols = {}; A.nodes.forEach(n => (cols[n.col] = cols[n.col] || []).push(n));
  const colNames = ["Hardware & external", "OBC apps", "NASA services", "Payload Controller apps", "Simulators"];
  const pos = {};
  Object.keys(cols).forEach(c => cols[c].forEach((n, i) => { pos[n.id] = { x: 10 + c * (W + GX), y: TOP + i * (H + GY) }; }));
  const maxN = Math.max(...Object.values(cols).map(l => l.length));
  const width = 20 + 5 * (W + GX), height = TOP + maxN * (H + GY) + 10;
  const nb = id => A.edges.filter(e => e.a === id || e.b === id);
  const lit = SEL ? new Set([SEL, ...nb(SEL).flatMap(e => [e.a, e.b])]) : null;
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, width, height, class: "arch" });
  colNames.forEach((t, c) => root.append(svg("text", { x: 10 + c * (W + GX), y: 20, class: "colname" }, t)));
  const byId = Object.fromEntries(A.nodes.map(n => [n.id, n]));
  const edgeEl = e => {
    const a = pos[e.a], b = pos[e.b], na = byId[e.a], nb2 = byId[e.b];
    let x1, x2, d;
    const y1 = a.y + H / 2, y2 = b.y + H / 2;
    if (na.col < nb2.col) { x1 = a.x + W; x2 = b.x; const m = (x1 + x2) / 2; d = `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`; }
    else if (na.col > nb2.col) { x1 = a.x; x2 = b.x + W; const m = (x1 + x2) / 2; d = `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`; }
    else { x1 = a.x + W; x2 = b.x + W; const o = 40 + Math.min(40, Math.abs(y2 - y1) / 4); d = `M${x1},${y1} C${x1 + o},${y1} ${x2 + o},${y2} ${x2},${y2}`; }
    const on = !SEL || e.a === SEL || e.b === SEL;
    return svg("path", { d, class: "edge " + e.kind + (on ? (SEL ? " on" : "") : " off") });
  };
  A.edges.filter(e => e.kind === "docs").forEach(e => root.append(edgeEl(e)));
  A.edges.filter(e => e.kind === "code").forEach(e => root.append(edgeEl(e)));
  A.nodes.forEach(n => {
    const p = pos[n.id];
    const g = svg("g", { class: "node st-" + (n.hw ? "hw" : n.status) + (SEL === n.id ? " sel" : "") + (lit && !lit.has(n.id) ? " dim" : ""), tabindex: "0", role: "button" });
    g.append(svg("rect", { x: p.x, y: p.y, width: W, height: H, rx: 4 }), svg("text", { x: p.x + 8, y: p.y + 18 }, n.name.length > 30 ? n.name.slice(0, 29) + "…" : n.name));
    g.addEventListener("click", () => { SEL = SEL === n.id ? null : n.id; render(); });
    g.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); SEL = SEL === n.id ? null : n.id; render(); } });
    root.append(g);
  });
  const legend = h("div", { class: "legend" }, h("span", { class: "lg st-none" }, "No code found"), h("span", { class: "lg st-branch" }, "Code on a branch"), h("span", { class: "lg st-external" }, "Private repo"), h("span", { class: "lg st-unknown" }, "Unknown"), h("span", { class: "lg st-hw" }, "Hardware"),
    h("span", { class: "lg line-docs" }, "documented link"), h("span", { class: "lg line-code" }, "verified in code"));
  const side = SEL ? sidePanel(byId[SEL], A, byId) : h("div", { class: "side" }, h("p", { class: "note" }, A.note), h("p", { class: "note" }, `Data as of ${A.asOf}. ${A.nodes.filter(n => !n.hw && n.status === "none").length} of ${A.nodes.filter(n => !n.hw).length} apps have no code in the repos checked.`));
  return [legend, h("div", { class: "archwrap" }, h("div", { class: "archscroll" }, root), side)];
}
function sidePanel(n, A, byId) {
  const es = A.edges.filter(e => e.a === n.id || e.b === n.id);
  const li = (e) => { const other = byId[e.a === n.id ? e.b : e.a]; return h("li", {}, h("a", { href: "#", onclick: ev => { ev.preventDefault(); SEL = other.id; render(); } }, (e.a === n.id ? "→ " : "← ") + other.name), " ", h("span", { class: "note" }, `(${e.kind === "code" ? "code" : "docs"}) ${e.why}`)); };
  const ch = changesFor(n.name);
  return h("div", { class: "side" }, h("h3", {}, n.name), n.hw ? h("p", { class: "note" }, "Hardware / external") : [
    h("p", {}, h("span", { class: "lg st-" + n.status }, ST[n.status])), h("p", { class: "note" }, n.codeNote),
    h("div", { class: "acts" }, safeUrl(n.docs) ? h("a", { class: "btn sm", href: n.docs, target: "_blank", rel: "noopener" }, "Docs page") : null, safeUrl(n.code) ? h("a", { class: "btn sm ghost", href: n.code, target: "_blank", rel: "noopener" }, "Code ↗") : null),
    (n.inputs || []).length ? [h("h4", {}, "Documented inputs"), h("ul", {}, n.inputs.map(x => h("li", {}, x)))] : null,
    (n.outputs || []).length ? [h("h4", {}, "Documented outputs"), h("ul", {}, n.outputs.map(x => h("li", {}, x)))] : null],
    h("h4", {}, `Connections (${es.length})`), h("ul", {}, es.map(li)),
    ch.length ? [h("h4", {}, "Changes that affect this"), h("ul", {}, ch.map(c => h("li", {}, h("a", { href: "#", onclick: ev => { ev.preventDefault(); TAB = "changes"; Q = ""; render(); } }, c.id), " ", c.title)))] : null,
    h("button", { class: "btn sm ghost", onclick: () => { SEL = null; render(); } }, "Clear selection"));
}
function editChange(c) {
  const isNew = !c;
  c = c || { title: "", severity: "medium", area: "", detail: "", impacts: [], action: "", source: "", status: "open" };
  form(isNew ? "Add change / finding" : "Edit " + c.id, [["title", "Title"], ["severity", "Severity", "select", ["high", "medium", "low", "info"]], ["status", "Status", "select", ["open", "confirmed", "resolved"]], ["area", "Area"], ["detail", "What changed and why it matters", "area"], ["impacts", "Affected apps (comma-separated, exact app names)"], ["action", "What to do", "area"], ["source", "Source"]], { ...c, impacts: (c.impacts || []).join(", ") }, v => {
    if (!v.title) throw new Error("Title is required");
    const next = { ...v, impacts: v.impacts.split(",").map(x => x.trim()).filter(Boolean) };
    if (isNew) { const n = Math.max(0, ...DOC.changes.map(x => parseInt((x.id.match(/\d+/) || ["0"])[0], 10))) + 1; DOC.changes.unshift({ id: "CH-" + String(n).padStart(3, "0"), date: new Date().toISOString().slice(0, 10), ...next }); } else Object.assign(c, next);
    save("Saved");
  });
}
function viewChanges() {
  const list = (DOC.changes = DOC.changes || []);
  const q = Q.toLowerCase();
  const shown = list.filter(c => !q || (c.title + c.detail + c.area + (c.impacts || []).join(" ")).toLowerCase().includes(q));
  const open = list.filter(c => c.status === "open").length;
  return [h("div", { class: "tools" }, h("input", { type: "text", id: "q", placeholder: "Filter changes…", value: Q, oninput: ev => { Q = ev.target.value; const p = ev.target.selectionStart; render(); const n = document.getElementById("q"); n.focus(); n.setSelectionRange(p, p); } }),
    h("strong", {}, `${open} open of ${list.length}`), EDIT ? h("button", { class: "btn", onclick: () => editChange(null) }, "+ Add finding") : null),
    h("p", { class: "note" }, "Each entry says what changed, which apps and docs it affects, and what to do. Add a row whenever a branch merges, an interface changes, or a design decision lands."),
    shown.map(c => h("div", { class: "card chg sev-" + c.severity }, h("h3", {}, h("span", { class: "sev" }, c.severity), " ", c.id + ": " + c.title),
      h("div", { class: "meta" }, `${c.date} · ${c.area} · status: ${c.status} · source: ${c.source}`), h("p", {}, c.detail),
      (c.impacts || []).length ? h("div", { class: "chips" }, h("span", { class: "note" }, "Affects:"), c.impacts.map(x => h("a", { class: "chip", href: "#", onclick: ev => { ev.preventDefault(); const n = DOC.architecture && DOC.architecture.nodes.find(m => m.name === x); if (n) { SEL = n.id; TAB = "arch"; Q = ""; render(); } } }, x))) : null,
      c.action ? h("p", {}, h("strong", {}, "Do: "), c.action) : null,
      EDIT ? h("div", { class: "acts" }, h("button", { class: "btn sm ghost", onclick: () => editChange(c) }, "Edit"), h("button", { class: "btn sm danger", onclick: () => { if (confirm("Delete " + c.id + "?")) { DOC.changes = list.filter(x => x !== c); save("Deleted"); } } }, "×")) : null))];
}
// ---------- overview, diagrams, search (added 2026-10-12) ----------
let GQ = "";
const CDR_DATE = new Date("2026-11-17T23:59:00");
const daysToCdr = () => Math.max(0, Math.ceil((CDR_DATE - new Date()) / 864e5));
function go(t) { TAB = t; Q = ""; try { history.replaceState(null, "", "#" + t); } catch (e) { /* ignore */ } render(); }
const FONT = "Roboto, Arial, sans-serif";
const SCOL = { none: ["#fdecea", "#b3261e"], branch: ["#fff4d6", "#b26a00"], external: ["#e8eaf6", "#3949ab"], unknown: ["#f0f0f0", "#777777"], hw: ["#e8f5e9", "#2e7d32"] };
const stext = (x, y, t, o) => { o = o || {}; return svg("text", { x, y, "font-family": FONT, "font-size": o.size || 12, "font-weight": o.bold ? 600 : 400, fill: o.fill || "#1a1a1a", "text-anchor": o.anchor || "start" }, t); };
const sbox = (x, y, w, hh, fill, stroke, rx) => svg("rect", { x, y, width: w, height: hh, rx: rx == null ? 4 : rx, fill, stroke, "stroke-width": 1.5 });
const sline = (x1, y1, x2, y2, o) => { o = o || {}; const a = { x1, y1, x2, y2, stroke: o.stroke || "#555", "stroke-width": o.w || 1.5 }; if (o.dash) a["stroke-dasharray"] = o.dash; if (o.arrow) a["marker-end"] = `url(#${o.arrow})`; return svg("line", a); };
const marker = id => svg("defs", {}, svg("marker", { id, viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto" }, svg("path", { d: "M0,0 L10,5 L0,10 z", fill: "#555" })));
const svgRoot = (w, hh, title) => svg("svg", { viewBox: `0 0 ${w} ${hh}`, width: w, height: hh, role: "img", "aria-label": title }, svg("title", {}, title), svg("rect", { x: 0, y: 0, width: w, height: hh, fill: "#ffffff" }));
function nodesOf(col) { return ((DOC.architecture || {}).nodes || []).filter(n => n.col === col); }
function nodeCol(n) { return SCOL[n.hw ? "hw" : (n.status || "unknown")] || SCOL.unknown; }

function groupBox(root, x, y, w, title, sub, nodes) {
  const row = 24, head = 44, hh = head + nodes.length * row + 10;
  root.append(sbox(x, y, w, hh, "#fafafa", "#8a8a8a", 6), stext(x + 12, y + 20, title, { bold: true, size: 14 }), stext(x + 12, y + 36, sub, { size: 11, fill: "#5d5d5d" }));
  nodes.forEach((n, i) => { const [f, s] = nodeCol(n); const ny = y + head + i * row; root.append(sbox(x + 10, ny, w - 20, 20, f, s, 3), stext(x + 18, ny + 14, n.name.length > 34 ? n.name.slice(0, 33) + "…" : n.name, { size: 11.5 })); });
  return hh;
}
function diagSystem() {
  const W = 1010, root = svgRoot(W, 10, "System overview");
  const hw = nodesOf(0), obc = nodesOf(1), nasa = nodesOf(2), pc = nodesOf(3), sim = nodesOf(4);
  const h1 = groupBox(root, 20, 20, 260, "Hardware & external", "ground station, radio, buses, payload", hw);
  const h2 = groupBox(root, 375, 20, 260, "OBC cFS instance (cpu1)", "on-board computer apps", obc);
  const h3 = groupBox(root, 375, 20 + h2 + 14, 260, "NASA services", "cFS apps from NASA", nasa);
  const h4 = groupBox(root, 730, 20, 260, "Payload Controller (cpu2)", "documented; no code found", pc);
  const h5 = sim.length ? groupBox(root, 730, 20 + h4 + 14, 260, "Simulators", "test tools on the radio branch", sim) : 0;
  const H = Math.max(20 + h1, 20 + h2 + 14 + h3, 20 + h4 + 14 + h5) + 54;
  root.setAttribute("viewBox", `0 0 ${W} ${H}`); root.setAttribute("height", H); root.firstChild.nextSibling.setAttribute("height", H);
  root.insertBefore(marker("sysA"), root.children[2]);
  root.append(sline(280, 70, 375, 70, { arrow: "sysA", dash: "6 4" }), stext(327, 62, "CSP / CAN", { anchor: "middle", size: 11, fill: "#5d5d5d" }),
    sline(635, 70, 730, 70, { arrow: "sysA", dash: "6 4" }), stext(682, 62, "SBN (documented)", { anchor: "middle", size: 11, fill: "#5d5d5d" }));
  const ly = H - 26; let lx = 20;
  [["none", "No code found"], ["branch", "Code on a branch"], ["external", "Private repo"], ["hw", "Hardware"]].forEach(([k, t]) => { root.append(sbox(lx, ly, 16, 14, SCOL[k][0], SCOL[k][1], 2), stext(lx + 22, ly + 12, t, { size: 11.5 })); lx += 150; });
  root.append(stext(lx + 10, ly + 12, "Dashed arrows are documented links, not verified in code.", { size: 11, fill: "#5d5d5d" }));
  const txt = [...hw, ...obc, ...nasa, ...pc, ...sim].map(n => `${n.name}: ${n.hw ? "hardware" : (ST[n.status] || n.status)}`);
  return { svg: root, text: txt };
}
function diagStack() {
  const rows = [["PULSE-A apps (bus_comms, radio_murgas_app, adcs_app, …) and NASA apps (cf, …)", "branch"], ["cFE core services: Executive (ES), Events (EVS), Software Bus (SB), Tables (TBL), Time (TIME), File (FS)", "external"], ["OSAL: operating system abstraction layer", "external"], ["PSP: platform support package for the target board", "external"], ["Operating system and hardware (Linux target; BeagleBone cross-compile in cFS-flight)", "hw"]];
  const W = 900, root = svgRoot(W, 40 + rows.length * 62 + 40, "cFS layers");
  rows.forEach(([t, k], i) => { const y = 20 + i * 62; root.append(sbox(40, y, 820, 50, SCOL[k][0], SCOL[k][1], 5), stext(450, y + 30, t, { anchor: "middle", size: 13.5 })); });
  root.append(stext(40, 40 + rows.length * 62 + 22, "Each layer only talks to the one below it. Apps use cFE services (mostly the Software Bus) and never call the operating system directly.", { size: 11.5, fill: "#5d5d5d" }));
  return { svg: root, text: rows.map(r => r[0]) };
}
function diagSequence() {
  const lanes = [["Ground station", "CSP address 3", 130], ["bus_comms", "Communication Manager", 380], ["radio_murgas_app", "Radio Manager", 640], ["cf (NASA)", "CFDP engine", 890]];
  const sections = [["Downlink: send a file to the ground (TRANSMIT_FILE, command 5)", [[2, 3, "CF commands (CF_CMD_MID)"], [3, 2, "CF_CH0_TX_MID: outgoing PDUs"], [2, 1, "SEND_CSP command (MID 0x1888, code 0x10)"], [1, 0, "CSP packet, port 15 (over CAN / radio)"]]],
    ["Uplink: receive a file from the ground", [[0, 1, "CFDP PDU on CSP port 15"], [1, 2, "BUS_COMMS_CSP_RX_DATA (MID 0x088A)"], [2, 3, "re-published as CF channel 0 receive telemetry"]]]];
  const nMsg = sections.reduce((a, s) => a + s[1].length, 0), H = 70 + sections.length * 44 + nMsg * 50 + 60, W = 1020;
  const root = svgRoot(W, H, "File transfer sequence");
  root.append(marker("seqA"));
  lanes.forEach(([n, s, x]) => { root.append(sline(x, 62, x, H - 50, { stroke: "#bdbdbd", dash: "4 4", w: 1 }), sbox(x - 80, 12, 160, 44, "#fff4d6", "#b26a00", 5), stext(x, 31, n, { anchor: "middle", bold: true, size: 13 }), stext(x, 47, s, { anchor: "middle", size: 10.5, fill: "#5d5d5d" })); });
  let y = 80; const text = [];
  sections.forEach(([t, msgs]) => {
    root.append(sbox(20, y - 16, W - 40, 26, "#f0f0f0", "#d0d0d0", 3), stext(32, y + 2, t, { bold: true, size: 12.5 })); text.push(t); y += 44;
    msgs.forEach(([a, b, label]) => { const xa = lanes[a][2], xb = lanes[b][2]; root.append(sline(xa, y, xb + (xb > xa ? -2 : 2), y, { arrow: "seqA", w: 1.8 }), stext((xa + xb) / 2, y - 7, label, { anchor: "middle", size: 12 })); text.push(`${lanes[a][0]} → ${lanes[b][0]}: ${label}`); y += 50; });
  });
  root.append(stext(20, H - 22, "From the code on cFS-flight branch radio-manager-dev. The newest bus_comms removes SEND_CSP and MID 0x088A (finding CH-001), so this flow breaks if that branch is merged as is.", { size: 11, fill: "#5d5d5d" }));
  return { svg: root, text };
}
function diagStatus() {
  const groups = [[1, "OBC apps"], [2, "NASA services"], [3, "Payload Controller apps"], [4, "Simulators"]];
  const W = 900, root = svgRoot(W, 40 + groups.length * 46 + 50, "Code status by group"); const text = [];
  groups.forEach(([c, name], i) => {
    const y = 24 + i * 46, ns = nodesOf(c).filter(n => !n.hw); root.append(stext(20, y + 20, name, { bold: true, size: 13 }));
    let x = 220; const cnt = {};
    ["none", "branch", "external", "unknown"].forEach(k => { const m = ns.filter(n => (n.status || "unknown") === k).length; cnt[k] = m; if (!m) return; const w = m * 36; root.append(sbox(x, y, w, 28, SCOL[k][0], SCOL[k][1], 3), stext(x + w / 2, y + 19, String(m), { anchor: "middle", bold: true, size: 13 })); x += w + 2; });
    root.append(stext(x + 12, y + 19, `${ns.length} total`, { size: 12, fill: "#5d5d5d" })); text.push(`${name}: ${ns.length} apps (${Object.entries(cnt).filter(e => e[1]).map(e => e[1] + " " + (ST[e[0]] || e[0]).toLowerCase()).join(", ")})`);
  });
  let lx = 20; const ly = 24 + groups.length * 46 + 6;
  [["none", "No code found"], ["branch", "Code on a branch"], ["external", "Private repo"], ["unknown", "Unknown"]].forEach(([k, t]) => { root.append(sbox(lx, ly, 16, 14, SCOL[k][0], SCOL[k][1], 2), stext(lx + 22, ly + 12, t, { size: 11.5 })); lx += 150; });
  return { svg: root, text };
}
function diagMatrix() {
  const A = DOC.architecture || { nodes: [], edges: [] };
  const ns = A.nodes.filter(n => !n.hw).sort((a, b) => a.col - b.col || a.name.localeCompare(b.name)), idx = Object.fromEntries(ns.map((n, i) => [n.id, i]));
  const C = 16, LW = 200, TOP = 150, W = LW + ns.length * C + 40, H = TOP + ns.length * C + 40, root = svgRoot(W, H, "App dependency matrix");
  const cell = {}; A.edges.forEach(e => { if (!(e.a in idx) || !(e.b in idx)) return; const k1 = idx[e.a] + "," + idx[e.b], k2 = idx[e.b] + "," + idx[e.a]; const kind = e.kind === "code" || cell[k1] === "code" ? "code" : "docs"; cell[k1] = kind; cell[k2] = kind; });
  const text = [];
  ns.forEach((n, i) => { const [f, s] = nodeCol(n); root.append(sbox(LW - 12, TOP + i * C + 2, 8, C - 4, f, s, 1), stext(LW - 18, TOP + i * C + 12, n.name, { anchor: "end", size: 10.5 }), svg("text", { x: LW + i * C + C / 2 - 3, y: TOP - 6, "font-family": FONT, "font-size": 10.5, fill: "#1a1a1a", transform: `rotate(-55 ${LW + i * C + C / 2 - 3} ${TOP - 6})` }, n.name));
    const links = ns.filter((m, j) => cell[i + "," + j]).map(m => m.name); text.push(`${n.name}: ${links.length ? links.join(", ") : "no links to other apps"}`); });
  ns.forEach((a, i) => ns.forEach((b, j) => { const k = cell[i + "," + j]; const x = LW + j * C, y = TOP + i * C; root.append(svg("rect", { x, y, width: C, height: C, fill: i === j ? "#eeeeee" : k === "code" ? "#800000" : k === "docs" ? "#9e9e9e" : "#ffffff", stroke: "#e1e1e1", "stroke-width": 0.5 }, svg("title", {}, `${a.name} / ${b.name}${k ? " (" + k + ")" : ""}`))); }));
  root.append(sbox(LW, H - 28, 14, 14, "#800000", "#800000", 1), stext(LW + 20, H - 17, "verified in code", { size: 11.5 }), sbox(LW + 150, H - 28, 14, 14, "#9e9e9e", "#9e9e9e", 1), stext(LW + 170, H - 17, "documented link", { size: 11.5 }));
  return { svg: root, text };
}
function dlSvg(el, name) {
  const s = new XMLSerializer().serializeToString(el), url = URL.createObjectURL(new Blob([s], { type: "image/svg+xml" }));
  const a = h("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
const DIAGRAMS = [
  ["system", "System overview", "The whole flight software at a glance: hardware and external systems, the OBC apps, NASA services and the Payload Controller. Box colour shows whether code was found. Built from the Architecture data.", diagSystem],
  ["sequence", "File transfer: how data flows", "How a file moves between the satellite and the ground through bus_comms, the Radio Manager and NASA's CFDP app, with the message IDs involved.", diagSequence],
  ["stack", "cFS layers", "Where PULSE-A apps sit in NASA's core Flight System. Useful for new members.", diagStack],
  ["status", "Code status by group", "How much of each group has code in the repos checked. Built from the Architecture data.", diagStatus],
  ["matrix", "App dependency matrix", "Which apps are linked to which. Dark red cells are links confirmed in code; grey cells come from the docs only. Built from the Architecture data.", diagMatrix],
];
function figure(d, withLink) {
  const r = d[3]();
  return h("figure", { class: "fig", id: "fig-" + d[0] }, h("h2", {}, d[1]), h("p", { class: "note" }, d[2]),
    h("div", { class: "figwrap" }, r.svg),
    h("div", { class: "acts" }, h("button", { class: "btn sm ghost", onclick: () => dlSvg(r.svg, "pulse-a-" + d[0] + ".svg") }, "Download SVG"), withLink ? h("button", { class: "btn sm ghost", onclick: () => go("diagrams") }, "All diagrams") : null),
    h("details", {}, h("summary", {}, "Text version of this diagram"), h("ul", {}, r.text.map(t => h("li", {}, t)))));
}
function viewDiagrams() {
  if (!DOC.architecture) return h("p", {}, "No architecture data yet.");
  return [h("p", { class: "note" }, "Diagrams are drawn from the hub's own data, so they stay in step with the Architecture tab. Each one can be downloaded as an SVG for slides and design reviews, and has a plain-text version for screen readers."), DIAGRAMS.map(d => figure(d, false))];
}
function viewHome() {
  const A = DOC.architecture || { nodes: [] }, apps = A.nodes.filter(n => !n.hw), withCode = apps.filter(n => n.status === "branch" || n.status === "external").length;
  const open = (DOC.changes || []).filter(c => c.status === "open"), high = open.filter(c => c.severity === "high"), cl = DOC.checklist || [], done = cl.filter(c => c.done).length;
  const stats = [[String(daysToCdr()), "days to CDR (Nov 17)"], [`${withCode} / ${apps.length}`, "apps with code found"], [String(open.length), `open findings, ${high.length} high`], [`${done} / ${cl.length}`, "checklist items done"]];
  const start = [["onboarding", "New here? Start with onboarding", "A reading and doing path from day 1 to your first contribution."], ["arch", "See how it fits together", "Click any app to see its links, status and open findings."], ["diagrams", "Look at the diagrams", "System layout, message flow and code status, downloadable."], ["changes", "What changed and what to do", "The living log of findings that affect the docs."]];
  const next = cl.filter(c => !c.done).slice(0, 6);
  const out = [h("div", { class: "stats" }, stats.map(([n, l]) => h("div", { class: "stat" }, h("div", { class: "n" }, n), h("div", { class: "l" }, l)))),
    h("div", { class: "cards" }, start.map(([t, ti, d]) => h("a", { class: "card tile", href: "#" + t, onclick: ev => { ev.preventDefault(); go(t); } }, h("h3", {}, ti), h("p", {}, d)))),
    h("section", { class: "grp", id: "attention" }, h("h2", {}, "Needs attention"), high.length ? h("ul", { class: "links" }, high.slice(0, 5).map(c => h("li", {}, h("div", {}, h("a", { class: "t", href: "#changes", onclick: ev => { ev.preventDefault(); go("changes"); } }, c.id + ": " + c.title), h("div", { class: "note" }, c.action || c.detail))))) : h("p", {}, "No high-severity open findings.")),
    h("section", { class: "grp", id: "next" }, h("h2", {}, "Next on the CDR checklist"), next.length ? h("ul", { class: "links" }, next.map(c => h("li", {}, h("div", {}, h("span", { class: "t" }, c.text), h("div", { class: "note" }, [c.group, c.owner && "Owner: " + c.owner, c.due && "Due: " + c.due].filter(Boolean).join("  ·  ")))))) : h("p", {}, "Everything is ticked.")),
    (DOC.headsUp || []).length ? h("div", { class: "admon" }, h("span", { class: "admon-label" }, "Important"), h("p", { class: "admon-title" }, "Known gaps in the docs"), h("ul", {}, DOC.headsUp.map(x => h("li", {}, x)))) : null];
  if (A.nodes.length) out.push(h("section", { class: "grp", id: "overview-diagram" }, figure(DIAGRAMS[0], true)));
  return out;
}
function viewSearch() {
  const q = GQ.toLowerCase();
  if (!q) return h("p", {}, "Type in the search box at the top and press Enter. It searches apps, documentation links, findings, the checklist, onboarding steps and terms.");
  const hit = (...s) => s.filter(Boolean).join(" ").toLowerCase().includes(q), res = [];
  DOC.appGroups.forEach(g => g.apps.forEach(a => { if (hit(a.name, a.desc, (a.related || []).join(" "), a.codeNote)) res.push(["App", a.name, a.desc, () => { TAB = "apps"; Q = a.name; render(); }]); }));
  DOC.docSections.forEach(s => s.items.forEach(i => { if (hit(i.title, i.note, s.name)) res.push(["Doc", i.title, i.note || s.name, safeUrl(i.url) ? i.url : () => go("docs")]); }));
  (DOC.changes || []).forEach(c => { if (hit(c.id, c.title, c.detail, c.area, (c.impacts || []).join(" "))) res.push(["Finding", c.id + ": " + c.title, c.detail, () => go("changes")]); });
  (DOC.checklist || []).forEach(c => { if (hit(c.text, c.note, c.group)) res.push(["Checklist", c.text, c.note || c.group, () => go("checklist")]); });
  ((DOC.onboarding || {}).tracks || []).forEach(t => t.steps.forEach(st => { if (hit(st.title, st.why)) res.push(["Onboarding", st.title, st.why, () => go("onboarding")]); }));
  [...(DOC.terms || []), ...(DOC.departments || [])].forEach(t => { if (hit(t.term, t.text)) res.push(["Term", t.term, t.text, () => go("onboarding")]); });
  return [h("p", { class: "note" }, `${res.length} result${res.length === 1 ? "" : "s"} for "${GQ}"`),
    h("ul", { class: "links" }, res.slice(0, 80).map(([k, t, d, to]) => h("li", {}, h("div", {},
      typeof to === "string" ? h("a", { class: "t", href: to, target: "_blank", rel: "noopener" }, t + " ↗") : h("a", { class: "t", href: "#", onclick: ev => { ev.preventDefault(); to(); } }, t),
      h("div", { class: "note" }, (d || "").length > 200 ? d.slice(0, 199) + "…" : d)), h("span", { class: "kind k-read" }, k))))];
}

const HEROES = {
  home: ["Overview", "Where the PULSE-A flight software stands, what needs attention, and where to go next."],
  diagrams: ["Diagrams", "Clean, downloadable diagrams of the flight software, drawn from the hub's own data."],
  search: ["Search", "Results from apps, documentation, findings, the checklist, onboarding and terms."],
  arch: ["Architecture", "How the flight software fits together: which apps talk to which, what is hardware, and where code actually exists. Click a box to see its interfaces and the changes that affect it."],
  changes: ["Changes & impact", "What changed in the repos and docs, which apps it touches, and what to do about it. The living log for keeping documentation honest until CDR."],
  onboarding: ["Onboarding", "Everything a new flight software member needs: the reading path, the access to request, and the vocabulary, in order."],
  apps: ["Flight software apps", "Every cFS application on PULSE-A, grouped by where it runs, with the docs page, a size badge so thin pages stand out, and related apps and protocols one click away."],
  docs: ["Documentation", "Links to the docs site, protocols, hardware, systems engineering pages, NASA references, and the team's private Drive and GitHub resources."],
  checklist: ["Checklist", "What has to be finished for CDR on November 17, 2026. Tick items as they are done; add your own."],
  admin: ["Admin", "Manage who can see and edit this hub."],
};
async function render() {
  $app.replaceChildren();
  if (!ME) return renderLogin();
  const groups = [["Start", [["home", "Overview"], ["onboarding", "Onboarding"]]], ["Understand", [["arch", "Architecture"], ["diagrams", "Diagrams"], ["apps", "Apps"]]], ["Track", [["changes", "Changes"], ["checklist", "Checklist"]]], ["Reference", [["docs", "Documentation"]]]];
  if (ME.role === "admin") groups.push(["Manage", [["admin", "Admin"]]]);
  const header = h("header", { class: "navbar" }, h("div", { class: "brand" }, "UCSP // PULSE-A", h("small", {}, "Flight Software Hub")),
    h("div", { class: "who" }, h("input", { type: "search", class: "gsearch", placeholder: "Search the hub…", "aria-label": "Search the hub", value: GQ, onkeydown: ev => { if (ev.key === "Enter") { GQ = ev.target.value.trim(); TAB = "search"; Q = ""; render(); } } }), canEdit() && TAB !== "admin" ? h("label", { class: "pointer" }, h("input", { type: "checkbox", checked: EDIT, onchange: ev => { EDIT = ev.target.checked; render(); } }), " Edit mode") : null,
      h("span", {}, "Public, read-only")));
  const [t, sub] = HEROES[TAB];
  const days = Math.max(0, Math.ceil((new Date("2026-11-17T23:59:00") - new Date()) / 864e5));
  const navp = h("nav", { class: "nav-panel" }, h("div", { class: "nav-title" }, "PULSE-A Hub"),
    "", groups.map(([gname, items]) => [h("div", { class: "nav-group" }, gname), h("ul", { class: "nav-list" }, items.map(([k, l]) => h("li", { class: "nav-item" + (TAB === k ? " is-current-page" : "") }, h("a", { class: "nav-link", href: "#" + k, onclick: ev => { ev.preventDefault(); go(k); } }, l))))]));
  const toolbar = h("div", { class: "toolbar" }, h("span", { class: "crumbs" }, "PULSE-A Hub", h("span", { class: "sep" }, "›"), t), h("span", { class: "cdr" }, `CDR: November 17, 2026 · ${days} days left`));
  const art = h("article", { class: "doc" }, h("h1", {}, t), h("p", { class: "lead" }, sub));
  const main = art;
  try {
    if (!DOC) DOC = await api("GET", "/api/content");
    if (TAB === "onboarding" && !PROG) PROG = new Set((await api("GET", "/api/progress")).done);
    const v = TAB === "home" ? viewHome() : TAB === "diagrams" ? viewDiagrams() : TAB === "search" ? viewSearch() : TAB === "arch" ? viewArch() : TAB === "changes" ? viewChanges() : TAB === "onboarding" ? viewOnboarding() : TAB === "apps" ? viewApps() : TAB === "docs" ? viewDocs() : TAB === "checklist" ? viewChecklist() : await viewAdmin();
    main.append(...[v].flat(Infinity));
    const secs = [...main.querySelectorAll("section.grp > h2, figure.fig > h2")];
    if (secs.length >= 3 && TAB !== "home") {
      secs.forEach((e, i) => { e.parentElement.id = e.parentElement.id || "sec" + i; });
      main.querySelector("p.lead").after(h("nav", { class: "jump", "aria-label": "On this page" }, h("span", {}, "On this page:"), secs.map(e => h("a", { href: "#" + e.parentElement.id, onclick: ev => { ev.preventDefault(); e.parentElement.scrollIntoView({ behavior: "smooth", block: "start" }); } }, e.textContent.replace(/\s*\(\d+(\/\d+)?\)\s*$/, "")))));
    }
  } catch (e) { main.append(h("p", { class: "err" }, e.message)); }
  $app.append(header, h("div", { class: "page" }, navp, h("div", { class: "content" }, toolbar, h("div", { class: "scroll" }, main, h("div", { class: "foot" }, "University of Chicago Space Program · PULSE-A · documentation hub. Doc page sizes are from a scan on " + (DOC ? DOC.meta.seeded : ""))))));
}
function renderLogin() {
  const err = h("div", { class: "err" });
  const u = h("input", { type: "text", autocomplete: "username", autofocus: true }), p = h("input", { type: "password", autocomplete: "current-password" });
  $app.append(h("div", { class: "login" }, h("h1", {}, "PULSE-A Flight Software Hub"),
    h("form", { onsubmit: async ev => { ev.preventDefault(); try { ME = await api("POST", "/api/login", { username: u.value, password: p.value }); TAB = "home"; PROG = null; render(); } catch (e) { err.textContent = e.message; } } },
      h("label", {}, "Username"), u, h("label", {}, "Password"), p, err, h("button", { class: "btn full", type: "submit" }, "Sign in"))));
}
{ const h0 = location.hash.slice(1); if (["home", "onboarding", "arch", "diagrams", "apps", "changes", "checklist", "docs", "admin"].includes(h0)) TAB = h0; }
(async () => { try { const m = await api("GET", "/api/me"); ME = m.user ? m : null; } catch { ME = null; } render(); })();
