import * as backend from "./backend.js";

/* =========================================================================
   Utilities
   ========================================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

function api(url, opts = {}) {
  return backend.handle(opts.method || (opts.body ? "POST" : "GET"), url, opts.body);
}

async function download(path) {
  try {
    const f = await api(path);
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([f.content], { type: f.type })), download: f.filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) { fail(e); }
}

function toast(msg, type = "") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), type === "error" ? 6000 : 3200);
}
const fail = (e) => toast(e.message || String(e), "error");

const TODAY = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayIso = () => iso(TODAY());
const plusDays = (n) => { const d = TODAY(); d.setDate(d.getDate() + n); return iso(d); };
const daysFrom = (s) => Math.round((new Date(s + "T00:00:00") - TODAY()) / 864e5);
function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s.length === 10 ? s + "T00:00:00" : s);
  if (isNaN(d)) return s;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}
function dueLabel(s) {
  if (!s) return "";
  const n = daysFrom(s);
  if (n < 0) return `<span class="due over">${-n}d overdue</span>`;
  if (n === 0) return `<span class="due today">Today</span>`;
  if (n === 1) return `<span class="due">Tomorrow</span>`;
  if (n < 7) return `<span class="due">In ${n} days</span>`;
  return `<span class="due">${fmtDate(s)}</span>`;
}
function ago(s) {
  if (!s) return "";
  const n = -daysFrom(s.slice(0, 10));
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  if (n < 30) return `${n}d ago`;
  return fmtDate(s);
}
function scoreEl(score) {
  if (score == null) return `<span class="score"><b class="muted">–</b></span>`;
  const c = score >= 70 ? "var(--green)" : score >= 50 ? "var(--amber)" : "var(--muted)";
  return `<span class="score" title="Match score"><b style="color:${c}">${score}</b><i style="--w:${score}%;--c:${c}"></i></span>`;
}
const initials = (s) => (s || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch { const ta = document.createElement("textarea"); ta.value = text; document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
  if (btn) { const o = btn.textContent; btn.textContent = "Copied"; setTimeout(() => (btn.textContent = o), 1400); }
}
function peopleLinks(company, title) {
  const core = (title || "").replace(/\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|head of|ii|iii|iv)\b/gi, "").replace(/\s+/g, " ").trim();
  const c = company ? ` "${company}"` : "";
  const li = (q) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
  return [
    ["Recruiters at the company", li(`recruiter OR "talent acquisition"${c}`)],
    ["Likely hiring manager", li(`${core ? core + " manager" : "hiring manager"}${c}`)],
    ["People in this team", li(`${core}${c}`)],
    ["Your connections there", `https://www.linkedin.com/search/results/people/?network=%5B%22F%22%2C%22S%22%5D&keywords=${encodeURIComponent(company || "")}`],
    ["Company careers page", `https://www.google.com/search?q=${encodeURIComponent(`${company} careers ${title || ""}`)}`],
  ];
}

const STATUS = {
  wishlist: "Saved", applied: "Applied", screening: "Screening", interviewing: "Interviewing", offer: "Offer",
  accepted: "Accepted", rejected: "Rejected", withdrawn: "Withdrawn", ghosted: "No response",
};
const CLOSED = ["accepted", "rejected", "withdrawn", "ghosted"];
const statusEl = (s) => `<span class="status s-${s}">${STATUS[s] || s}</span>`;

/* =========================================================================
   State & routing
   ========================================================================= */
const state = {
  profile: null, sources: {}, settings: { has_key: false },
  jobs: [], apps: [], dash: null,
  task: null, openJob: null,
  jf: store.get("jobFilters", { q: "", min: 0, sort: "score", hideTracked: true, showHidden: false }),
  jobLimit: 60,
  trackerMode: store.get("trackerMode", "board"),
  tsort: { key: "updated_at", dir: -1 }, tfilter: { q: "", status: "active" },
  profileDirty: false,
};

const VIEWS = { dashboard: renderDashboard, profile: renderProfile, jobs: renderJobs, tracker: renderTracker, settings: renderSettings };
function route() {
  if (document.body.classList.contains("gated")) return;
  const name = (location.hash || "#dashboard").slice(1);
  const view = VIEWS[name] ? name : "dashboard";
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  $$(".sidebar nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
  VIEWS[view]();
  $("#main").scrollTop = 0;
}
window.addEventListener("hashchange", route);

async function refreshCounts() {
  try {
    const d = await api("/api/dashboard");
    state.dash = d;
    const due = d.overdue.length + d.today.length;
    const nd = $("#navDue");
    nd.textContent = due || "";
    nd.classList.toggle("alert", d.overdue.length > 0);
    $("#navApps").textContent = d.active || "";
    $("#navJobs").textContent = d.strong_matches || "";
    $("#navJobs").title = "Strong matches not yet saved";
  } catch { /* server not reachable */ }
}

/* =========================================================================
   Dashboard
   ========================================================================= */
async function renderDashboard() {
  const v = $("#view-dashboard");
  let d;
  try { d = await api("/api/dashboard"); state.dash = d; } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const hello = state.profile?.name ? `, ${esc(state.profile.name.split(" ")[0])}` : "";
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const onboarding = !state.profile || d.total === 0 ? `
    <div class="panel" style="margin-bottom:20px"><div class="panel-head"><h2>Getting started</h2></div>
      <div class="panel-body"><ol class="plain" style="padding-left:18px;margin:0">
        <li style="margin:6px 0">${state.profile ? "<s>Add your CV or LinkedIn profile</s>" : `<a href="#profile">Add your CV or LinkedIn profile</a>`} — this builds your target roles and skills.</li>
        <li style="margin:6px 0">${d.jobs_found ? "<s>Search LinkedIn for matching jobs</s>" : `<a href="#jobs">Search LinkedIn for matching jobs</a>`} — each job is scored against your profile.</li>
        <li style="margin:6px 0">${d.total ? "<s>Save or mark jobs as applied</s>" : "Save or mark jobs as applied"} — follow-ups and reminders are then scheduled for you.</li>
      </ol></div></div>` : "";

  const taskRow = (t) => `<li data-app="${t.app_id}">
      <span>${dueLabel(t.date)}</span>
      <span><span class="what">${esc(t.what)}</span><br><span class="small text-2">${esc(t.company)} · ${esc(t.title)}</span></span>
      ${statusEl(t.status)}</li>`;
  const group = (label, list) => list.length ? `<div class="group-label">${label}</div>${list.map(taskRow).join("")}` : "";
  const anyTasks = d.overdue.length + d.today.length + d.upcoming.length;

  const max = Math.max(1, ...d.weeks.map((w) => w.count));
  const bars = d.weeks.map((w) => `<div class="bar ${w.count ? "" : "zero"}" title="Week of ${fmtDate(w.week)}: ${w.count}">
      <span>${w.count || ""}</span><div style="height:${Math.max(2, (w.count / max) * 88)}px"></div><span>${fmtDate(w.week).replace(/ \d+$/, (m) => m)}</span></div>`).join("");

  const funnelStages = ["applied", "screening", "interviewing", "offer", "accepted", "rejected", "ghosted"];
  const fmax = Math.max(1, ...funnelStages.map((s) => d.by_status[s] || 0));
  const funnel = funnelStages.map((s) => `<div class="f-row s-${s}"><span class="text-2">${STATUS[s]}</span>
      <div class="f-track"><div class="f-fill" style="width:${((d.by_status[s] || 0) / fmax) * 100}%"></div></div>
      <span class="num" style="color:var(--text)">${d.by_status[s] || 0}</span></div>`).join("");

  v.innerHTML = `
    <div class="page-head"><div><h1>Good ${greeting()}${hello}</h1><div class="sub">${dateStr}</div></div>
      <div class="row"><a class="btn" href="#jobs">Find jobs</a><button class="btn primary" id="dNew">Add application</button></div></div>
    ${onboarding}
    <div class="kpis">
      <div class="kpi"><div class="label">Active</div><div class="value">${d.active}</div><div class="hint">in progress</div></div>
      <div class="kpi"><div class="label">Applied</div><div class="value">${d.submitted}</div><div class="hint">all time</div></div>
      <div class="kpi"><div class="label">Response rate</div><div class="value">${d.submitted ? d.response_rate + "%" : "–"}</div><div class="hint">heard back</div></div>
      <div class="kpi"><div class="label">Interview rate</div><div class="value">${d.submitted ? d.interview_rate + "%" : "–"}</div><div class="hint">reached interviews</div></div>
      <div class="kpi"><div class="label">Offers</div><div class="value">${d.offers}</div><div class="hint">&nbsp;</div></div>
      <div class="kpi"><div class="label">Strong matches</div><div class="value">${d.strong_matches}</div><div class="hint"><a href="#jobs">not yet saved</a></div></div>
    </div>
    <div class="grid-2 split">
      <div class="stack">
        <div class="panel"><div class="panel-head"><h2>Next steps</h2><span class="small muted">${anyTasks} this week</span></div>
          ${anyTasks ? `<ul class="task-list">${group("Overdue", d.overdue)}${group("Today", d.today)}${group("Next 7 days", d.upcoming)}</ul>`
            : `<div class="empty"><b>Nothing due</b>Follow-ups appear here when you mark a job as applied or add a contact with a date.</div>`}
        </div>
        ${d.stale.length ? `<div class="panel"><div class="panel-head"><h2>No reply after 3 weeks</h2></div>
          <ul class="task-list">${d.stale.map((s) => `<li data-app="${s.app_id}" style="grid-template-columns:1fr auto">
            <span><span class="what">${esc(s.company)}</span> <span class="text-2">· ${esc(s.title)}</span><br><span class="small muted">Applied ${s.days} days ago</span></span>
            <span class="row"><button class="btn sm" data-followup="${s.app_id}">Follow up</button><button class="btn sm ghost" data-ghost="${s.app_id}">Mark no response</button></span></li>`).join("")}</ul></div>` : ""}
      </div>
      <div class="stack">
        <div class="panel"><div class="panel-head"><h2>Applications per week</h2></div><div class="panel-body"><div class="bars">${bars}</div></div></div>
        <div class="panel"><div class="panel-head"><h2>Pipeline</h2></div><div class="panel-body"><div class="funnel">${funnel}</div></div></div>
      </div>
    </div>`;

  $("#dNew").onclick = () => newAppModal();
  $$("[data-app]", v).forEach((li) => li.addEventListener("click", (e) => { if (!e.target.closest("button")) openApp(+li.dataset.app); }));
  $$("[data-ghost]", v).forEach((b) => (b.onclick = async () => { await api(`/api/apps/${b.dataset.ghost}`, { method: "PUT", body: { status: "ghosted" } }).catch(fail); renderDashboard(); refreshCounts(); }));
  $$("[data-followup]", v).forEach((b) => (b.onclick = () => openApp(+b.dataset.followup, "templates")));
  refreshCounts();
}
function greeting() { const h = new Date().getHours(); return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening"; }

/* =========================================================================
   Profile
   ========================================================================= */
const upload = { cv: null, linkedin: null };

function renderProfile() {
  const v = $("#view-profile");
  const p = state.profile;
  const src = state.sources || {};
  const key = state.settings.has_key;
  v.innerHTML = `
    <div class="page-head"><div><h1>Profile</h1><div class="sub">Your CV and LinkedIn profile set the target roles, skills and match scores used in the job search.</div></div></div>
    <div class="panel">
      <div class="panel-head"><h2>Documents</h2>${p ? `<span class="small muted">Last analysed ${ago(p.analyzed_at)}</span>` : ""}</div>
      <div class="panel-body">
        <div class="grid-2">
          ${dropZone("cv", "CV / résumé", src.cv ? `Current: ${src.cv}` : "PDF, up to 20 MB")}
          ${dropZone("linkedin", "LinkedIn profile", src.linkedin ? `Current: ${src.linkedin}` : "Open your profile → Resources → Save to PDF")}
        </div>
        <details style="margin-top:12px"><summary class="small text-2" style="cursor:pointer">Paste text instead (for scanned PDFs or Word CVs)</summary>
          <textarea id="pText" rows="6" style="margin-top:8px" placeholder="Paste the full text of your CV here"></textarea></details>
        <div class="row" style="margin-top:14px">
          <label class="check" title="${key ? "" : "Claude isn't set up yet — see Settings"}"><input type="checkbox" id="pAi" ${key ? "checked" : "disabled"}> Deeper analysis with Claude</label>
          ${key ? "" : `<a class="small" href="#settings">Set up</a>`}
          <span class="spacer"></span>
          <button class="btn primary" id="pAnalyze">${p ? "Re-analyse" : "Analyse"}</button>
        </div>
      </div>
    </div>
    <div id="pResult" style="margin-top:20px"></div>`;

  for (const kind of ["cv", "linkedin"]) wireDrop(kind);
  $("#pAnalyze").onclick = analyze;
  if (p) renderProfileResult();
}

function dropZone(kind, title, hint) {
  const f = upload[kind];
  return `<label class="drop ${f ? "has" : ""}" id="drop-${kind}">
      <span class="file-ico">PDF</span>
      <span><span class="t">${f ? esc(f.name) : title}</span><br><span class="small muted">${f ? "Ready to analyse" : esc(hint)}</span></span>
      <input type="file" accept="application/pdf,.pdf" id="file-${kind}"></label>`;
}
function wireDrop(kind) {
  const zone = $(`#drop-${kind}`), input = $(`#file-${kind}`);
  const set = (file) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) return toast("Please choose a PDF file.", "error");
    upload[kind] = file;
    zone.outerHTML = dropZone(kind, "", "");
    wireDrop(kind);
  };
  input.onchange = () => set(input.files[0]);
  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add("over"); };
  zone.ondragleave = () => zone.classList.remove("over");
  zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove("over"); set(e.dataTransfer.files[0]); };
}

