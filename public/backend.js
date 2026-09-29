// Data layer. The UI calls handle("GET", "/api/apps") etc.; this file answers from Supabase
// (synced storage), runs job searches through the /api server functions, and keeps an
// offline copy of the last data seen so the app still opens without a connection.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { analyzeBuiltin, scoreJob } from "./analyzer.js";

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

export let sb = null;
export let config = { ai: false };
export const net = { offline: false };

const STATUS_LABEL = { wishlist: "Saved", applied: "Applied", screening: "Screening", interviewing: "Interviewing",
  offer: "Offer", accepted: "Accepted", rejected: "Rejected", withdrawn: "Withdrawn", ghosted: "No response" };
const STATUSES = Object.keys(STATUS_LABEL);
const CLOSED = new Set(["accepted", "rejected", "withdrawn", "ghosted"]);
const RESPONDED = new Set(["screening", "interviewing", "offer", "accepted", "rejected"]);
const JOB_FIELDS = ["title", "company", "company_url", "location", "posted_date", "posted_text", "url", "apply_url", "logo",
  "salary", "description", "seniority", "employment_type", "job_function", "industries", "applicants", "poster_name",
  "poster_title", "poster_url", "query"];
const APP_FIELDS = ["job_id", "title", "company", "location", "url", "source", "status", "applied_date", "salary", "priority",
  "cv_version", "next_action", "next_action_date", "notes"];
const CONTACT_FIELDS = ["name", "role", "email", "linkedin", "phone", "notes", "last_contacted", "next_contact_date"];

/* ------------------------------------------------------------------ setup & auth */
export async function init() {
  try {
    config = await fetch("/api/config", { cache: "no-store" }).then((r) => r.json());
    localStorage.setItem("jh-config", JSON.stringify(config));
  } catch {
    try { config = JSON.parse(localStorage.getItem("jh-config")) || config; } catch { /* no cached config */ }
  }
  if (config.mock) { // local `npm run dev` without a Supabase project
    sb = (await import("/dev/mock-supabase.js")).createMockClient();
    return true;
  }
  if (!config.supabaseUrl || !config.supabaseKey) return false;
  sb = createClient(config.supabaseUrl, config.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
  return true;
}
export async function session() { return (await sb.auth.getSession()).data.session; }
export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === "Invalid login credentials" ? "Email or password is incorrect." : error.message);
}
export async function signOut() { await sb.auth.signOut(); await cache.clear(); }

/* ------------------------------------------------------------------ helpers */
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const plusDays = (n, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return iso(d); };
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

class HttpError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
const isNetworkError = (e) => !navigator.onLine || /failed to fetch|networkerror|load failed|network request failed/i.test(String(e?.message || e));

async function q(builder) {
  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  return data;
}

