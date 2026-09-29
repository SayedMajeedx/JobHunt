// In-browser stand-in for the Supabase client, used only by `npm run dev` when no Supabase
// project is configured. Implements just the query-builder calls JobHunt makes; data is kept in localStorage.
const KEY = "jh-mock-db";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const db = Object.assign({ profiles: [], jobs: [], applications: [], contacts: [], events: [], _seq: 1 }, load());
const save = () => localStorage.setItem(KEY, JSON.stringify(db));
const same = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
const DEFAULTS = {
  jobs: () => ({ hidden: false, first_seen: new Date().toISOString(), updated_at: new Date().toISOString() }),
  applications: () => ({ status: "wishlist", priority: 2, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  contacts: () => ({ created_at: new Date().toISOString() }),
  events: () => ({ type: "note", created_at: new Date().toISOString() }),
  profiles: () => ({ user_id: "dev-user", updated_at: new Date().toISOString() }),
};
const IDENTITY = new Set(["applications", "contacts", "events"]);
const CASCADE = { applications: [["contacts", "application_id"], ["events", "application_id"]] };

class Query {
  constructor(table) { Object.assign(this, { table, op: "select", filters: [], orders: [], lim: null, one: null, ret: false, head: false }); }
  select(cols, opts = {}) { if (this.op === "select") { this.head = !!opts.head; this.count = opts.count; } else this.ret = true; return this; }
  insert(rows) { this.op = "insert"; this.payload = [].concat(rows); return this; }
  update(vals) { this.op = "update"; this.payload = vals; return this; }
  upsert(rows, opts = {}) { this.op = "upsert"; this.payload = [].concat(rows); this.conflict = opts.onConflict; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c, v) { this.filters.push((r) => (typeof v === "boolean" ? Boolean(r[c]) === v : same(r[c], v))); return this; }
  neq(c, v) { this.filters.push((r) => !same(r[c], v)); return this; }
  gte(c, v) { this.filters.push((r) => r[c] !== null && r[c] !== undefined && r[c] >= v); return this; }
  in(c, arr) { const s = new Set(arr.map(String)); this.filters.push((r) => s.has(String(r[c]))); return this; }
  not(c, op, v) {
    if (op === "is") this.filters.push((r) => r[c] !== null && r[c] !== undefined);
    else if (op === "in") { const s = new Set(v.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""))); this.filters.push((r) => !s.has(String(r[c]))); }
    return this;
  }
  order(c, o = {}) { this.orders.push([c, o.ascending !== false, o.nullsFirst]); return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  then(resolve, reject) {
    return Promise.resolve().then(() => {
      try { return this.run(); } catch (e) { return { data: null, error: { message: e.message } }; }
    }).then(resolve, reject);
  }

  rows() { return db[this.table].filter((r) => this.filters.every((f) => f(r))); }
  run() {
    const T = db[this.table];
    let out;
    if (this.op === "select") {
      out = this.rows().map((r) => ({ ...r }));
      for (const [c, asc, nullsFirst] of [...this.orders].reverse()) {
        out.sort((a, b) => {
          const x = a[c], y = b[c];
          if (x == null || y == null) return x == null && y == null ? 0 : (x == null) === Boolean(nullsFirst) ? -1 : 1;
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      if (this.lim) out = out.slice(0, this.lim);
      if (this.head) return { data: null, count: out.length, error: null };
    } else if (this.op === "insert") {
      out = this.payload.map((p) => {
        const row = { ...DEFAULTS[this.table](), ...p };
        if (IDENTITY.has(this.table) && row.id == null) row.id = db._seq++;
        if (this.table === "jobs" && T.some((r) => same(r.id, row.id))) throw new Error("duplicate key value violates unique constraint");
        T.push(row);
        return { ...row };
      });
    } else if (this.op === "upsert") {
      const keys = this.table === "profiles" ? ["user_id"] : ["id"];
      out = this.payload.map((p) => {
        const hit = T.find((r) => keys.every((k) => same(r[k], (p[k] ?? DEFAULTS[this.table]()[k]))));
        if (hit) { Object.assign(hit, p); return { ...hit }; }
        const row = { ...DEFAULTS[this.table](), ...p };
        T.push(row);
        return { ...row };
      });
    } else if (this.op === "update") {
      out = this.rows().map((r) => ({ ...Object.assign(r, this.payload) }));
    } else if (this.op === "delete") {
      const gone = this.rows();
      db[this.table] = T.filter((r) => !gone.includes(r));
      for (const [child, fk] of CASCADE[this.table] || []) db[child] = db[child].filter((c) => !gone.some((g) => same(g.id, c[fk])));
      out = gone;
    }
    if (this.op !== "select") save();
    if (this.op !== "select" && !this.ret) return { data: null, error: null };
    if (this.one) {
      if (!out.length) return this.one === "maybe" ? { data: null, error: null } : { data: null, error: { message: "No rows found" } };
      return { data: out[0], error: null };
    }
    return { data: out, error: null };
  }
}

export function createMockClient() {
  const SESSION = "jh-mock-session";
  const getS = () => { try { return JSON.parse(localStorage.getItem(SESSION)); } catch { return null; } };
  return {
    from: (t) => new Query(t),
    auth: {
      async getSession() { return { data: { session: getS() } }; },
      async signInWithPassword({ email, password }) {
        if (!email || !password) return { error: { message: "Enter an email and password." } };
        localStorage.setItem(SESSION, JSON.stringify({ access_token: "dev-token", user: { email } }));
        return { data: {}, error: null };
      },
      async signOut() { localStorage.removeItem(SESSION); return { error: null }; },
    },
  };
}