async function analyze() {
  const btn = $("#pAnalyze");
  const fd = new FormData();
  if (upload.cv) fd.append("cv", upload.cv);
  if (upload.linkedin) fd.append("linkedin", upload.linkedin);
  fd.append("text", $("#pText").value);
  fd.append("use_ai", $("#pAi").checked ? "true" : "false");
  if (!upload.cv && !upload.linkedin && !$("#pText").value.trim() && !state.profile) return toast("Add a CV or LinkedIn PDF first.", "error");
  btn.disabled = true;
  btn.innerHTML = `<span class="spin"></span> Analysing${$("#pAi").checked ? " with Claude" : ""}…`;
  try {
    const r = await api("/api/profile/analyze", { body: fd });
    state.profile = r.profile; state.sources = r.sources;
    upload.cv = upload.linkedin = null;
    if (r.warning) toast(r.warning, "error"); else toast("Profile updated");
    await api("/api/jobs/rescore", { method: "POST" }).catch(() => {});
    state.search = null;
    renderProfile();
  } catch (e) { fail(e); btn.disabled = false; btn.textContent = "Analyse"; }
}

function renderProfileResult() {
  const p = state.profile;
  const el = $("#pResult");
  const list = (arr, empty) => arr?.length ? `<ul class="plain">${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted small">${empty}</p>`;
  const seniorities = ["internship", "entry", "associate", "mid-senior", "director", "executive"];
  el.innerHTML = `
    <div class="grid-2 split" style="align-items:start">
      <div class="panel">
        <div class="panel-head"><h2>${esc(p.name || "Your profile")}</h2>
          <span class="small muted">${p.source === "ai" ? "Analysed by Claude" : "Built-in analysis"} · edit anything below</span></div>
        <div class="panel-body stack">
          ${p.headline ? `<p class="text-2" style="margin:0">${esc(p.headline)}</p>` : ""}
          ${p.summary ? `<p style="margin:0">${esc(p.summary)}</p>` : ""}
          <div class="fields">
            <label class="field"><span>Current title</span><input type="text" data-pf="current_title" value="${esc(p.current_title)}"></label>
            <label class="field"><span>Years of experience</span><input type="number" min="0" step="0.5" data-pf="years_experience" value="${p.years_experience ?? ""}"></label>
            <label class="field"><span>Seniority</span><select data-pf="seniority">${seniorities.map((s) => `<option ${s === p.seniority ? "selected" : ""} value="${s}">${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}</select></label>
            <label class="field"><span>Location</span><input type="text" data-pf="location" value="${esc(p.location)}"></label>
          </div>
          <div><label class="field"><span>Target job titles <span class="muted">— used as search queries</span></span></label><div id="tgTitles"></div></div>
          <div><label class="field"><span>Skills <span class="muted">— used for match scores</span></span></label><div id="tgSkills"></div></div>
          <div><label class="field"><span>Where to search</span></label><div id="tgLocs"></div></div>
          <div class="row"><span class="small muted" id="pDirty"></span><span class="spacer"></span>
            <button class="btn" id="pSave" disabled>Save changes</button>
            <a class="btn primary" href="#jobs">Search jobs</a></div>
        </div>
      </div>
      <div class="stack">
        <div class="panel"><div class="panel-head"><h3>Strengths</h3></div><div class="panel-body">${list(p.strengths, "Nothing noted.")}</div></div>
        <div class="panel"><div class="panel-head"><h3>Improve your CV</h3></div><div class="panel-body">${list(p.improvements, "No issues found.")}</div></div>
        <div class="panel"><div class="panel-body"><dl class="dl">
          <dt>Email</dt><dd>${esc(p.email) || "–"}</dd>
          <dt>Phone</dt><dd>${esc(p.phone) || "–"}</dd>
          <dt>LinkedIn</dt><dd>${p.linkedin_url ? `<a target="_blank" href="${esc(/^http/.test(p.linkedin_url) ? p.linkedin_url : "https://" + p.linkedin_url)}">${esc(p.linkedin_url.replace(/^https?:\/\/(www\.)?/, ""))}</a>` : "–"}</dd>
          <dt>Roles held</dt><dd>${esc((p.titles || []).join(", ")) || "–"}</dd>
          <dt>Education</dt><dd>${(p.education || []).map(esc).join("<br>") || "–"}</dd>
          <dt>Languages</dt><dd>${esc((p.languages || []).join(", ")) || "–"}</dd>
          ${p.certifications?.length ? `<dt>Certifications</dt><dd>${p.certifications.map(esc).join("<br>")}</dd>` : ""}
          ${p.soft_skills?.length ? `<dt>Soft skills</dt><dd>${esc(p.soft_skills.join(", "))}</dd>` : ""}
        </dl></div></div>
      </div>
    </div>`;

  const dirty = () => { state.profileDirty = true; $("#pSave").disabled = false; $("#pDirty").textContent = "Unsaved changes"; };
  tagInput($("#tgTitles"), p.target_titles ||= [], "Add a job title…", dirty);
  tagInput($("#tgSkills"), p.skills ||= [], "Add a skill…", dirty);
  tagInput($("#tgLocs"), p.search_locations ||= [], "e.g. Dubai, United Arab Emirates", dirty);
  $$("[data-pf]", el).forEach((inp) => inp.addEventListener("input", () => {
    p[inp.dataset.pf] = inp.type === "number" ? (inp.value === "" ? null : +inp.value) : inp.value; dirty();
  }));
  $("#pSave").onclick = async () => {
    try {
      await api("/api/profile", { method: "PUT", body: p });
      await api("/api/jobs/rescore", { method: "POST" });
      state.profileDirty = false; state.search = null;
      $("#pSave").disabled = true; $("#pDirty").textContent = "";
      toast("Saved — match scores updated");
    } catch (e) { fail(e); }
  };
}

function tagInput(root, values, placeholder, onChange) {
  const draw = () => {
    root.innerHTML = `<div class="tag-input">${values.map((v, i) => `<span class="tag">${esc(v)}<button data-i="${i}" aria-label="Remove">×</button></span>`).join("")}
      <input type="text" placeholder="${esc(placeholder)}"></div>`;
    const input = $("input", root);
    $(".tag-input", root).onclick = (e) => { if (e.target === e.currentTarget) input.focus(); };
    $$("button[data-i]", root).forEach((b) => (b.onclick = () => { values.splice(+b.dataset.i, 1); draw(); onChange?.(); }));
    const add = () => {
      const parts = input.value.split(/[,;]\s*/).map((s) => s.trim()).filter(Boolean);
      let changed = false;
      for (const s of parts) if (!values.some((v) => v.toLowerCase() === s.toLowerCase())) { values.push(s); changed = true; }
      input.value = "";
      if (changed) { draw(); onChange?.(); $("input", root).focus(); }
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
      else if (e.key === "Backspace" && !input.value && values.length) { values.pop(); draw(); onChange?.(); $("input", root).focus(); }
    };
    input.onblur = add;
  };
  draw();
}

/* =========================================================================
   Find jobs
   ========================================================================= */
function defaultSearch() {
  const p = state.profile || {};
  const order = ["internship", "entry", "associate", "mid-senior", "director", "executive"];
  const i = order.indexOf(p.seniority);
  const exp = i < 0 ? [] : order.slice(Math.max(0, i - (i >= 3 ? 1 : 0)), i + 2).filter((x) => x !== "internship" || p.seniority === "internship");
  return {
    queries: (p.target_titles || []).slice(0, 4), locations: (p.search_locations || []).slice(0, 2),
    date_posted: "week", work_types: [], experience: exp, job_types: [], per_query: 30, sort: "R", fetch_details: true,
  };
}

async function renderJobs() {
  const v = $("#view-jobs");
  if (!state.search) state.search = store.get("searchForm", null) || defaultSearch();
  const s = state.search;
  const opt = (arr, cur) => arr.map(([val, lab]) => `<option value="${val}" ${String(cur) === String(val) ? "selected" : ""}>${lab}</option>`).join("");
  const checks = (name, arr) => arr.map(([val, lab]) => `<label class="check"><input type="checkbox" data-ck="${name}" value="${val}" ${s[name].includes(val) ? "checked" : ""}> ${lab}</label>`).join("");

  v.innerHTML = `
    <div class="page-head"><div><h1>Find jobs</h1><div class="sub">Searches LinkedIn's public job listings and scores every result against your profile.</div></div>
      ${state.profile ? "" : `<a class="btn" href="#profile">Add your CV first</a>`}</div>
    <div class="panel"><div class="panel-body">
      <div class="search-grid">
        <div><label class="field"><span>Job titles or keywords</span></label><div id="sQueries"></div></div>
        <div><label class="field"><span>Locations <span class="muted">— leave empty for worldwide</span></span></label><div id="sLocs"></div></div>
      </div>
      <div class="filter-grid">
        <label class="field"><span>Date posted</span><select id="sDate">${opt([["24h", "Past 24 hours"], ["week", "Past week"], ["month", "Past month"], ["any", "Any time"]], s.date_posted)}</select></label>
        <label class="field"><span>Results per title & location</span><select id="sPer">${opt([[20, "20"], [30, "30"], [50, "50"], [100, "100"]], s.per_query)}</select></label>
        <label class="field"><span>Order</span><select id="sSort">${opt([["R", "Most relevant"], ["DD", "Most recent"]], s.sort)}</select></label>
        <label class="field"><span>Details</span><label class="check" style="height:32px"><input type="checkbox" id="sDetails" ${s.fetch_details ? "checked" : ""}> Read full job descriptions</label></label>
        <div><label class="field"><span>Workplace</span></label><div class="checks">${checks("work_types", [["onsite", "On-site"], ["hybrid", "Hybrid"], ["remote", "Remote"]])}</div></div>
        <div style="grid-column: span 2"><label class="field"><span>Experience level</span></label><div class="checks">${checks("experience", [["internship", "Internship"], ["entry", "Entry"], ["associate", "Associate"], ["mid-senior", "Mid–senior"], ["director", "Director"], ["executive", "Executive"]])}</div></div>
        <div><label class="field"><span>Job type</span></label><div class="checks">${checks("job_types", [["full-time", "Full-time"], ["contract", "Contract"], ["part-time", "Part-time"]])}</div></div>
      </div>
      <div class="row" style="margin-top:16px">
        <span class="small muted" id="sMsg">${searchHint()}</span><span class="spacer"></span>
        <button class="btn ghost sm" id="sReset">Reset from profile</button>
        <button class="btn primary" id="sGo">Search LinkedIn</button>
      </div>
      <div class="progress ${state.task?.status === "running" ? "" : "hidden"}" id="sProg"><div style="width:${(state.task?.progress || 0) * 100}%"></div></div>
    </div></div>
    <div class="toolbar">
      <input type="search" id="fQ" placeholder="Filter by title, company, skill…" value="${esc(state.jf.q)}">
      <select id="fMin">${opt([[0, "Any match"], [40, "Match 40+"], [55, "Match 55+"], [70, "Match 70+"]], state.jf.min)}</select>
      <select id="fSort">${opt([["score", "Best match"], ["date", "Newest"], ["company", "Company A–Z"]], state.jf.sort)}</select>
      <label class="check"><input type="checkbox" id="fTracked" ${state.jf.hideTracked ? "checked" : ""}> Hide saved</label>
      <label class="check"><input type="checkbox" id="fHidden" ${state.jf.showHidden ? "checked" : ""}> Show dismissed</label>
      <span class="spacer"></span><span class="small muted" id="fCount"></span>
    </div>
    <div id="jobList"></div>`;

  const persist = () => store.set("searchForm", s);
  tagInput($("#sQueries"), s.queries, "e.g. Data Analyst", () => { persist(); $("#sMsg").textContent = searchHint(); });
  tagInput($("#sLocs"), s.locations, "e.g. Dubai, United Arab Emirates", () => { persist(); $("#sMsg").textContent = searchHint(); });
  $("#sDate").onchange = (e) => { s.date_posted = e.target.value; persist(); };
  $("#sPer").onchange = (e) => { s.per_query = +e.target.value; persist(); $("#sMsg").textContent = searchHint(); };
  $("#sSort").onchange = (e) => { s.sort = e.target.value; persist(); };
  $("#sDetails").onchange = (e) => { s.fetch_details = e.target.checked; persist(); $("#sMsg").textContent = searchHint(); };
  $$("[data-ck]", v).forEach((c) => (c.onchange = () => { s[c.dataset.ck] = $$(`[data-ck="${c.dataset.ck}"]:checked`, v).map((x) => x.value); persist(); }));
  $("#sReset").onclick = () => { state.search = defaultSearch(); persist(); store.set("searchForm", state.search); renderJobs(); };
  $("#sGo").onclick = () => (state.task?.status === "running" ? cancelSearch() : startSearch());

  const jf = state.jf, saveJf = () => store.set("jobFilters", jf);
  $("#fQ").oninput = debounce((e) => { jf.q = e.target.value; saveJf(); drawJobs(); }, 150);
  $("#fMin").onchange = (e) => { jf.min = +e.target.value; saveJf(); drawJobs(); };
  $("#fSort").onchange = (e) => { jf.sort = e.target.value; saveJf(); drawJobs(); };
  $("#fTracked").onchange = (e) => { jf.hideTracked = e.target.checked; saveJf(); drawJobs(); };
  $("#fHidden").onchange = async (e) => { jf.showHidden = e.target.checked; saveJf(); await loadJobs(); };

  updateSearchButton();
  await loadJobs();
}

function searchHint() {
  const s = state.search;
  if (!s.queries.length) return "Add at least one job title.";
  const combos = s.queries.length * Math.max(1, s.locations.length);
  const est = combos * s.per_query;
  const mins = Math.ceil((combos * (s.per_query / 10) * 2 + (s.fetch_details ? est * 2.2 : 0)) / 60);
  return `${combos} search${combos > 1 ? "es" : ""}, up to ${est} jobs · about ${mins} min`;
}
function updateSearchButton() {
  const b = $("#sGo");
  if (!b) return;
  const running = state.task?.status === "running";
  b.textContent = running ? "Stop" : "Search LinkedIn";
  b.classList.toggle("primary", !running);
  $("#sProg")?.classList.toggle("hidden", !running);
  if (running) $("#sMsg").textContent = state.task.message;
}

async function loadJobs() {
  try { state.jobs = await api(`/api/jobs?hidden=${state.jf.showHidden ? 1 : 0}`); } catch (e) { return fail(e); }
  drawJobs();
}

function filteredJobs() {
  const jf = state.jf, q = jf.q.trim().toLowerCase();
  let list = state.jobs.filter((j) => (j.score ?? 0) >= jf.min || (jf.min === 0));
  if (jf.hideTracked && !jf.showHidden) list = list.filter((j) => !j.app_id);
  if (q) list = list.filter((j) => [j.title, j.company, j.location, j.description].some((x) => (x || "").toLowerCase().includes(q)));
  if (jf.sort === "date") list.sort((a, b) => (b.posted_date || "").localeCompare(a.posted_date || ""));
  else if (jf.sort === "company") list.sort((a, b) => (a.company || "").localeCompare(b.company || ""));
  return list;
}

function drawJobs() {
  const box = $("#jobList");
  if (!box) return;
  const list = filteredJobs();
  $("#fCount").textContent = state.jobs.length ? `${list.length} of ${state.jobs.length} jobs` : "";
  if (!state.jobs.length) {
    box.innerHTML = `<div class="job-list"><div class="empty"><b>No jobs yet</b>${state.jf.showHidden ? "Dismissed jobs appear here." : "Run a search above — results appear here as they come in."}</div></div>`;
    return;
  }
  if (!list.length) { box.innerHTML = `<div class="job-list"><div class="empty"><b>No jobs match these filters</b></div></div>`; return; }
  const shown = list.slice(0, state.jobLimit);
  box.innerHTML = `<div class="job-list">${shown.map(jobRow).join("")}</div>
    ${list.length > shown.length ? `<div class="row" style="justify-content:center;margin-top:12px"><button class="btn" id="jMore">Show ${Math.min(60, list.length - shown.length)} more</button></div>` : ""}`;
  $("#jMore")?.addEventListener("click", () => { state.jobLimit += 60; drawJobs(); });
  $$(".job", box).forEach(wireJob);
}

function jobRow(j) {
  const m = j.match || {};
  const open = state.openJob === j.id;
  const tags = [j.seniority && j.seniority !== "Not Applicable" ? j.seniority : "", j.employment_type, j.salary, j.applicants]
    .filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  const skills = (m.matched || []).slice(0, 5).map((s) => `<span class="tag match">${esc(s)}</span>`).join("");
  const logo = j.logo ? `<img class="logo" src="${esc(j.logo)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'logo',textContent:'${esc(initials(j.company)).replace(/'/g, "")}'}))">`
    : `<div class="logo">${esc(initials(j.company))}</div>`;
  const tracked = j.app_id ? `<span class="small">${statusEl(j.app_status)}</span>` : `
      <button class="btn sm" data-act="save">Save</button><button class="btn sm" data-act="applied">Applied</button>`;
  return `<div class="job ${open ? "open" : ""}" data-id="${j.id}">
    <div class="job-row">
      ${logo}
      <div style="min-width:0">
        <div class="job-title">${esc(j.title)}</div>
        <div class="job-meta">${esc(j.company)}<span class="sep">|</span>${esc(j.location)}${j.posted_date ? `<span class="sep">|</span>${esc(j.posted_text || fmtDate(j.posted_date))}` : ""}</div>
        ${tags || skills ? `<div class="job-sub">${tags}${skills}</div>` : ""}
      </div>
      <div class="job-actions">${tracked}</div>
      ${scoreEl(j.score)}
    </div>
    ${open ? jobDetail(j) : ""}
  </div>`;
}

function jobDetail(j) {
  const m = j.match || {};
  const t = j.tailor;
  const key = state.settings.has_key;
  const kv = [["Seniority", j.seniority], ["Type", j.employment_type], ["Function", j.job_function], ["Industry", j.industries],
    ["Applicants", j.applicants], ["Salary", j.salary], ["Posted", j.posted_date ? fmtDate(j.posted_date) : ""], ["Found via", j.query]]
    .filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");
  return `<div class="job-detail">
    <div>
      <div class="desc">${j.description ? esc(j.description) : `<span class="muted">Full description not loaded yet.</span> <button class="btn sm" data-act="refresh">Load it</button>`}</div>
      ${t ? tailorView(t) : ""}
    </div>
    <div>
      <div class="side-block row">
        <a class="btn sm primary" target="_blank" rel="noopener" href="${esc(j.apply_url || j.url)}">${j.apply_url ? "Apply on company site" : "Open on LinkedIn"}</a>
        ${j.apply_url ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(j.url)}">LinkedIn</a>` : ""}
        <button class="btn sm ghost" data-act="hide">${j.hidden ? "Restore" : "Dismiss"}</button>
      </div>
      <div class="side-block"><h3>Why this score</h3>
        ${(m.reasons || []).length ? `<ul class="plain small">${m.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : `<p class="small muted">Load the description to score this job.</p>`}
        ${(m.matched || []).length ? `<div class="small muted" style="margin:8px 0 4px">You have</div><div class="tags">${m.matched.map((s) => `<span class="tag match">${esc(s)}</span>`).join("")}</div>` : ""}
        ${(m.missing || []).length ? `<div class="small muted" style="margin:8px 0 4px">Mentioned, not on your profile</div><div class="tags">${m.missing.map((s) => `<span class="tag miss">${esc(s)}</span>`).join("")}</div>` : ""}
      </div>
      <div class="side-block"><h3>Tailor your application</h3>
        ${key ? `<button class="btn sm" data-act="tailor">${t ? "Regenerate" : "Get fit analysis, CV edits & cover letter"}</button>`
          : `<p class="small muted">Set up Claude (see <a href="#settings">Settings</a>) to get a fit analysis, CV edits, an outreach note and a cover letter for this job.</p>`}
      </div>
      ${kv ? `<div class="side-block"><h3>Details</h3><dl class="kv">${kv}</dl></div>` : ""}
      <div class="side-block"><h3>Who to contact</h3>
        ${j.poster_name ? `<p class="small">Posted by <a target="_blank" rel="noopener" href="${esc(j.poster_url)}">${esc(j.poster_name)}</a>${j.poster_title ? `<br><span class="muted">${esc(j.poster_title)}</span>` : ""}</p>` : ""}
        <div class="link-list">${peopleLinks(j.company, j.title).map(([l, u]) => `<a target="_blank" rel="noopener" href="${esc(u)}">${l}</a>`).join("")}</div>
      </div>
    </div>
  </div>`;
}

function tailorView(t) {
  const li = (a) => (a || []).map((x) => `<li>${esc(x)}</li>`).join("");
  return `<div class="ai-out">
    <div class="row" style="justify-content:space-between"><h4 style="margin:0">Fit: ${t.fit_score}/100</h4><span class="small muted">Generated by Claude — review before using</span></div>
    <p style="margin:6px 0 0">${esc(t.verdict)}</p>
    <h4>Why you fit</h4><ul class="plain small">${li(t.why_you_fit)}</ul>
    <h4>Gaps and how to handle them</h4><ul class="plain small">${li(t.gaps)}</ul>
    <h4>Edits to your CV for this role</h4><ul class="plain small">${li(t.cv_tweaks)}</ul>
    ${t.keywords_to_add?.length ? `<h4>Keywords to include</h4><div class="tags">${t.keywords_to_add.map((k) => `<span class="tag">${esc(k)}</span>`).join("")}</div>` : ""}
    <h4>Prepare for</h4><ul class="plain small">${li(t.interview_topics)}</ul>
    <h4>Connection note</h4><div class="copy-box">${esc(t.outreach_message)}<button class="btn sm" data-copy="outreach">Copy</button></div>
    <h4>Cover letter</h4><div class="copy-box">${esc(t.cover_letter)}<button class="btn sm" data-copy="cover">Copy</button></div>
  </div>`;
}

function wireJob(el) {
  const id = el.dataset.id;
  const job = () => state.jobs.find((j) => j.id === id);
  $(".job-row", el).addEventListener("click", (e) => {
    if (e.target.closest("button, a")) return;
    state.openJob = state.openJob === id ? null : id;
    redrawJob(id);
  });
  $$("[data-act]", el).forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    const act = b.dataset.act, j = job();
    try {
      if (act === "save" || act === "applied") {
        const a = await api("/api/apps", { body: { job_id: id, status: act === "save" ? "wishlist" : "applied" } });
        Object.assign(j, { app_id: a.id, app_status: a.status });
        toast(act === "save" ? `Saved ${j.company}` : `Marked as applied — follow-up set for ${fmtDate(a.next_action_date)}`);
        refreshCounts();
        redrawJob(id);
      } else if (act === "hide") {
        await api(`/api/jobs/${id}/hide`, { method: "POST" });
        state.jobs = state.jobs.filter((x) => x.id !== id);
        state.openJob = null;
        drawJobs();
      } else if (act === "refresh") {
        b.disabled = true; b.innerHTML = `<span class="spin"></span>`;
        Object.assign(j, await api(`/api/jobs/${id}/refresh`, { method: "POST" }));
        redrawJob(id);
      } else if (act === "tailor") {
        b.disabled = true; b.innerHTML = `<span class="spin"></span> Working — about 30 seconds`;
        j.tailor = await api(`/api/jobs/${id}/tailor`, { method: "POST" });
        redrawJob(id);
      }
    } catch (err) { fail(err); b.disabled = false; }
  }));
  $$("[data-copy]", el).forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const t = job().tailor;
    copyText(b.dataset.copy === "cover" ? t.cover_letter : t.outreach_message, b);
  }));
}
function redrawJob(id) {
  const el = $(`.job[data-id="${id}"]`);
  const j = state.jobs.find((x) => x.id === id);
  if (!el || !j) return;
  el.outerHTML = jobRow(j);
  wireJob($(`.job[data-id="${id}"]`));
}

