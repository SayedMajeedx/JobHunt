"""JobHunt — local job search + application tracker.

Run:  python app.py   then open http://127.0.0.1:5000
"""
import csv
import io
import json
import os
import sqlite3
import threading
import uuid
import webbrowser
from datetime import date, datetime, timedelta
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory

import linkedin_jobs as lj
import profile_analyzer as pa

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)
DB_PATH = DATA / "jobhunt.db"
CONFIG_PATH = DATA / "config.json"

STATUSES = ["wishlist", "applied", "screening", "interviewing", "offer", "accepted", "rejected", "withdrawn", "ghosted"]
STATUS_LABEL = {"wishlist": "Saved", "applied": "Applied", "screening": "Screening", "interviewing": "Interviewing",
                "offer": "Offer", "accepted": "Accepted", "rejected": "Rejected", "withdrawn": "Withdrawn",
                "ghosted": "No response"}
CLOSED = {"accepted", "rejected", "withdrawn", "ghosted"}
RESPONDED = {"screening", "interviewing", "offer", "accepted", "rejected"}

app = Flask(__name__, static_folder=str(BASE / "static"), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024

# --------------------------------------------------------------------------- storage

SCHEMA = """
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, title TEXT, company TEXT, company_url TEXT, location TEXT, posted_date TEXT,
  posted_text TEXT, url TEXT, apply_url TEXT, logo TEXT, salary TEXT, description TEXT, seniority TEXT,
  employment_type TEXT, job_function TEXT, industries TEXT, applicants TEXT, poster_name TEXT,
  poster_title TEXT, poster_url TEXT, query TEXT, score INTEGER, match TEXT, tailor TEXT,
  hidden INTEGER DEFAULT 0, first_seen TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, title TEXT, company TEXT, location TEXT, url TEXT,
  source TEXT, status TEXT DEFAULT 'wishlist', applied_date TEXT, salary TEXT, priority INTEGER DEFAULT 2,
  cv_version TEXT, next_action TEXT, next_action_date TEXT, notes TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, application_id INTEGER, name TEXT, role TEXT, email TEXT,
  linkedin TEXT, phone TEXT, notes TEXT, last_contacted TEXT, next_contact_date TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, application_id INTEGER, date TEXT, type TEXT, summary TEXT
);
"""

JOB_FIELDS = ["title", "company", "company_url", "location", "posted_date", "posted_text", "url", "apply_url",
              "logo", "salary", "description", "seniority", "employment_type", "job_function", "industries",
              "applicants", "poster_name", "poster_title", "poster_url", "query"]
APP_FIELDS = ["job_id", "title", "company", "location", "url", "source", "status", "applied_date", "salary",
              "priority", "cv_version", "next_action", "next_action_date", "notes"]
CONTACT_FIELDS = ["name", "role", "email", "linkedin", "phone", "notes", "last_contacted", "next_contact_date"]


def db():
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    return con


with db() as _c:
    _c.executescript(SCHEMA)


def kv_get(key, default=None):
    with db() as c:
        row = c.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
    return json.loads(row["value"]) if row else default


def kv_set(key, value):
    with db() as c:
        c.execute("INSERT OR REPLACE INTO kv(key,value) VALUES(?,?)", (key, json.dumps(value)))


def now():
    return datetime.now().isoformat(timespec="seconds")


def today():
    return date.today().isoformat()


def load_config():
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf8"))
    except (OSError, ValueError):
        return {}


def api_key():
    return load_config().get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY", "")


def row_dict(r):
    return dict(r) if r else None


def job_out(r):
    d = dict(r)
    d["match"] = json.loads(d["match"]) if d.get("match") else None
    d["tailor"] = json.loads(d["tailor"]) if d.get("tailor") else None
    return d


def err(msg, code=400):
    return jsonify({"error": msg}), code


# --------------------------------------------------------------------------- pages & settings

@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/settings")
def get_settings():
    key = api_key()
    return jsonify({"has_key": bool(key), "key_hint": f"…{key[-4:]}" if key else "",
                    "from_env": bool(os.environ.get("ANTHROPIC_API_KEY")) and not load_config().get("anthropic_api_key")})


@app.post("/api/settings")
def save_settings():
    body = request.get_json(force=True)
    cfg = load_config()
    if "anthropic_api_key" in body:
        cfg["anthropic_api_key"] = (body["anthropic_api_key"] or "").strip()
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf8")
    return get_settings()


# --------------------------------------------------------------------------- profile

@app.get("/api/profile")
def get_profile():
    return jsonify({"profile": kv_get("profile"), "sources": kv_get("profile_sources", {})})


@app.post("/api/profile/analyze")
def analyze_profile():
    cv_text, li_text, sources = "", "", {}
    try:
        if request.files.get("cv"):
            cv_text = pa.pdf_to_text(request.files["cv"].read())
            sources["cv"] = request.files["cv"].filename
        if request.files.get("linkedin"):
            li_text = pa.pdf_to_text(request.files["linkedin"].read())
            sources["linkedin"] = request.files["linkedin"].filename
    except Exception as e:  # malformed / encrypted PDFs
        return err(f"Could not read the PDF: {e}")
    pasted = (request.form.get("text") or "").strip()
    if pasted:
        cv_text = (cv_text + "\n\n" + pasted).strip()
        sources["pasted"] = True
    if not cv_text and not li_text:
        prev = kv_get("profile_texts") or {}
        cv_text, li_text = prev.get("cv", ""), prev.get("linkedin", "")
        sources = kv_get("profile_sources", {})
        if not cv_text and not li_text:
            return err("Upload a CV PDF, a LinkedIn profile PDF, or paste your CV text.")
    if len(cv_text) + len(li_text) < 80:
        return err("Very little text could be read from the file(s). If your PDF is a scanned image, "
                   "paste the text instead.")

    use_ai = request.form.get("use_ai") == "true"
    warning = None
    if use_ai and api_key():
        try:
            profile = pa.analyze_with_claude(api_key(), cv_text, li_text)
        except pa.ClaudeError as e:
            warning = f"AI analysis failed ({e}); used the built-in analyzer instead."
            profile = pa.analyze_builtin(cv_text, li_text)
    else:
        profile = pa.analyze_builtin(cv_text, li_text)
    profile["analyzed_at"] = now()
    kv_set("profile", profile)
    kv_set("profile_texts", {"cv": cv_text, "linkedin": li_text})
    kv_set("profile_sources", sources)
    return jsonify({"profile": profile, "sources": sources, "warning": warning})


@app.put("/api/profile")
def update_profile():
    profile = request.get_json(force=True)
    kv_set("profile", profile)
    return jsonify({"profile": profile})


# --------------------------------------------------------------------------- job search

TASKS = {}


def upsert_job(con, job):
    existing = con.execute("SELECT id FROM jobs WHERE id=?", (job["id"],)).fetchone()
    vals = {k: job.get(k) for k in JOB_FIELDS if job.get(k) not in (None, "")}
    if existing:
        if vals:
            con.execute(f"UPDATE jobs SET {', '.join(f'{k}=?' for k in vals)}, updated_at=? WHERE id=?",
                        [*vals.values(), now(), job["id"]])
    else:
        cols = ["id", *vals.keys(), "first_seen", "updated_at"]
        con.execute(f"INSERT INTO jobs({', '.join(cols)}) VALUES({', '.join('?' * len(cols))})",
                    [job["id"], *vals.values(), now(), now()])


def rescore(con, job_ids=None):
    profile = kv_get("profile")
    if not profile:
        return
    q = "SELECT * FROM jobs" + (f" WHERE id IN ({','.join('?' * len(job_ids))})" if job_ids else "")
    for r in con.execute(q, job_ids or []).fetchall():
        m = pa.score_job(profile, dict(r))
        con.execute("UPDATE jobs SET score=?, match=? WHERE id=?", (m["score"], json.dumps(m), r["id"]))


def run_search(task_id, params):
    t = TASKS[task_id]
    queries = [q.strip() for q in params.get("queries", []) if q.strip()]
    locations = [l.strip() for l in params.get("locations", []) if l.strip()] or [""]
    per_query = max(10, min(int(params.get("per_query", 30)), 200))
    found = {}
    try:
        combos = [(q, l) for q in queries for l in locations]
        for ci, (q, loc) in enumerate(combos):
            got, start = 0, 0
            while got < per_query and not t["cancel"]:
                t["message"] = f"Searching “{q}”{' in ' + loc if loc else ''} — page {start // lj.PAGE_SIZE + 1}"
                page = lj.search_page(q, loc, start, params.get("date_posted", "week"),
                                      params.get("work_types", []), params.get("experience", []),
                                      params.get("job_types", []), params.get("sort", "R"))
                if not page:
                    break
                new = 0
                with db() as con:
                    for j in page:
                        if j["id"] not in found:
                            j["query"] = q
                            found[j["id"]] = j
                            upsert_job(con, j)
                            new += 1
                got += len(page)
                t["found"] = len(found)
                start += lj.PAGE_SIZE
                lj.polite_pause()
                if new == 0 and len(page) < lj.PAGE_SIZE:
                    break
            t["progress"] = (ci + 1) / len(combos) * (0.35 if params.get("fetch_details", True) else 1)

        ids = list(found)
        if params.get("fetch_details", True) and ids:
            with db() as con:
                have = {r["id"] for r in con.execute(
                    f"SELECT id FROM jobs WHERE description IS NOT NULL AND id IN ({','.join('?' * len(ids))})", ids)}
            todo = [i for i in ids if i not in have]
            for n, jid in enumerate(todo):
                if t["cancel"]:
                    break
                t["message"] = f"Reading job details {n + 1}/{len(todo)}: {found[jid]['title']} @ {found[jid]['company']}"
                detail = lj.job_detail(jid)
                if detail:
                    detail["id"] = jid
                    with db() as con:
                        upsert_job(con, detail)
                        rescore(con, [jid])
                t["progress"] = 0.35 + 0.65 * (n + 1) / len(todo)
                lj.polite_pause()
        with db() as con:
            if ids:
                rescore(con, ids)
        t["status"] = "cancelled" if t["cancel"] else "done"
        t["message"] = f"{'Stopped' if t['cancel'] else 'Done'} — {len(found)} jobs found."
    except lj.RateLimited:
        t["status"] = "done"
        t["message"] = (f"LinkedIn started rate-limiting, so the search stopped early with {len(found)} jobs. "
                        "Wait 10–15 minutes before searching again.")
        with db() as con:
            if found:
                rescore(con, list(found))
    except Exception as e:
        t["status"] = "error"
        t["message"] = f"Search failed: {e}"
    t["progress"] = 1
    t["job_ids"] = list(found)


@app.post("/api/search")
def start_search():
    params = request.get_json(force=True)
    if not [q for q in params.get("queries", []) if q.strip()]:
        return err("Add at least one job title or keyword to search for.")
    if any(t["status"] == "running" for t in TASKS.values()):
        return err("A search is already running.")
    tid = uuid.uuid4().hex[:10]
    TASKS[tid] = {"id": tid, "status": "running", "progress": 0, "found": 0, "message": "Starting…",
                  "cancel": False, "started": now()}
    threading.Thread(target=run_search, args=(tid, params), daemon=True).start()
    return jsonify(TASKS[tid])


@app.get("/api/search/current")
def current_search():
    running = [t for t in TASKS.values() if t["status"] == "running"]
    return jsonify(running[0] if running else {})


@app.get("/api/search/<tid>")
def search_status(tid):
    t = TASKS.get(tid)
    return jsonify(t) if t else err("Unknown search", 404)


@app.post("/api/search/<tid>/cancel")
def cancel_search(tid):
    if tid in TASKS:
        TASKS[tid]["cancel"] = True
    return jsonify({"ok": True})


@app.get("/api/jobs")
def list_jobs():
    hidden = request.args.get("hidden") == "1"
    with db() as con:
        rows = con.execute(
            "SELECT j.*, a.id AS app_id, a.status AS app_status FROM jobs j "
            "LEFT JOIN applications a ON a.job_id = j.id WHERE j.hidden = ? "
            "ORDER BY COALESCE(j.score, -1) DESC, j.posted_date DESC", (1 if hidden else 0,)).fetchall()
    return jsonify([job_out(r) for r in rows])


@app.post("/api/jobs/<jid>/hide")
def hide_job(jid):
    with db() as con:
        con.execute("UPDATE jobs SET hidden = 1 - hidden WHERE id=?", (jid,))
    return jsonify({"ok": True})


@app.post("/api/jobs/<jid>/refresh")
def refresh_job(jid):
    detail = lj.job_detail(jid)
    if not detail:
        return err("LinkedIn did not return this job — it may have been closed.", 404)
    detail["id"] = jid
    with db() as con:
        upsert_job(con, detail)
        rescore(con, [jid])
        return jsonify(job_out(con.execute("SELECT * FROM jobs WHERE id=?", (jid,)).fetchone()))


@app.post("/api/jobs/rescore")
def rescore_all():
    with db() as con:
        rescore(con)
    return jsonify({"ok": True})


@app.delete("/api/jobs")
def clear_jobs():
    with db() as con:
        con.execute("DELETE FROM jobs WHERE id NOT IN (SELECT job_id FROM applications WHERE job_id IS NOT NULL)")
    return jsonify({"ok": True})


@app.post("/api/jobs/<jid>/tailor")
def tailor_job(jid):
    if not api_key():
        return err("Add your Anthropic API key in Settings to use AI tailoring.")
    profile = kv_get("profile")
    if not profile:
        return err("Analyze your CV/LinkedIn profile first.")
    with db() as con:
        job = row_dict(con.execute("SELECT * FROM jobs WHERE id=?", (jid,)).fetchone())
    if not job:
        return err("Job not found", 404)
    if not job.get("description"):
        detail = lj.job_detail(jid)
        job.update(detail)
    cv = (kv_get("profile_texts") or {}).get("cv", "")
    try:
        result = pa.tailor_with_claude(api_key(), profile, job, cv)
    except pa.ClaudeError as e:
        return err(str(e), 502)
    with db() as con:
        con.execute("UPDATE jobs SET tailor=? WHERE id=?", (json.dumps(result), jid))
    return jsonify(result)


@app.get("/api/jobs/<jid>/contacts-links")
def contact_links(jid):
    with db() as con:
        job = row_dict(con.execute("SELECT title, company FROM jobs WHERE id=?", (jid,)).fetchone()) or {}
    return jsonify(lj.people_search_links(job.get("company", ""), job.get("title", "")))


# --------------------------------------------------------------------------- applications

def add_event(con, app_id, type_, summary, when=None):
    con.execute("INSERT INTO events(application_id, date, type, summary) VALUES(?,?,?,?)",
                (app_id, when or today(), type_, summary))


def plus_days(n):
    return (date.today() + timedelta(days=n)).isoformat()


def apply_status_rules(con, app_id, old, new, data, log=True):
    """Automatic bookkeeping when an application moves to a new stage."""
    if old == new:
        return
    if log:
        add_event(con, app_id, "status", f"{STATUS_LABEL.get(old, 'New')} → {STATUS_LABEL[new]}")
    updates = {}
    if new == "applied":
        applied = data.get("applied_date") or today()
        if not data.get("applied_date"):
            updates["applied_date"] = applied
        try:
            follow = max(date.fromisoformat(applied) + timedelta(days=7), date.today()).isoformat()
        except ValueError:
            follow = plus_days(7)
        updates["next_action"] = "Follow up if no reply"
        updates["next_action_date"] = follow
    elif new == "screening":
        updates["next_action"] = "Prepare for recruiter screen: pitch, salary range, availability"
        updates["next_action_date"] = plus_days(2)
    elif new == "interviewing":
        updates["next_action"] = "Send thank-you note within 24h of each interview"
        updates["next_action_date"] = plus_days(1)
    elif new == "offer":
        updates["next_action"] = "Review offer & negotiate — reply by deadline"
        updates["next_action_date"] = plus_days(3)
    elif new in CLOSED:
        updates["next_action"] = ""
        updates["next_action_date"] = ""
    if updates:
        con.execute(f"UPDATE applications SET {', '.join(f'{k}=?' for k in updates)} WHERE id=?",
                    [*updates.values(), app_id])


def app_full(con, app_id):
    a = row_dict(con.execute("SELECT * FROM applications WHERE id=?", (app_id,)).fetchone())
    if not a:
        return None
    a["contacts"] = [dict(r) for r in con.execute(
        "SELECT * FROM contacts WHERE application_id=? ORDER BY id", (app_id,))]
    a["events"] = [dict(r) for r in con.execute(
        "SELECT * FROM events WHERE application_id=? ORDER BY date DESC, id DESC", (app_id,))]
    if a.get("job_id"):
        j = con.execute("SELECT * FROM jobs WHERE id=?", (a["job_id"],)).fetchone()
        a["job"] = job_out(j) if j else None
    a["links"] = lj.people_search_links(a.get("company") or "", a.get("title") or "")
    return a


@app.get("/api/apps")
def list_apps():
    with db() as con:
        apps = [dict(r) for r in con.execute(
            "SELECT a.*, j.score, (SELECT COUNT(*) FROM contacts c WHERE c.application_id=a.id) AS n_contacts, "
            "(SELECT MIN(next_contact_date) FROM contacts c WHERE c.application_id=a.id AND next_contact_date<>'') "
            "AS next_contact FROM applications a LEFT JOIN jobs j ON j.id=a.job_id ORDER BY a.updated_at DESC")]
    return jsonify(apps)


@app.post("/api/apps")
def create_app():
    body = request.get_json(force=True)
    with db() as con:
        if body.get("job_id"):
            dup = con.execute("SELECT id FROM applications WHERE job_id=?", (body["job_id"],)).fetchone()
            if dup:
                return jsonify(app_full(con, dup["id"]))
            job = row_dict(con.execute("SELECT * FROM jobs WHERE id=?", (body["job_id"],)).fetchone()) or {}
            for k in ("title", "company", "location", "url", "salary"):
                body.setdefault(k, job.get(k))
            body.setdefault("source", "LinkedIn")
        if not body.get("title") or not body.get("company"):
            return err("Job title and company are required.")
        status = body.get("status") or "wishlist"
        if status not in STATUSES:
            return err("Unknown status")
        body["status"] = status
        vals = {k: body.get(k) for k in APP_FIELDS if body.get(k) is not None}
        cols = [*vals.keys(), "created_at", "updated_at"]
        cur = con.execute(f"INSERT INTO applications({', '.join(cols)}) VALUES({', '.join('?' * len(cols))})",
                          [*vals.values(), now(), now()])
        app_id = cur.lastrowid
        add_event(con, app_id, "created", f"Added to tracker as {STATUS_LABEL[status]}",
                  body.get("applied_date") if status != "wishlist" else None)
        if status != "wishlist":
            apply_status_rules(con, app_id, "wishlist", status, body, log=False)
        if body.get("job_id"):
            job = row_dict(con.execute("SELECT poster_name, poster_title, poster_url FROM jobs WHERE id=?",
                                       (body["job_id"],)).fetchone()) or {}
            if job.get("poster_name"):
                con.execute("INSERT INTO contacts(application_id,name,role,linkedin,notes) VALUES(?,?,?,?,?)",
                            (app_id, job["poster_name"], job.get("poster_title"), job.get("poster_url"),
                             "Job poster on LinkedIn"))
        return jsonify(app_full(con, app_id))


@app.get("/api/apps/<int:app_id>")
def get_app(app_id):
    with db() as con:
        a = app_full(con, app_id)
    return jsonify(a) if a else err("Not found", 404)


@app.put("/api/apps/<int:app_id>")
def update_app(app_id):
    body = request.get_json(force=True)
    with db() as con:
        old = con.execute("SELECT * FROM applications WHERE id=?", (app_id,)).fetchone()
        if not old:
            return err("Not found", 404)
        if "status" in body and body["status"] not in STATUSES:
            return err("Unknown status")
        vals = {k: body[k] for k in APP_FIELDS if k in body}
        if vals:
            con.execute(f"UPDATE applications SET {', '.join(f'{k}=?' for k in vals)}, updated_at=? WHERE id=?",
                        [*vals.values(), now(), app_id])
        if "status" in body:
            merged = {**dict(old), **body}
            # only auto-set next steps when the user didn't provide their own in the same edit
            if "next_action_date" not in body:
                apply_status_rules(con, app_id, old["status"], body["status"], merged)
            elif old["status"] != body["status"]:
                add_event(con, app_id, "status", f"{STATUS_LABEL[old['status']]} → {STATUS_LABEL[body['status']]}")
                if body["status"] == "applied" and not merged.get("applied_date"):
                    con.execute("UPDATE applications SET applied_date=? WHERE id=?", (today(), app_id))
        return jsonify(app_full(con, app_id))


@app.delete("/api/apps/<int:app_id>")
def delete_app(app_id):
    with db() as con:
        con.execute("DELETE FROM contacts WHERE application_id=?", (app_id,))
        con.execute("DELETE FROM events WHERE application_id=?", (app_id,))
        con.execute("DELETE FROM applications WHERE id=?", (app_id,))
    return jsonify({"ok": True})


@app.post("/api/apps/<int:app_id>/contacts")
def add_contact(app_id):
    body = request.get_json(force=True)
    if not body.get("name"):
        return err("Contact name is required.")
    with db() as con:
        vals = {k: body.get(k) or "" for k in CONTACT_FIELDS}
        con.execute(f"INSERT INTO contacts(application_id, {', '.join(vals)}) VALUES(?, {', '.join('?' * len(vals))})",
                    [app_id, *vals.values()])
        con.execute("UPDATE applications SET updated_at=? WHERE id=?", (now(), app_id))
        return jsonify(app_full(con, app_id))


@app.put("/api/contacts/<int:cid>")
def update_contact(cid):
    body = request.get_json(force=True)
    with db() as con:
        c = con.execute("SELECT application_id FROM contacts WHERE id=?", (cid,)).fetchone()
        if not c:
            return err("Not found", 404)
        vals = {k: body[k] for k in CONTACT_FIELDS if k in body}
        if vals:
            con.execute(f"UPDATE contacts SET {', '.join(f'{k}=?' for k in vals)} WHERE id=?", [*vals.values(), cid])
        if body.get("log_touch"):
            con.execute("UPDATE contacts SET last_contacted=? WHERE id=?", (today(), cid))
            name = con.execute("SELECT name FROM contacts WHERE id=?", (cid,)).fetchone()["name"]
            add_event(con, c["application_id"], "contact", f"Reached out to {name}")
        return jsonify(app_full(con, c["application_id"]))


@app.delete("/api/contacts/<int:cid>")
def delete_contact(cid):
    with db() as con:
        c = con.execute("SELECT application_id FROM contacts WHERE id=?", (cid,)).fetchone()
        con.execute("DELETE FROM contacts WHERE id=?", (cid,))
        return jsonify(app_full(con, c["application_id"]) if c else {"ok": True})


@app.post("/api/apps/<int:app_id>/events")
def create_event(app_id):
    body = request.get_json(force=True)
    if not body.get("summary"):
        return err("Describe what happened.")
    with db() as con:
        add_event(con, app_id, body.get("type") or "note", body["summary"], body.get("date") or today())
        con.execute("UPDATE applications SET updated_at=? WHERE id=?", (now(), app_id))
        return jsonify(app_full(con, app_id))


@app.delete("/api/events/<int:eid>")
def delete_event(eid):
    with db() as con:
        e = con.execute("SELECT application_id FROM events WHERE id=?", (eid,)).fetchone()
        con.execute("DELETE FROM events WHERE id=?", (eid,))
        return jsonify(app_full(con, e["application_id"]) if e else {"ok": True})


# --------------------------------------------------------------------------- dashboard

@app.get("/api/dashboard")
def dashboard():
    t = today()
    with db() as con:
        apps = [dict(r) for r in con.execute("SELECT * FROM applications")]
        contacts = [dict(r) for r in con.execute(
            "SELECT c.*, a.company, a.title, a.status FROM contacts c JOIN applications a ON a.id=c.application_id "
            "WHERE c.next_contact_date IS NOT NULL AND c.next_contact_date <> ''")]
        n_jobs = con.execute("SELECT COUNT(*) FROM jobs WHERE hidden=0").fetchone()[0]
        n_strong = con.execute("SELECT COUNT(*) FROM jobs WHERE hidden=0 AND score>=70 AND id NOT IN "
                               "(SELECT job_id FROM applications WHERE job_id IS NOT NULL)").fetchone()[0]
        interview_apps = {r[0] for r in con.execute(
            "SELECT DISTINCT application_id FROM events WHERE type='interview' OR summary LIKE '%→ Interviewing%'")}

    by_status = {s: 0 for s in STATUSES}
    for a in apps:
        by_status[a["status"]] = by_status.get(a["status"], 0) + 1
    submitted = [a for a in apps if a["status"] != "wishlist"]
    responded = [a for a in submitted if a["status"] in RESPONDED]
    interviewed = [a for a in submitted if a["status"] in {"interviewing", "offer", "accepted"} or a["id"] in interview_apps]

    tasks = []
    for a in apps:
        if a["status"] in CLOSED or not a.get("next_action_date"):
            continue
        tasks.append({"kind": "application", "app_id": a["id"], "date": a["next_action_date"],
                      "what": a.get("next_action") or "Next step", "company": a["company"], "title": a["title"],
                      "status": a["status"]})
    for c in contacts:
        if c["status"] in CLOSED:
            continue
        tasks.append({"kind": "contact", "app_id": c["application_id"], "contact_id": c["id"],
                      "date": c["next_contact_date"], "what": f"Contact {c['name']}" + (f" ({c['role']})" if c.get("role") else ""),
                      "company": c["company"], "title": c["title"], "status": c["status"]})
    tasks.sort(key=lambda x: x["date"])
    overdue = [x for x in tasks if x["date"] < t]
    due_today = [x for x in tasks if x["date"] == t]
    upcoming = [x for x in tasks if t < x["date"] <= plus_days(7)]

    stale = []
    for a in apps:
        if a["status"] == "applied" and a.get("applied_date"):
            try:
                days = (date.today() - date.fromisoformat(a["applied_date"])).days
            except ValueError:
                continue
            if days >= 21:
                stale.append({"app_id": a["id"], "company": a["company"], "title": a["title"], "days": days})

    weeks = []
    for i in range(7, -1, -1):
        start = date.today() - timedelta(days=date.today().weekday() + 7 * i)
        end = start + timedelta(days=6)
        n = sum(1 for a in submitted if a.get("applied_date") and start.isoformat() <= a["applied_date"] <= end.isoformat())
        weeks.append({"week": start.isoformat(), "count": n})

    pct = lambda a, b: round(100 * a / b) if b else 0
    return jsonify({
        "by_status": by_status, "total": len(apps), "submitted": len(submitted),
        "response_rate": pct(len(responded), len(submitted)), "interview_rate": pct(len(interviewed), len(submitted)),
        "offers": by_status.get("offer", 0) + by_status.get("accepted", 0),
        "active": sum(1 for a in apps if a["status"] not in CLOSED and a["status"] != "wishlist"),
        "overdue": overdue, "today": due_today, "upcoming": upcoming, "stale": stale, "weeks": weeks,
        "jobs_found": n_jobs, "strong_matches": n_strong,
    })


# --------------------------------------------------------------------------- export / backup

@app.get("/api/export.csv")
def export_csv():
    with db() as con:
        apps = [dict(r) for r in con.execute("SELECT * FROM applications ORDER BY applied_date DESC")]
        contacts = {}
        for r in con.execute("SELECT * FROM contacts"):
            contacts.setdefault(r["application_id"], []).append(
                f"{r['name']} ({r['role'] or ''}) {r['email'] or ''} {r['linkedin'] or ''}".strip())
    buf = io.StringIO()
    cols = ["company", "title", "status", "applied_date", "location", "salary", "priority", "next_action",
            "next_action_date", "url", "source", "cv_version", "notes"]
    w = csv.writer(buf)
    w.writerow([c.replace("_", " ").title() for c in cols] + ["Contacts"])
    for a in apps:
        w.writerow([a.get(c) or "" for c in cols] + ["; ".join(contacts.get(a["id"], []))])
    return Response("﻿" + buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=applications-{today()}.csv"})


@app.get("/api/backup.json")
def backup():
    with db() as con:
        data = {t: [dict(r) for r in con.execute(f"SELECT * FROM {t}")]
                for t in ("applications", "contacts", "events", "jobs")}
    data["profile"] = kv_get("profile")
    return Response(json.dumps(data, indent=1, ensure_ascii=False), mimetype="application/json",
                    headers={"Content-Disposition": f"attachment; filename=jobhunt-backup-{today()}.json"})


@app.post("/api/restore")
def restore():
    f = request.files.get("file")
    if not f:
        return err("Choose a backup file.")
    try:
        data = json.loads(f.read().decode("utf8"))
    except ValueError:
        return err("That file is not a JobHunt backup.")
    with db() as con:
        for table in ("events", "contacts", "applications", "jobs"):
            rows = data.get(table) or []
            allowed = {r["name"] for r in con.execute(f"PRAGMA table_info({table})")}
            con.execute(f"DELETE FROM {table}")
            for r in rows:
                r = {k: v for k, v in r.items() if k in allowed}
                if r:
                    con.execute(f"INSERT INTO {table}({', '.join(r)}) VALUES({', '.join('?' * len(r))})",
                                list(r.values()))
    if data.get("profile"):
        kv_set("profile", data["profile"])
    return jsonify({"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    if not os.environ.get("NO_BROWSER"):
        threading.Timer(1.2, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    print(f"\n  JobHunt is running at http://127.0.0.1:{port}\n  Keep this window open while you use it. Press Ctrl+C to stop.\n")
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