async function server(path, body) {
  const s = await session();
  let r;
  try {
    r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s?.access_token || ""}` }, body: JSON.stringify(body) });
  } catch (e) { throw new HttpError("You're offline. Connect to the internet and try again.", 0); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(data.error || `Server error (${r.status})`, r.status);
  return data;
}

/* offline copy of GET results, in IndexedDB */
const cache = {
  db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open("jobhunt", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async tx(mode, fn) {
    try {
      const db = await this.open();
      return await new Promise((res, rej) => {
        const t = db.transaction("kv", mode);
        const out = fn(t.objectStore("kv"));
        t.oncomplete = () => res(out?.result);
        t.onerror = () => rej(t.error);
      });
    } catch { return undefined; }
  },
  get(k) { return this.tx("readonly", (s) => s.get(k)); },
  set(k, v) { return this.tx("readwrite", (s) => s.put(v, k)); },
  clear() { return this.tx("readwrite", (s) => s.clear()); },
};

function setOffline(v) {
  if (net.offline !== v) { net.offline = v; window.dispatchEvent(new CustomEvent("jh-offline", { detail: v })); }
}

/* ------------------------------------------------------------------ router */
const routes = [];
const on = (method, pattern, fn) => routes.push([method, new RegExp(`^${pattern}$`), fn]);

export async function handle(method, url, body) {
  const [path, qs] = url.split("?");
  const params = Object.fromEntries(new URLSearchParams(qs || ""));
  for (const [m, re, fn] of routes) {
    const match = m === method && path.match(re);
    if (!match) continue;
    if (method !== "GET") {
      if (!navigator.onLine) throw new Error("You're offline. Changes can be made again once you're connected.");
      return fn({ args: match.slice(1), params, body });
    }
    const cacheable = !/^\/api\/(search|export|backup)/.test(path);
    try {
      const out = await fn({ args: match.slice(1), params, body });
      setOffline(false);
      if (cacheable) cache.set(url, out);
      return out;
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      const saved = await cache.get(url);
      setOffline(true);
      if (saved !== undefined) return saved;
      throw new Error("You're offline and this page hasn't been saved on this device yet.");
    }
  }
  throw new Error(`Unknown request ${method} ${path}`);
}

/* ------------------------------------------------------------------ settings & profile */
on("GET", "/api/settings", async () => ({ has_key: Boolean(config.ai), ai_name: config.aiName || "", email: (await session())?.user?.email || "" }));

async function getProfileRow() {
  return q(sb.from("profiles").select("*").maybeSingle());
}
on("GET", "/api/profile", async () => {
  const row = await getProfileRow();
  return { profile: row?.data || null, sources: row?.sources || {} };
});
on("PUT", "/api/profile", async ({ body }) => {
  await q(sb.from("profiles").upsert({ data: body, updated_at: now() }, { onConflict: "user_id" }));
  return { profile: body };
});

async function pdfText(file) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  let doc;
  try { doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; }
  catch (e) { throw new Error(`Could not read ${file.name}. Is it a valid, unprotected PDF?`); }
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let s = "", lastX = null, lastW = 0, lastY = null;
    for (const it of content.items) {
      if (!("str" in it)) continue;
      const [x, y] = [it.transform[4], it.transform[5]];
      if (lastY !== null && Math.abs(y - lastY) > 2 && !s.endsWith("\n")) s += "\n";
      else if (lastX !== null && x - (lastX + lastW) > 1.5 && !s.endsWith(" ") && !it.str.startsWith(" ")) s += " ";
      s += it.str;
      if (it.hasEOL) s += "\n";
      lastX = x; lastW = it.width; lastY = y;
    }
    pages.push(s);
  }
  return pages.join("\n").replace(/ /g, " ").replace(/Page \d+ of \d+/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

on("POST", "/api/profile/analyze", async ({ body }) => {
  const fd = body;
  let cvText = "", liText = "";
  const sources = {};
  if (fd.get("cv")) { cvText = await pdfText(fd.get("cv")); sources.cv = fd.get("cv").name; }
  if (fd.get("linkedin")) { liText = await pdfText(fd.get("linkedin")); sources.linkedin = fd.get("linkedin").name; }
  const pasted = String(fd.get("text") || "").trim();
  if (pasted) { cvText = `${cvText}\n\n${pasted}`.trim(); sources.pasted = true; }
  const prev = await getProfileRow();
  if (!cvText && !liText) {
    cvText = prev?.cv_text || ""; liText = prev?.li_text || "";
    Object.assign(sources, prev?.sources || {});
    if (!cvText && !liText) throw new Error("Upload a CV PDF, a LinkedIn profile PDF, or paste your CV text.");
  } else {
    // keep the other document if only one was re-uploaded
    if (!fd.get("cv") && !pasted && prev?.cv_text) { cvText = prev.cv_text; if (prev.sources?.cv) sources.cv = prev.sources.cv; }
    if (!fd.get("linkedin") && prev?.li_text) { liText = prev.li_text; if (prev.sources?.linkedin) sources.linkedin = prev.sources.linkedin; }
  }
  if (cvText.length + liText.length < 80) throw new Error("Very little text could be read. If your PDF is a scanned image, paste the text instead.");

  let profile, warning = null;
  if (fd.get("use_ai") === "true" && config.ai) {
    try { profile = (await server("/api/analyze", { cv_text: cvText, li_text: liText })).profile; }
    catch (e) { warning = `AI analysis failed (${e.message}) — used the built-in analyser instead.`; }
  }
  profile ||= analyzeBuiltin(cvText, liText);
  profile.analyzed_at = now();
  await q(sb.from("profiles").upsert({ data: profile, cv_text: cvText, li_text: liText, sources, updated_at: now() }, { onConflict: "user_id" }));
  return { profile, sources, warning };
});

/* ------------------------------------------------------------------ jobs */
async function trackedMap() {
  const apps = await q(sb.from("applications").select("id, job_id, status").not("job_id", "is", null));
  return new Map(apps.map((a) => [a.job_id, a]));
}

on("GET", "/api/jobs", async ({ params }) => {
  const [rows, tracked] = await Promise.all([
    q(sb.from("jobs").select("*").eq("hidden", params.hidden === "1")
      .order("score", { ascending: false, nullsFirst: false }).order("posted_date", { ascending: false }).limit(1000)),
    trackedMap(),
  ]);
  return rows.map((j) => ({ ...j, app_id: tracked.get(j.id)?.id || null, app_status: tracked.get(j.id)?.status || null }));
});

async function rescore(ids = null) {
  const row = await getProfileRow();
  const profile = row?.data;
  if (!profile) return;
  let jobs = [];
  if (ids) for (const c of chunks(ids, 150)) jobs.push(...await q(sb.from("jobs").select("id, title, description, seniority").in("id", c)));
  else jobs = await q(sb.from("jobs").select("id, title, description, seniority").limit(2000));
  const rows = jobs.map((j) => { const m = scoreJob(profile, j); return { id: j.id, score: m.score, match: m }; });
  for (const c of chunks(rows, 200)) await q(sb.from("jobs").upsert(c, { onConflict: "user_id,id" }));
}
on("POST", "/api/jobs/rescore", async () => { await rescore(); return { ok: true }; });

on("POST", "/api/jobs/(\\d+)/hide", async ({ args: [id] }) => {
  const j = await q(sb.from("jobs").select("hidden").eq("id", id).single());
  await q(sb.from("jobs").update({ hidden: !j.hidden }).eq("id", id));
  return { ok: true };
});

async function saveDetail(id, detail) {
  const vals = Object.fromEntries(JOB_FIELDS.filter((k) => detail[k]).map((k) => [k, detail[k]]));
  if (Object.keys(vals).length) await q(sb.from("jobs").update({ ...vals, updated_at: now() }).eq("id", id));
}

on("POST", "/api/jobs/(\\d+)/refresh", async ({ args: [id] }) => {
  const { job } = await server("/api/job", { id });
  await saveDetail(id, job);
  await rescore([id]);
  return q(sb.from("jobs").select("*").eq("id", id).single());
});

on("POST", "/api/jobs/(\\d+)/tailor", async ({ args: [id] }) => {
  if (!config.ai) throw new Error("AI isn't set up yet — see Settings.");
  const prof = await getProfileRow();
  if (!prof?.data) throw new Error("Analyse your CV or LinkedIn profile first.");
  let job = await q(sb.from("jobs").select("*").eq("id", id).single());
  if (!job.description) { const d = (await server("/api/job", { id })).job; await saveDetail(id, d); job = { ...job, ...d }; }
  const { tailor } = await server("/api/tailor", { profile: prof.data, job, cv_text: prof.cv_text || "" });
  await q(sb.from("jobs").update({ tailor }).eq("id", id));
  return tailor;
});

on("DELETE", "/api/jobs", async () => {
  const keep = [...(await trackedMap()).keys()];
  let del = sb.from("jobs").delete().not("id", "is", null);
  if (keep.length) del = del.not("id", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
  await q(del);
  return { ok: true };
});

/* ------------------------------------------------------------------ search (runs in the browser, paced) */
const tasks = {};

async function runSearch(t, p) {
  const queries = p.queries.map((s) => s.trim()).filter(Boolean);
  const locations = p.locations.map((s) => s.trim()).filter(Boolean);
  const locs = locations.length ? locations : [""];
  const perQuery = Math.max(10, Math.min(+p.per_query || 30, 200));
  const found = new Map();
  const pause = () => sleep(1200 + Math.random() * 1400);
  const detailsWanted = p.fetch_details !== false;
  try {
    const combos = queries.flatMap((qq) => locs.map((l) => [qq, l]));
    for (const [ci, [kw, loc]] of combos.entries()) {
      let got = 0, start = 0;
      while (got < perQuery && !t.cancel) {
        t.message = `Searching “${kw}”${loc ? ` in ${loc}` : ""} — page ${start / 10 + 1}`;
        const { jobs } = await server("/api/search", { keywords: kw, location: loc, start, date_posted: p.date_posted,
          work_types: p.work_types, experience: p.experience, job_types: p.job_types, sort: p.sort });
        if (!jobs.length) break;
        const fresh = jobs.filter((j) => !found.has(j.id));
        fresh.forEach((j) => found.set(j.id, { ...j, query: kw }));
        if (fresh.length) {
          const existing = new Set((await q(sb.from("jobs").select("id").in("id", fresh.map((j) => j.id)))).map((r) => r.id));
          const rows = fresh.filter((j) => !existing.has(j.id)).map((j) => ({ ...Object.fromEntries(JOB_FIELDS.map((k) => [k, j[k] ?? null])), id: j.id, query: kw }));
          if (rows.length) await q(sb.from("jobs").insert(rows));
        }
        got += jobs.length;
        t.found = found.size;
        start += 10;
        await pause();
        if (!fresh.length && jobs.length < 10) break;
      }
      t.progress = ((ci + 1) / combos.length) * (detailsWanted ? 0.35 : 1);
      if (t.cancel) break;
    }

    const ids = [...found.keys()];
    if (detailsWanted && ids.length && !t.cancel) {
      const have = new Set();
      for (const c of chunks(ids, 150)) (await q(sb.from("jobs").select("id").in("id", c).not("description", "is", null))).forEach((r) => have.add(r.id));
      const todo = ids.filter((i) => !have.has(i));
      const profile = (await getProfileRow())?.data;
      for (const [n, id] of todo.entries()) {
        if (t.cancel) break;
        const j = found.get(id);
        t.message = `Reading job details ${n + 1}/${todo.length}: ${j.title} @ ${j.company}`;
        try {
          const { job } = await server("/api/job", { id });
          await saveDetail(id, job);
          if (profile) { const m = scoreJob(profile, { ...j, ...job }); await q(sb.from("jobs").update({ score: m.score, match: m }).eq("id", id)); }
        } catch (e) { if (e.status === 429 || e.status === 0) throw e; /* a closed posting: skip */ }
        t.progress = 0.35 + 0.65 * (n + 1) / todo.length;
        await pause();
      }
    }
    if (ids.length) await rescore(ids);
    t.status = t.cancel ? "cancelled" : "done";
    t.message = `${t.cancel ? "Stopped" : "Done"} — ${found.size} jobs found.`;
  } catch (e) {
    if (found.size) await rescore([...found.keys()]).catch(() => {});
    if (e.status === 429) {
      t.status = "done";
      t.message = `LinkedIn started limiting requests, so the search stopped early with ${found.size} jobs. Wait 10–15 minutes before searching again.`;
    } else {
      t.status = "error";
      t.message = `Search stopped: ${e.message}`;
    }
  }
  t.progress = 1;
}

on("POST", "/api/search", async ({ body }) => {
  if (!body.queries?.some((s) => s.trim())) throw new Error("Add at least one job title or keyword to search for.");
  if (Object.values(tasks).some((t) => t.status === "running")) throw new Error("A search is already running.");
  const id = Math.random().toString(36).slice(2, 10);
  const t = tasks[id] = { id, status: "running", progress: 0, found: 0, message: "Starting…", cancel: false };
  runSearch(t, body);
  return { ...t };
});
on("GET", "/api/search/current", async () => ({ ...(Object.values(tasks).find((t) => t.status === "running") || {}) }));
on("GET", "/api/search/(\\w+)", async ({ args: [id] }) => {
  if (!tasks[id]) throw new Error("Unknown search");
  return { ...tasks[id] };
});
on("POST", "/api/search/(\\w+)/cancel", async ({ args: [id] }) => { if (tasks[id]) tasks[id].cancel = true; return { ok: true }; });

/* ------------------------------------------------------------------ applications */
function statusRules(old, next, data) {
  const u = {};
  if (next === "applied") {
    const applied = data.applied_date || today();
    if (!data.applied_date) u.applied_date = applied;
    const due = new Date(`${applied}T00:00:00`);
    due.setDate(due.getDate() + 7);
    u.next_action = "Follow up if no reply";
    u.next_action_date = iso(due) > today() ? iso(due) : today();
  } else if (next === "screening") {
    Object.assign(u, { next_action: "Prepare for recruiter screen: pitch, salary range, availability", next_action_date: plusDays(2) });
  } else if (next === "interviewing") {
    Object.assign(u, { next_action: "Send thank-you note within 24h of each interview", next_action_date: plusDays(1) });
  } else if (next === "offer") {
    Object.assign(u, { next_action: "Review offer & negotiate — reply by deadline", next_action_date: plusDays(3) });
  } else if (CLOSED.has(next)) {
    Object.assign(u, { next_action: "", next_action_date: "" });
  }
  return u;
}
const addEvent = (application_id, type, summary, date = today()) => q(sb.from("events").insert({ application_id, type, summary, date }));

async function appFull(id) {
  const [a, contacts, events] = await Promise.all([
    q(sb.from("applications").select("*").eq("id", id).maybeSingle()),
    q(sb.from("contacts").select("*").eq("application_id", id).order("id")),
    q(sb.from("events").select("*").eq("application_id", id).order("date", { ascending: false }).order("id", { ascending: false })),
  ]);
  if (!a) throw new Error("Application not found.");
  a.contacts = contacts;
  a.events = events;
  a.job = a.job_id ? await q(sb.from("jobs").select("*").eq("id", a.job_id).maybeSingle()) : null;
  return a;
}

on("GET", "/api/apps", async () => {
  const [apps, contacts] = await Promise.all([
    q(sb.from("applications").select("*").order("updated_at", { ascending: false })),
    q(sb.from("contacts").select("application_id, next_contact_date")),
  ]);
  const jobIds = apps.map((a) => a.job_id).filter(Boolean);
  const scores = new Map();
  for (const c of chunks(jobIds, 150)) (await q(sb.from("jobs").select("id, score").in("id", c))).forEach((j) => scores.set(j.id, j.score));
  return apps.map((a) => {
    const cs = contacts.filter((c) => c.application_id === a.id);
    const next = cs.map((c) => c.next_contact_date).filter(Boolean).sort()[0] || null;
    return { ...a, score: scores.get(a.job_id) ?? null, n_contacts: cs.length, next_contact: next };
  });
});

on("POST", "/api/apps", async ({ body }) => {
  body = { ...body };
  if (body.job_id) {
    const dup = await q(sb.from("applications").select("id").eq("job_id", body.job_id).maybeSingle());
    if (dup) return appFull(dup.id);
    const job = (await q(sb.from("jobs").select("*").eq("id", body.job_id).maybeSingle())) || {};
    for (const k of ["title", "company", "location", "url", "salary"]) body[k] ??= job[k];
    body.source ??= "LinkedIn";
    body._poster = job;
  }
  if (!body.title || !body.company) throw new Error("Job title and company are required.");
  const status = body.status || "wishlist";
  if (!STATUSES.includes(status)) throw new Error("Unknown status");
  const row = Object.fromEntries(APP_FIELDS.filter((k) => body[k] !== undefined && body[k] !== null).map((k) => [k, body[k]]));
  Object.assign(row, { status }, status !== "wishlist" ? statusRules("wishlist", status, row) : {});
  const created = await q(sb.from("applications").insert(row).select("id").single());
  await addEvent(created.id, "created", `Added to tracker as ${STATUS_LABEL[status]}`, status !== "wishlist" && row.applied_date ? row.applied_date : today());
  const poster = body._poster;
  if (poster?.poster_name) {
    await q(sb.from("contacts").insert({ application_id: created.id, name: poster.poster_name, role: poster.poster_title || "",
      linkedin: poster.poster_url || "", notes: "Job poster on LinkedIn" }));
  }
  return appFull(created.id);
});

on("GET", "/api/apps/(\\d+)", async ({ args: [id] }) => appFull(+id));

on("PUT", "/api/apps/(\\d+)", async ({ args: [id], body }) => {
  const old = await q(sb.from("applications").select("*").eq("id", id).single());
  if (body.status && !STATUSES.includes(body.status)) throw new Error("Unknown status");
  const vals = Object.fromEntries(APP_FIELDS.filter((k) => k in body).map((k) => [k, body[k]]));
  if (body.status && body.status !== old.status) {
    await addEvent(+id, "status", `${STATUS_LABEL[old.status]} → ${STATUS_LABEL[body.status]}`);
    const merged = { ...old, ...vals };
    if (!("next_action_date" in body)) Object.assign(vals, statusRules(old.status, body.status, merged));
    else if (body.status === "applied" && !merged.applied_date) vals.applied_date = today();
  }
  await q(sb.from("applications").update({ ...vals, updated_at: now() }).eq("id", id));
  return appFull(+id);
});

on("DELETE", "/api/apps/(\\d+)", async ({ args: [id] }) => { await q(sb.from("applications").delete().eq("id", id)); return { ok: true }; });

on("POST", "/api/apps/(\\d+)/contacts", async ({ args: [id], body }) => {
  if (!body.name) throw new Error("Contact name is required.");
  await q(sb.from("contacts").insert({ application_id: +id, ...Object.fromEntries(CONTACT_FIELDS.map((k) => [k, body[k] || ""])) }));
  await q(sb.from("applications").update({ updated_at: now() }).eq("id", id));
  return appFull(+id);
});

on("PUT", "/api/contacts/(\\d+)", async ({ args: [cid], body }) => {
  const c = await q(sb.from("contacts").select("application_id, name").eq("id", cid).single());
  const vals = Object.fromEntries(CONTACT_FIELDS.filter((k) => k in body).map((k) => [k, body[k]]));
  if (body.log_touch) vals.last_contacted = today();
  if (Object.keys(vals).length) await q(sb.from("contacts").update(vals).eq("id", cid));
  if (body.log_touch) await addEvent(c.application_id, "contact", `Reached out to ${vals.name || c.name}`);
  return appFull(c.application_id);
});

on("DELETE", "/api/contacts/(\\d+)", async ({ args: [cid] }) => {
  const c = await q(sb.from("contacts").select("application_id").eq("id", cid).single());
  await q(sb.from("contacts").delete().eq("id", cid));
  return appFull(c.application_id);
});

on("POST", "/api/apps/(\\d+)/events", async ({ args: [id], body }) => {
  if (!body.summary) throw new Error("Describe what happened.");
  await addEvent(+id, body.type || "note", body.summary, body.date || today());
  await q(sb.from("applications").update({ updated_at: now() }).eq("id", id));
  return appFull(+id);
});

on("DELETE", "/api/events/(\\d+)", async ({ args: [eid] }) => {
  const e = await q(sb.from("events").select("application_id").eq("id", eid).single());
  await q(sb.from("events").delete().eq("id", eid));
  return appFull(e.application_id);
});

/* ------------------------------------------------------------------ dashboard */
on("GET", "/api/dashboard", async () => {
  const t = today();
  const [apps, contacts, events, jobsFound, strong] = await Promise.all([
    q(sb.from("applications").select("*")),
    q(sb.from("contacts").select("*").neq("next_contact_date", "").not("next_contact_date", "is", null)),
    q(sb.from("events").select("application_id, type, summary")),
    sb.from("jobs").select("id", { count: "exact", head: true }).eq("hidden", false).then((r) => { if (r.error) throw new Error(r.error.message); return r.count || 0; }),
    q(sb.from("jobs").select("id").eq("hidden", false).gte("score", 70)),
  ]);
  const byId = new Map(apps.map((a) => [a.id, a]));
  const trackedJobs = new Set(apps.map((a) => a.job_id).filter(Boolean));
  const interviewed = new Set(events.filter((e) => e.type === "interview" || /→ Interviewing/.test(e.summary)).map((e) => e.application_id));

  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  apps.forEach((a) => (byStatus[a.status] = (byStatus[a.status] || 0) + 1));
  const submitted = apps.filter((a) => a.status !== "wishlist");
  const responded = submitted.filter((a) => RESPONDED.has(a.status));
  const reachedInterview = submitted.filter((a) => ["interviewing", "offer", "accepted"].includes(a.status) || interviewed.has(a.id));

  const tasksList = [];
  for (const a of apps) {
    if (CLOSED.has(a.status) || !a.next_action_date) continue;
    tasksList.push({ kind: "application", app_id: a.id, date: a.next_action_date, what: a.next_action || "Next step", company: a.company, title: a.title, status: a.status });
  }
  for (const c of contacts) {
    const a = byId.get(c.application_id);
    if (!a || CLOSED.has(a.status)) continue;
    tasksList.push({ kind: "contact", app_id: a.id, contact_id: c.id, date: c.next_contact_date,
      what: `Contact ${c.name}${c.role ? ` (${c.role})` : ""}`, company: a.company, title: a.title, status: a.status });
  }
  tasksList.sort((x, y) => x.date.localeCompare(y.date));
  const week = plusDays(7);

  const stale = [];
  for (const a of apps) {
    if (a.status !== "applied" || !a.applied_date) continue;
    const days = Math.round((new Date(`${t}T00:00:00`) - new Date(`${a.applied_date}T00:00:00`)) / 864e5);
    if (days >= 21) stale.push({ app_id: a.id, company: a.company, title: a.title, days });
  }

  const weeks = [];
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const monday = new Date(d0); monday.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));
  for (let i = 7; i >= 0; i--) {
    const s = new Date(monday); s.setDate(monday.getDate() - 7 * i);
    const e = new Date(s); e.setDate(s.getDate() + 6);
    const [si, ei] = [iso(s), iso(e)];
    weeks.push({ week: si, count: submitted.filter((a) => a.applied_date && a.applied_date >= si && a.applied_date <= ei).length });
  }
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  return {
    by_status: byStatus, total: apps.length, submitted: submitted.length,
    response_rate: pct(responded.length, submitted.length), interview_rate: pct(reachedInterview.length, submitted.length),
    offers: byStatus.offer + byStatus.accepted,
    active: apps.filter((a) => !CLOSED.has(a.status) && a.status !== "wishlist").length,
    overdue: tasksList.filter((x) => x.date < t), today: tasksList.filter((x) => x.date === t),
    upcoming: tasksList.filter((x) => x.date > t && x.date <= week), stale, weeks,
    jobs_found: jobsFound, strong_matches: strong.filter((j) => !trackedJobs.has(j.id)).length,
  };
});

/* ------------------------------------------------------------------ export / backup / restore */
on("GET", "/api/export.csv", async () => {
  const [apps, contacts] = await Promise.all([
    q(sb.from("applications").select("*").order("applied_date", { ascending: false })),
    q(sb.from("contacts").select("*")),
  ]);
  const cols = ["company", "title", "status", "applied_date", "location", "salary", "priority", "next_action", "next_action_date", "url", "source", "cv_version", "notes"];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [[...cols.map((c) => c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())), "Contacts"].map(cell).join(",")];
  for (const a of apps) {
    const cs = contacts.filter((c) => c.application_id === a.id).map((c) => `${c.name} (${c.role || ""}) ${c.email || ""} ${c.linkedin || ""}`.trim());
    lines.push([...cols.map((c) => (c === "status" ? STATUS_LABEL[a.status] : a[c])), cs.join("; ")].map(cell).join(","));
  }
  return { filename: `applications-${today()}.csv`, type: "text/csv", content: "﻿" + lines.join("\r\n") };
});

on("GET", "/api/backup.json", async () => {
  const strip = (rows) => rows.map(({ user_id, ...r }) => r);
  const [applications, contacts, events, jobs, profile] = await Promise.all([
    q(sb.from("applications").select("*")), q(sb.from("contacts").select("*")), q(sb.from("events").select("*")),
    q(sb.from("jobs").select("*")), getProfileRow(),
  ]);
  const data = { applications: strip(applications), contacts: strip(contacts), events: strip(events), jobs: strip(jobs), profile: profile?.data || null };
  return { filename: `jobhunt-backup-${today()}.json`, type: "application/json", content: JSON.stringify(data, null, 1) };
});

on("POST", "/api/restore", async ({ body }) => {
  const file = body.get("file");
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error("That file is not a JobHunt backup."); }
  if (!Array.isArray(data.applications)) throw new Error("That file is not a JobHunt backup.");
  const pick = (r, keys) => Object.fromEntries(keys.filter((k) => r[k] !== undefined && r[k] !== null).map((k) => [k, r[k]]));

  await q(sb.from("applications").delete().not("id", "is", null)); // contacts & events cascade
  await q(sb.from("jobs").delete().not("id", "is", null));

  const jobs = (data.jobs || []).map((j) => {
    const r = pick(j, [...JOB_FIELDS, "id", "score", "tailor", "match", "hidden", "first_seen"]);
    for (const k of ["match", "tailor"]) if (typeof r[k] === "string") { try { r[k] = JSON.parse(r[k]); } catch { delete r[k]; } }
    if ("hidden" in r) r.hidden = Boolean(r.hidden);
    r.id = String(r.id);
    return r;
  });
  for (const c of chunks(jobs, 200)) await q(sb.from("jobs").upsert(c, { onConflict: "user_id,id" }));

  const idMap = new Map();
  for (const a of data.applications) {
    const row = pick(a, [...APP_FIELDS, "created_at", "updated_at"]);
    if (row.job_id != null) row.job_id = String(row.job_id);
    const created = await q(sb.from("applications").insert(row).select("id").single());
    idMap.set(a.id, created.id);
  }
  const remap = (rows, keys) => rows.filter((r) => idMap.has(r.application_id))
    .map((r) => ({ ...pick(r, keys), application_id: idMap.get(r.application_id) }));
  const contacts = remap(data.contacts || [], CONTACT_FIELDS);
  const events = remap(data.events || [], ["date", "type", "summary"]);
  for (const c of chunks(contacts, 200)) await q(sb.from("contacts").insert(c));
  for (const c of chunks(events, 200)) await q(sb.from("events").insert(c));
  if (data.profile) await q(sb.from("profiles").upsert({ data: data.profile, updated_at: now() }, { onConflict: "user_id" }));
  return { ok: true };
});