async function startSearch() {
  const s = state.search;
  if (!s.queries.length) return toast("Add at least one job title to search for.", "error");
  try {
    state.task = await api("/api/search", { body: s });
    updateSearchButton();
    pollSearch();
  } catch (e) { fail(e); }
}
async function cancelSearch() {
  if (!state.task) return;
  await api(`/api/search/${state.task.id}/cancel`, { method: "POST" }).catch(fail);
  $("#sMsg").textContent = "Stopping after the current request…";
}
let pollN = 0;
async function pollSearch() {
  if (!state.task) return;
  try { state.task = await api(`/api/search/${state.task.id}`); } catch { return; }
  const t = state.task;
  const bar = $("#sProg div");
  if (bar) bar.style.width = `${Math.round(t.progress * 100)}%`;
  if (t.status === "running") {
    if ($("#sMsg")) $("#sMsg").textContent = `${t.message} · ${t.found} found`;
    if (++pollN % 4 === 0 && $("#view-jobs").classList.contains("active") && !state.openJob) loadJobs();
    setTimeout(pollSearch, 1500);
  } else {
    toast(t.message, t.status === "error" ? "error" : "");
    updateSearchButton();
    if ($("#sMsg")) $("#sMsg").textContent = t.message;
    refreshCounts();
    if ($("#view-jobs").classList.contains("active")) loadJobs();
  }
}

