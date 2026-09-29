// Local development server: serves /public and runs the /api functions the way Vercel does.
//   npm run dev             → uses SUPABASE_URL / SUPABASE_ANON_KEY / ANTHROPIC_API_KEY from .env.local
//   (no Supabase settings)  → runs against an in-browser mock database, for trying the app without any accounts
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 3000;

for (const file of [".env.local", ".env"]) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
const MOCK = !process.env.SUPABASE_URL;
if (MOCK) {
  process.env.SUPABASE_URL = `http://localhost:${PORT}`;
  process.env.SUPABASE_ANON_KEY = "dev-mock";
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return raw ? JSON.parse(raw) : {}; } catch { return raw; }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = decodeURIComponent(url.pathname);
  try {
    if (MOCK && p === "/auth/v1/user") return send(res, 200, { id: "dev-user", email: "dev@example.com" });
    if (MOCK && p === "/api/config") {
      const ai = (await import("./lib/ai.js")).provider();
      return send(res, 200, { supabaseUrl: "mock", supabaseKey: "mock", ai: Boolean(ai), aiName: ai?.name || "", mock: true });
    }
    if (MOCK && p === "/dev/mock-supabase.js") return send(res, 200, fs.readFileSync(path.join(ROOT, "dev", "mock-supabase.js")), TYPES[".js"]);

    const api = p.match(/^\/api\/([a-z-]+)$/);
    if (api) {
      const file = path.join(ROOT, "api", `${api[1]}.js`);
      if (!fs.existsSync(file)) return send(res, 404, { error: "Not found" });
      const { default: handler } = await import(pathToFileURL(file).href);
      req.query = Object.fromEntries(url.searchParams);
      req.body = await readBody(req);
      let status = 200;
      const shim = {
        status(c) { status = c; return shim; },
        setHeader(k, v) { res.setHeader(k, v); return shim; },
        json(obj) { send(res, status, obj); return shim; },
        send(body) { send(res, status, body, "text/plain"); return shim; },
      };
      return await handler(req, shim);
    }

    let file = path.join(ROOT, "public", p === "/" ? "index.html" : p);
    if (!file.startsWith(path.join(ROOT, "public")) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, "public", "index.html");
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || "application/octet-stream");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: String(e.message || e) });
  }
}).listen(PORT, () => {
  console.log(`\n  JobHunt dev server: http://localhost:${PORT}`);
  console.log(MOCK ? "  Mode: mock database (no Supabase settings found). Sign in with any email and password.\n"
    : "  Mode: live Supabase from .env.local\n");
});
