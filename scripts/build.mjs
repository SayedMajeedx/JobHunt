// Vercel build step: copies the app (public/) into dist/, which Vercel serves.
// There is nothing to compile; this only gives Vercel a normal, explicit output folder.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "public");
const out = path.join(root, "dist");

if (!fs.existsSync(path.join(src, "index.html"))) {
  console.error(`public/index.html not found in ${root}. Files here: ${fs.readdirSync(root).join(", ")}`);
  process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });

const count = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0);
console.log(`Copied ${count(out)} files from public/ to dist/`);