/* =========================================================================
   Tracker
   ========================================================================= */
const BOARD = [["wishlist", "Saved"], ["applied", "Applied"], ["screening", "Screening"], ["interviewing", "Interviewing"], ["offer", "Offer"], ["closed", "Closed"]];

async function renderTracker() {
  const v = $("#view-tracker");
  try { state.apps = await api("/api/apps"); } catch (e) { return fail(e); }
  const mode = state.trackerMode;
  v.innerHTML = `
    <div class="page-head"><div><h1>Applications</h1><div class="sub">${state.apps.length} tracked${mode === "board" ? " · drag cards between columns to change their stage" : ""}</div></div>
      <div class="row">
        <div class="seg"><button data-mode="board" class="${mode === "board" ? "on" : ""}">Board</button><button data-mode="table" class="${mode === "table" ? "on" : ""}">Table</button></div>
        <button class="btn" id="tExport">Export CSV</button>
        <button class="btn primary" id="tNew">Add application</button>
      </div></div>
    <div id="tBody"></div>`;
  $$("[data-mode]", v).forEach((b) => (b.onclick = () => { state.trackerMode = b.dataset.mode; store.set("trackerMode", b.dataset.mode); renderTracker(); }));
  $("#tNew").onclick = () => newAppModal();
  $("#tExport").onclick = () => download("/api/export.csv");
  mode === "board" ? drawBoard() : drawTable();
}

