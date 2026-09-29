// One page (10 jobs) of LinkedIn search results.
import { onlyPost, requireUser } from "../lib/auth.js";
import { RateLimited, searchPage } from "../lib/linkedin.js";

const arr = (v) => (Array.isArray(v) ? v.map(String) : []);

export default async function handler(req, res) {
  if (!onlyPost(req, res) || !(await requireUser(req, res))) return;
  const b = req.body || {};
  if (!String(b.keywords || "").trim()) return res.status(400).json({ error: "Missing keywords" });
  try {
    const jobs = await searchPage({
      keywords: String(b.keywords).slice(0, 200), location: String(b.location || "").slice(0, 200),
      start: Math.max(0, Math.min(990, parseInt(b.start, 10) || 0)), date_posted: String(b.date_posted || "week"),
      work_types: arr(b.work_types), experience: arr(b.experience), job_types: arr(b.job_types), sort: b.sort,
    });
    res.status(200).json({ jobs });
  } catch (e) {
    if (e instanceof RateLimited) return res.status(429).json({ error: "LinkedIn is limiting requests right now." });
    res.status(502).json({ error: `Could not reach LinkedIn: ${e.message}` });
  }
}