function appCard(a) {
  const when = a.status === "wishlist" ? `Saved ${ago(a.created_at)}` : a.applied_date ? `Applied ${ago(a.applied_date)}` : STATUS[a.status];
  const next = !CLOSED.includes(a.status) && a.next_action_date ? dueLabel(a.next_action_date) : "";
  return `<div class="card" draggable="true" data-id="${a.id}">
    <div class="co"><span>${esc(a.company)}</span>${+a.priority === 1 ? `<span class="prio p1" title="High priority"></span>` : ""}</div>
    <div class="ti">${esc(a.title)}</div>
    <div class="ft"><span>${a.status && CLOSED.includes(a.status) ? statusEl(a.status) : esc(when)}</span>${next}</div>
  </div>`;
}

function drawBoard() {
  const box = $("#tBody");
  const cols = BOARD.map(([key, label]) => {
    const items = state.apps.filter((a) => (key === "closed" ? CLOSED.includes(a.status) : a.status === key))
      .sort((a, b) => (a.priority || 2) - (b.priority || 2) || (a.next_action_date || "9").localeCompare(b.next_action_date || "9"));
    return `<div class="col" data-col="${key}"><div class="col-head"><span class="${key === "closed" ? "" : "status s-" + key}">${label}</span><span class="n">${items.length}</span></div>
      <div class="col-body">${items.map(appCard).join("")}</div></div>`;
  }).join("");
  box.innerHTML = `<div class="board">${cols}</div>
    ${state.apps.length ? "" : `<div class="empty"><b>No applications yet</b>Save jobs from <a href="#jobs">Find jobs</a>, or add one you found elsewhere.</div>`}`;

  $$(".card", box).forEach((c) => {
    c.onclick = () => openApp(+c.dataset.id);
    c.ondragstart = (e) => { e.dataTransfer.setData("text/plain", c.dataset.id); c.classList.add("dragging"); };
    c.ondragend = () => c.classList.remove("dragging");
  });
  $$(".col", box).forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add("over"); };
    col.ondragleave = (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("over"); };
    col.ondrop = async (e) => {
      e.preventDefault(); col.classList.remove("over");
      const id = +e.dataTransfer.getData("text/plain");
      const a = state.apps.find((x) => x.id === id);
      let status = col.dataset.col;
      if (!a) return;
      if (status === "closed") { status = await pickOutcome(); if (!status) return; }
      if (a.status === status) return;
      try {
        const r = await api(`/api/apps/${id}`, { method: "PUT", body: { status } });
        toast(r.next_action && !CLOSED.includes(status) ? `${STATUS[status]} · next: ${r.next_action.toLowerCase()} (${fmtDate(r.next_action_date)})` : `Moved to ${STATUS[status]}`);
        renderTracker(); refreshCounts();
      } catch (err) { fail(err); }
    };
  });
}

function pickOutcome() {
  return new Promise((resolve) => {
    modal(`<div class="panel-head"><h2>How did it end?</h2></div>
      <div class="panel-body"><div class="row">${["rejected", "ghosted", "withdrawn", "accepted"].map((s) => `<button class="btn" data-o="${s}">${STATUS[s]}</button>`).join("")}</div></div>
      <div class="modal-foot"><button class="btn ghost" data-o="">Cancel</button></div>`);
    $$("[data-o]", $("#modalBox")).forEach((b) => (b.onclick = () => { closeModal(); resolve(b.dataset.o || null); }));
  });
}

function drawTable() {
  const box = $("#tBody");
  const f = state.tfilter, srt = state.tsort;
  const cols = [["company", "Company"], ["title", "Role"], ["status", "Stage"], ["applied_date", "Applied"], ["next_action", "Next step"], ["next_action_date", "Due"], ["n_contacts", "Contacts"], ["score", "Match"]];
  let list = state.apps.slice();
  if (f.status === "active") list = list.filter((a) => !CLOSED.includes(a.status));
  else if (f.status !== "all") list = list.filter((a) => a.status === f.status);
  const q = f.q.toLowerCase();
  if (q) list = list.filter((a) => [a.company, a.title, a.location, a.notes].some((x) => (x || "").toLowerCase().includes(q)));
  list.sort((a, b) => {
    const x = a[srt.key] ?? "", y = b[srt.key] ?? "";
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * srt.dir;
  });
  box.innerHTML = `
    <div class="toolbar" style="margin-top:0">
      <input type="search" id="tQ" placeholder="Search applications…" value="${esc(f.q)}">
      <select id="tS"><option value="active">Open</option><option value="all">All</option>${Object.entries(STATUS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
      <span class="spacer"></span><span class="small muted">${list.length} shown</span>
    </div>
    <div class="table-wrap"><table class="data"><thead><tr>${cols.map(([k, l]) => `<th data-k="${k}" class="${srt.key === k ? "sorted" : ""}">${l}${srt.key === k ? (srt.dir > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead>
    <tbody>${list.map((a) => `<tr data-id="${a.id}">
      <td class="primary">${esc(a.company)}</td><td>${esc(a.title)}</td><td>${statusEl(a.status)}</td>
      <td class="num nowrap">${a.applied_date ? fmtDate(a.applied_date) : '<span class="muted">–</span>'}</td>
      <td class="text-2">${esc(a.next_action || "")}</td>
      <td class="nowrap">${!CLOSED.includes(a.status) ? dueLabel(a.next_action_date) : ""}</td>
      <td class="num">${a.n_contacts || ""}</td><td>${a.score != null ? scoreEl(a.score) : ""}</td></tr>`).join("")}
    </tbody></table>
    ${list.length ? "" : `<div class="empty"><b>No applications here</b></div>`}</div>`;
  $("#tS").value = f.status;
  $("#tS").onchange = (e) => { f.status = e.target.value; drawTable(); };
  $("#tQ").oninput = debounce((e) => { f.q = e.target.value; drawTable(); $("#tQ").focus(); const i = $("#tQ"); i.setSelectionRange(i.value.length, i.value.length); }, 200);
  $$("th[data-k]", box).forEach((th) => (th.onclick = () => { srt.dir = srt.key === th.dataset.k ? -srt.dir : 1; srt.key = th.dataset.k; drawTable(); }));
  $$("tbody tr", box).forEach((tr) => (tr.onclick = () => openApp(+tr.dataset.id)));
}

/* ---------- new application */
function newAppModal() {
  modal(`<div class="panel-head"><h2>Add application</h2></div>
    <div class="panel-body"><div class="fields">
      <label class="field"><span>Company *</span><input type="text" id="nCo" autofocus></label>
      <label class="field"><span>Job title *</span><input type="text" id="nTi"></label>
      <label class="field"><span>Stage</span><select id="nSt">${["wishlist", "applied", "screening", "interviewing", "offer"].map((s) => `<option value="${s}" ${s === "applied" ? "selected" : ""}>${STATUS[s]}</option>`).join("")}</select></label>
      <label class="field"><span>Date applied</span><input type="date" id="nDa" value="${todayIso()}"></label>
      <label class="field"><span>Location</span><input type="text" id="nLo"></label>
      <label class="field"><span>Found via</span><select id="nSo">${["LinkedIn", "Company website", "Referral", "Recruiter", "Job board", "Other"].map((s) => `<option>${s}</option>`).join("")}</select></label>
      <label class="field full"><span>Job posting link</span><input type="url" id="nUr" placeholder="https://"></label>
    </div></div>
    <div class="modal-foot"><button class="btn ghost" id="nCancel">Cancel</button><button class="btn primary" id="nSave">Add</button></div>`);
  $("#nCancel").onclick = closeModal;
  $("#nSave").onclick = async () => {
    const st = $("#nSt").value;
    const body = { company: $("#nCo").value.trim(), title: $("#nTi").value.trim(), status: st, location: $("#nLo").value.trim(),
      source: $("#nSo").value, url: $("#nUr").value.trim(), applied_date: st === "wishlist" ? "" : $("#nDa").value };
    if (!body.company || !body.title) return toast("Company and job title are required.", "error");
    try { const a = await api("/api/apps", { body }); closeModal(); refreshCounts(); if (location.hash === "#tracker") renderTracker(); else if (location.hash === "#dashboard" || !location.hash) renderDashboard(); openApp(a.id); }
    catch (e) { fail(e); }
  };
}

/* =========================================================================
   Application drawer
   ========================================================================= */
let current = null;

async function openApp(id, focus) {
  try { current = await api(`/api/apps/${id}`); } catch (e) { return fail(e); }
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
  drawDrawer();
  if (focus) $(`#sec-${focus}`)?.scrollIntoView({ block: "start" });
}
function closeDrawer() {
  $("#drawer").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden", "true");
  current = null;
  const view = (location.hash || "#dashboard").slice(1);
  if (view === "tracker") renderTracker();
  if (view === "dashboard") renderDashboard();
  refreshCounts();
}
$("#drawer").addEventListener("mousedown", (e) => { if (e.target.id === "drawer") closeDrawer(); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if ($("#modal").classList.contains("open")) closeModal();
  else if ($("#drawer").classList.contains("open")) closeDrawer();
});

const EVENT_TYPES = [["note", "Note"], ["email", "Email"], ["call", "Call"], ["interview", "Interview"], ["follow-up", "Follow-up sent"], ["offer", "Offer"], ["rejection", "Rejection"]];

function drawDrawer() {
  const a = current;
  const closed = CLOSED.includes(a.status);
  const job = a.job;
  $("#drawerPanel").innerHTML = `
    <div class="drawer-head">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div style="min-width:0"><div class="co">${esc(a.company)}${a.location ? ` · ${esc(a.location)}` : ""}</div><h1 style="margin-top:2px">${esc(a.title)}</h1></div>
        <button class="btn ghost sm" id="dClose" aria-label="Close">Close</button>
      </div>
      <div class="row" style="margin-top:12px">
        <select id="dStatus" style="width:auto">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === a.status ? "selected" : ""}>${l}</option>`).join("")}</select>
        ${a.url ? `<a class="btn" target="_blank" rel="noopener" href="${esc(a.url)}">Open posting</a>` : ""}
        <span class="spacer"></span>
        <button class="btn ghost sm danger" id="dDelete">Delete</button>
      </div>
    </div>
    <div class="drawer-body">
      <section>
        <div class="section-title"><h2>Next step</h2>${a.next_action_date && !closed ? dueLabel(a.next_action_date) : ""}</div>
        <div class="row" style="flex-wrap:nowrap">
          <input type="text" data-f="next_action" value="${esc(a.next_action)}" placeholder="${closed ? "Closed" : "e.g. Follow up with recruiter"}">
          <input type="date" data-f="next_action_date" value="${esc(a.next_action_date)}" style="width:150px">
        </div>
        <div class="row" style="margin-top:8px">
          <button class="btn sm" data-snooze="2">+2 days</button><button class="btn sm" data-snooze="7">+1 week</button>
          <span class="spacer"></span>
          <button class="btn sm" id="dDone" ${a.next_action ? "" : "disabled"}>Mark done</button>
        </div>
      </section>

      <section>
        <div class="section-title"><h2>Details</h2></div>
        <div class="fields">
          <label class="field"><span>Job title</span><input type="text" data-f="title" value="${esc(a.title)}"></label>
          <label class="field"><span>Company</span><input type="text" data-f="company" value="${esc(a.company)}"></label>
          <label class="field"><span>Date applied</span><input type="date" data-f="applied_date" value="${esc(a.applied_date)}"></label>
          <label class="field"><span>Priority</span><select data-f="priority">${[[1, "High"], [2, "Medium"], [3, "Low"]].map(([v, l]) => `<option value="${v}" ${+a.priority === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="field"><span>Salary / range</span><input type="text" data-f="salary" value="${esc(a.salary)}"></label>
          <label class="field"><span>CV version sent</span><input type="text" data-f="cv_version" value="${esc(a.cv_version)}" placeholder="e.g. CV_analytics_v3.pdf"></label>
          <label class="field"><span>Location</span><input type="text" data-f="location" value="${esc(a.location)}"></label>
          <label class="field"><span>Found via</span><input type="text" data-f="source" value="${esc(a.source)}"></label>
          <label class="field full"><span>Posting link</span><input type="url" data-f="url" value="${esc(a.url)}"></label>
          <label class="field full"><span>Notes</span><textarea data-f="notes" rows="4" placeholder="Anything worth remembering — team, product, salary talks, impressions…">${esc(a.notes)}</textarea></label>
        </div>
        <div class="small muted" id="dSaved" style="margin-top:6px;height:18px"></div>
      </section>

      <section id="sec-contacts">
        <div class="section-title"><h2>Contacts</h2><button class="btn sm" id="cAdd">Add contact</button></div>
        <div id="cForm"></div>
        ${a.contacts.length ? a.contacts.map(contactRow).join("") : `<p class="small muted">Nobody yet. A referral or a note to the hiring manager noticeably raises your chance of a reply — use the searches below to find the right people.</p>`}
        <div class="link-list" style="margin-top:12px">${peopleLinks(a.company, a.title).map(([l, u]) => `<a target="_blank" rel="noopener" href="${esc(u)}">${l}</a>`).join("")}</div>
      </section>

      <section id="sec-templates">
        <div class="section-title"><h2>Message templates</h2></div>
        <div class="row" style="flex-wrap:nowrap">
          <select id="tplSel">${TEMPLATES.map((t, i) => `<option value="${i}">${t.name}</option>`).join("")}</select>
          <select id="tplTo" style="width:200px">${a.contacts.length ? a.contacts.map((c) => `<option value="${c.id}">To ${esc(c.name)}</option>`).join("") : `<option value="">No contact</option>`}</select>
        </div>
        <div class="copy-box" id="tplOut" style="margin-top:8px"></div>
      </section>

      <section>
        <div class="section-title"><h2>Activity</h2></div>
        <div class="row" style="flex-wrap:nowrap;margin-bottom:14px">
          <input type="date" id="eDate" value="${todayIso()}" style="width:150px">
          <select id="eType" style="width:150px">${EVENT_TYPES.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
          <input type="text" id="eText" placeholder="What happened?">
          <button class="btn" id="eAdd">Log</button>
        </div>
        <ul class="timeline">${a.events.map((ev) => `<li class="t-${esc(ev.type)}"><span class="when">${fmtDate(ev.date)}</span> · <span class="muted">${esc((EVENT_TYPES.find((t) => t[0] === ev.type) || [0, ev.type === "status" ? "Stage" : ev.type === "created" ? "Created" : ev.type === "contact" ? "Contact" : ev.type])[1])}</span>
          <button class="btn ghost sm del" data-ev="${ev.id}" title="Delete">Delete</button><br>${esc(ev.summary)}</li>`).join("")}</ul>
      </section>

      ${job?.description ? `<section><details><summary style="cursor:pointer"><h2 style="display:inline">Job description</h2></summary><div class="desc" style="margin-top:10px">${esc(job.description)}</div></details></section>` : ""}
    </div>`;

  const panel = $("#drawerPanel");
  $("#dClose").onclick = closeDrawer;
  $("#dStatus").onchange = async (e) => {
    try {
      current = await api(`/api/apps/${a.id}`, { method: "PUT", body: { status: e.target.value } });
      toast(current.next_action && !CLOSED.includes(current.status) ? `Next: ${current.next_action}` : `Moved to ${STATUS[current.status]}`);
      drawDrawer();
    } catch (err) { fail(err); }
  };
  $("#dDelete").onclick = async () => {
    if (!confirm(`Delete ${a.company} — ${a.title}? Contacts and activity for it are deleted too.`)) return;
    await api(`/api/apps/${a.id}`, { method: "DELETE" }).catch(fail);
    closeDrawer();
  };
  const save = async (field, value) => {
    try {
      current = await api(`/api/apps/${a.id}`, { method: "PUT", body: { [field]: value } });
      $("#dSaved").textContent = "Saved";
      setTimeout(() => { const s = $("#dSaved"); if (s) s.textContent = ""; }, 1500);
      if (field === "next_action_date" || field === "next_action") drawDrawerKeepScroll();
    } catch (err) { fail(err); }
  };
  $$("[data-f]", panel).forEach((inp) => inp.addEventListener("change", () => save(inp.dataset.f, inp.dataset.f === "priority" ? +inp.value : inp.value)));
  $$("[data-snooze]", panel).forEach((b) => (b.onclick = () => {
    const base = a.next_action_date && daysFrom(a.next_action_date) > 0 ? new Date(a.next_action_date + "T00:00:00") : TODAY();
    base.setDate(base.getDate() + +b.dataset.snooze);
    save("next_action_date", iso(base));
  }));
  $("#dDone").onclick = async () => {
    try {
      await api(`/api/apps/${a.id}/events`, { body: { type: "note", summary: `Done: ${a.next_action}` } });
      current = await api(`/api/apps/${a.id}`, { method: "PUT", body: { next_action: "", next_action_date: "" } });
      drawDrawerKeepScroll();
    } catch (err) { fail(err); }
  };

  // contacts
  $("#cAdd").onclick = () => contactForm();
  $$("[data-c-edit]", panel).forEach((b) => (b.onclick = () => contactForm(a.contacts.find((c) => c.id === +b.dataset.cEdit))));
  $$("[data-c-del]", panel).forEach((b) => (b.onclick = async () => {
    if (!confirm("Remove this contact?")) return;
    current = await api(`/api/contacts/${b.dataset.cDel}`, { method: "DELETE" }).catch(fail); drawDrawerKeepScroll();
  }));
  $$("[data-c-touch]", panel).forEach((b) => (b.onclick = async () => {
    try {
      current = await api(`/api/contacts/${b.dataset.cTouch}`, { method: "PUT", body: { log_touch: true, next_contact_date: closed ? "" : plusDays(7) } });
      toast("Logged — reminder set for one week from today");
      drawDrawerKeepScroll();
    } catch (err) { fail(err); }
  }));
  $$("[data-c-next]", panel).forEach((inp) => (inp.onchange = async () => {
    current = await api(`/api/contacts/${inp.dataset.cNext}`, { method: "PUT", body: { next_contact_date: inp.value } }).catch(fail);
  }));

  // templates
  const drawTpl = () => {
    const t = TEMPLATES[+$("#tplSel").value];
    const c = a.contacts.find((x) => x.id === +$("#tplTo").value);
    const text = t.body(ctx(a, c));
    $("#tplOut").innerHTML = `${esc(text)}<button class="btn sm" id="tplCopy">Copy</button>`;
    $("#tplCopy").onclick = (e) => copyText(text, e.target);
  };
  $("#tplSel").onchange = drawTpl; $("#tplTo").onchange = drawTpl;
  drawTpl();

  // events
  $("#eAdd").onclick = async () => {
    const summary = $("#eText").value.trim();
    if (!summary) return $("#eText").focus();
    try { current = await api(`/api/apps/${a.id}/events`, { body: { date: $("#eDate").value, type: $("#eType").value, summary } }); drawDrawerKeepScroll(); }
    catch (err) { fail(err); }
  };
  $("#eText").onkeydown = (e) => { if (e.key === "Enter") $("#eAdd").click(); };
  $$("[data-ev]", panel).forEach((b) => (b.onclick = async () => { current = await api(`/api/events/${b.dataset.ev}`, { method: "DELETE" }).catch(fail); drawDrawerKeepScroll(); }));
}
function drawDrawerKeepScroll() { const p = $("#drawerPanel"), y = p.scrollTop; drawDrawer(); p.scrollTop = y; }

function contactRow(c) {
  return `<div class="contact">
    <div style="min-width:0">
      <div class="nm">${esc(c.name)}${c.role ? ` <span class="text-2" style="font-weight:400">· ${esc(c.role)}</span>` : ""}</div>
      <div class="meta">
        ${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ""}
        ${c.linkedin ? `<a target="_blank" rel="noopener" href="${esc(/^http/.test(c.linkedin) ? c.linkedin : "https://" + c.linkedin)}">LinkedIn</a>` : ""}
        ${c.phone ? `<span>${esc(c.phone)}</span>` : ""}
        <span>${c.last_contacted ? `Last contact ${fmtDate(c.last_contacted)}` : "Not contacted yet"}</span>
      </div>
      ${c.notes ? `<div class="small text-2" style="margin-top:4px">${esc(c.notes)}</div>` : ""}
      <div class="row small" style="margin-top:8px"><span class="muted">Next contact</span>
        <input type="date" data-c-next="${c.id}" value="${esc(c.next_contact_date)}" style="width:150px;height:28px"> ${c.next_contact_date ? dueLabel(c.next_contact_date) : ""}</div>
    </div>
    <div class="row" style="align-items:flex-start;flex-wrap:nowrap">
      <button class="btn sm" data-c-touch="${c.id}" title="Record that you reached out today">Log contact</button>
      <button class="btn sm ghost" data-c-edit="${c.id}">Edit</button>
      <button class="btn sm ghost" data-c-del="${c.id}">Remove</button>
    </div>
  </div>`;
}

function contactForm(c = {}) {
  const box = $("#cForm");
  box.innerHTML = `<div class="panel" style="margin-bottom:10px"><div class="panel-body"><div class="fields">
    <label class="field"><span>Name *</span><input type="text" id="cfName" value="${esc(c.name)}"></label>
    <label class="field"><span>Role</span><input type="text" id="cfRole" value="${esc(c.role)}" placeholder="Recruiter, hiring manager, referral…"></label>
    <label class="field"><span>Email</span><input type="email" id="cfEmail" value="${esc(c.email)}"></label>
    <label class="field"><span>LinkedIn URL</span><input type="url" id="cfLi" value="${esc(c.linkedin)}"></label>
    <label class="field"><span>Phone</span><input type="text" id="cfPhone" value="${esc(c.phone)}"></label>
    <label class="field"><span>Next contact</span><input type="date" id="cfNext" value="${esc(c.next_contact_date)}"></label>
    <label class="field full"><span>Notes</span><input type="text" id="cfNotes" value="${esc(c.notes)}" placeholder="How you know them, what you discussed"></label>
  </div><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" id="cfCancel">Cancel</button><button class="btn primary" id="cfSave">${c.id ? "Save" : "Add contact"}</button></div></div></div>`;
  $("#cfName").focus();
  $("#cfCancel").onclick = () => (box.innerHTML = "");
  $("#cfSave").onclick = async () => {
    const body = { name: $("#cfName").value.trim(), role: $("#cfRole").value.trim(), email: $("#cfEmail").value.trim(), linkedin: $("#cfLi").value.trim(),
      phone: $("#cfPhone").value.trim(), next_contact_date: $("#cfNext").value, notes: $("#cfNotes").value.trim() };
    if (!body.name) return toast("Name is required.", "error");
    try {
      current = c.id ? await api(`/api/contacts/${c.id}`, { method: "PUT", body }) : await api(`/api/apps/${current.id}/contacts`, { body });
      drawDrawerKeepScroll();
    } catch (err) { fail(err); }
  };
}

/* ---------- message templates */
function ctx(a, c) {
  const p = state.profile || {};
  const first = c?.name ? c.name.split(" ")[0] : "";
  const skills = (p.skills || []).slice(0, 3);
  return {
    hi: first ? `Hi ${first},` : "Hello,",
    me: p.name || "[Your name]",
    role: a.title, company: a.company,
    myRole: p.current_title || "[your current role]",
    years: p.years_experience ? `${Math.round(p.years_experience)} years` : "[X] years",
    skills: skills.length ? skills.join(", ").replace(/, ([^,]*)$/, " and $1") : "[your key skills]",
    applied: a.applied_date ? fmtDate(a.applied_date) : "recently",
    phone: p.phone || "", email: p.email || "",
  };
}
const sign = (x) => `Best regards,\n${x.me}${x.phone ? "\n" + x.phone : ""}${x.email ? "\n" + x.email : ""}`;
const TEMPLATES = [
  { name: "Follow up after applying", body: (x) => `Subject: ${x.role} application — ${x.me}\n\n${x.hi}\n\nI applied for the ${x.role} position at ${x.company} on ${x.applied} and wanted to follow up. I'm very interested in the role — my ${x.years} as ${/^[aeiou]/i.test(x.myRole) ? "an" : "a"} ${x.myRole} working with ${x.skills} line up closely with what the team is looking for.\n\nIs there anything else I can share to help with the review? I'd welcome a short call whenever convenient.\n\n${sign(x)}` },
  { name: "Connection request (LinkedIn, short)", body: (x) => `${x.hi} I've just applied for the ${x.role} role at ${x.company}. I bring ${x.years} in ${x.skills} and would value connecting — happy to share more about how I could help the team. Thanks, ${x.me.split(" ")[0]}` },
  { name: "Ask for a referral", body: (x) => `${x.hi}\n\nI noticed you work at ${x.company} and saw an opening for a ${x.role}. I have ${x.years} as ${/^[aeiou]/i.test(x.myRole) ? "an" : "a"} ${x.myRole}, mostly around ${x.skills}, and the role looks like a strong fit.\n\nWould you be open to a quick chat about the team, or to referring me if you think it makes sense? I'm happy to send my CV and a short summary to make it easy.\n\nThank you either way,\n${x.me}` },
  { name: "Thank you after interview", body: (x) => `Subject: Thank you — ${x.role} interview\n\n${x.hi}\n\nThank you for your time today. I enjoyed learning more about [specific topic you discussed] and how the team at ${x.company} approaches it.\n\nOur conversation confirmed my interest in the ${x.role} role — particularly [one thing that excited you]. I'm confident my experience with ${x.skills} would let me contribute quickly.\n\nPlease let me know if I can provide anything further.\n\n${sign(x)}` },
  { name: "Status check after interview", body: (x) => `Subject: ${x.role} — following up\n\n${x.hi}\n\nI hope you're well. I wanted to check in on the ${x.role} position following my interview. I remain very interested in joining ${x.company} and would be glad to hear about next steps or the expected timeline.\n\n${sign(x)}` },
  { name: "Accept an offer", body: (x) => `Subject: Offer acceptance — ${x.role}\n\n${x.hi}\n\nThank you for the offer for the ${x.role} position. I'm delighted to accept, and I'm looking forward to joining ${x.company}.\n\nPlease let me know the next steps and any documents you need from me. I confirm my start date as [date].\n\n${sign(x)}` },
  { name: "Decline politely", body: (x) => `Subject: ${x.role} — thank you\n\n${x.hi}\n\nThank you for the offer and for the time you and the team spent with me. After careful consideration, I have decided to decline the ${x.role} position, as I've accepted a role that aligns more closely with my current goals.\n\nI have a lot of respect for ${x.company} and hope our paths cross again.\n\n${sign(x)}` },
];

/* =========================================================================
   Settings
   ========================================================================= */
function renderSettings() {
  const v = $("#view-settings");
  const s = state.settings;
  const theme = store.get("theme", "dark");
  v.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1></div></div>
    <div class="stack" style="max-width:720px">
      <div class="panel"><div class="panel-head"><h2>Account</h2></div>
        <div class="panel-body row"><span class="text-2">Signed in as <b style="color:var(--text);font-weight:500">${esc(s.email)}</b></span><span class="spacer"></span>
          <button class="btn" id="signOut">Sign out</button></div></div>
      <div class="panel"><div class="panel-head"><h2>Claude analysis</h2><span class="small ${s.has_key ? "" : "muted"}">${s.has_key ? "Enabled" : "Not set up"}</span></div>
        <div class="panel-body">
          <p class="text-2" style="margin:0">Optional. With Claude, profile analysis is more accurate and each job gets a fit analysis, CV edits, a connection note and a cover letter. Without it, the built-in analyser is used. Usage is billed to your Anthropic account — typically a few cents per profile or job.</p>
          ${s.has_key ? "" : `<p class="small muted" style="margin:10px 0 0">To enable it, add <code>ANTHROPIC_API_KEY</code> under Vercel → your project → Settings → Environment Variables, then redeploy.</p>`}
        </div></div>
      <div class="panel"><div class="panel-head"><h2>Appearance</h2></div><div class="panel-body">
        <div class="seg">${[["dark", "Dark"], ["light", "Light"], ["system", "Match device"]].map(([k, l]) => `<button data-theme="${k}" class="${theme === k ? "on" : ""}">${l}</button>`).join("")}</div>
      </div></div>
      <div class="panel"><div class="panel-head"><h2>Your data</h2></div><div class="panel-body">
        <p class="text-2">Your data is saved to your account and synced across every device you sign in on. A backup file is still worth keeping now and then.</p>
        <div class="row">
          <button class="btn" data-dl="/api/export.csv">Export applications (CSV)</button>
          <button class="btn" data-dl="/api/backup.json">Download full backup</button>
          <label class="btn">Restore backup<input type="file" id="rFile" accept=".json" hidden></label>
          <span class="spacer"></span>
          <button class="btn ghost danger" id="clrJobs">Clear search results</button>
        </div>
      </div></div>
      <div class="panel"><div class="panel-head"><h2>About job search</h2></div><div class="panel-body text-2">
        <p>Jobs come from LinkedIn's public job listings, the same pages anyone can view without signing in. No LinkedIn login is used or stored. Searches are deliberately paced; if LinkedIn starts limiting requests, the search stops early and keeps what it found — wait 10–15 minutes before running another.</p>
        <p style="margin:0">Automated collection may conflict with LinkedIn's terms of use. Keep searches to personal use and a sensible volume.</p>
      </div></div>
    </div>`;
  $("#signOut").onclick = async () => { await backend.signOut(); location.hash = ""; location.reload(); };
  $$("[data-dl]", v).forEach((b) => (b.onclick = () => download(b.dataset.dl)));
  $$("[data-theme]", v).forEach((b) => (b.onclick = () => { store.set("theme", b.dataset.theme); applyTheme(); renderSettings(); }));
  $("#rFile").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f || !confirm("Restoring replaces all current applications, contacts and jobs with the backup. Continue?")) return;
    const fd = new FormData(); fd.append("file", f);
    try { await api("/api/restore", { body: fd }); toast("Backup restored"); await boot(); } catch (err) { fail(err); }
  };
  $("#clrJobs").onclick = async () => {
    if (!confirm("Remove all search results that aren't saved to your applications?")) return;
    await api("/api/jobs", { method: "DELETE" }).catch(fail); toast("Search results cleared"); refreshCounts();
  };
}

function applyTheme() {
  const t = store.get("theme", "dark");
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

/* =========================================================================
   Modal & boot
   ========================================================================= */
function modal(html) {
  $("#modalBox").innerHTML = html;
  $("#modal").classList.add("open");
  $("#modal").setAttribute("aria-hidden", "false");
  setTimeout(() => $("#modalBox [autofocus]")?.focus(), 20);
}
function closeModal() { $("#modal").classList.remove("open"); $("#modal").setAttribute("aria-hidden", "true"); }
$("#modal").addEventListener("mousedown", (e) => { if (e.target.id === "modal") closeModal(); });

async function boot() {
  applyTheme();
  try {
    const [p, s, running] = await Promise.all([api("/api/profile"), api("/api/settings"), api("/api/search/current")]);
    state.profile = p.profile; state.sources = p.sources || {}; state.settings = s;
    if (running?.id) { state.task = running; pollSearch(); }
  } catch (e) { fail(e); }
  route();
  refreshCounts();
}

/* ---------- sign-in gate */
function gate(html) {
  document.body.classList.add("gated");
  $("#gate").innerHTML = `<div class="gate-box"><div class="brand" style="padding:0 0 20px">JobHunt</div>${html}</div>`;
}
function showSetup() {
  gate(`<h1>Almost there</h1>
    <p class="text-2" style="margin-top:8px">The app is running, but it isn't connected to a database yet. In Vercel, open your project → Settings → Environment Variables and add <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code>, then redeploy. The README walks through it.</p>`);
}
function showLogin() {
  gate(`<h1>Sign in</h1>
    <form id="loginForm" class="stack" style="margin-top:18px">
      <label class="field"><span>Email</span><input type="email" id="lgEmail" autocomplete="username" required autofocus></label>
      <label class="field"><span>Password</span><input type="password" id="lgPass" autocomplete="current-password" required></label>
      <div class="small" id="lgErr" style="color:var(--red);min-height:18px"></div>
      <button class="btn primary" style="width:100%;justify-content:center;height:36px" id="lgBtn">Sign in</button>
    </form>
    <p class="small muted" style="margin-top:18px">Accounts are created in your Supabase project (Authentication → Users).</p>`);
  $("#lgEmail").focus();
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("#lgBtn");
    btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
    try {
      await backend.signIn($("#lgEmail").value.trim(), $("#lgPass").value);
      document.body.classList.remove("gated");
      $("#gate").innerHTML = "";
      await boot();
    } catch (err) {
      $("#lgErr").textContent = navigator.onLine ? err.message : "You're offline. Connect to sign in.";
      btn.disabled = false; btn.textContent = "Sign in";
    }
  };
}

window.addEventListener("jh-offline", (e) => $("#offlineBar").classList.toggle("hidden", !e.detail));
window.addEventListener("online", () => { if (!document.body.classList.contains("gated")) route(); });

async function start() {
  applyTheme();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  if (!(await backend.init())) return showSetup();
  if (!(await backend.session())) return showLogin();
  boot();
}
start();
