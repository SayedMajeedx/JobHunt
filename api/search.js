// One page (10 jobs) of search results, from LinkedIn (default) or Indeed (via JSearch).
import { onlyPost, requireUser } from "../lib/auth.js";
import * as indeed from "../lib/indeed.js";
import { RateLimited, searchPage } from "../lib/linkedin.js";

const arr = (v) => (Array.isArray(v) ? v.map(String) : []);

export default async function handler(req, res) {
  if (!onlyPost(req, res) || !(await requireUser(req, res))) return;
  const b = req.body || {};
  if (!String(b.keywords || "").trim()) return res.status(400).json({ error: "Missing keywords" });
  const common = {
    keywords: String(b.keywords).slice(0, 200), location: String(b.location || "").slice(0, 200),
    date_posted: String(b.date_posted || "week"), work_types: arr(b.work_types), job_types: arr(b.job_types),
  };
  const start = Math.max(0, Math.min(990, parseInt(b.start, 10) || 0));

  if (b.source === "indeed") {
    if (!indeed.configured()) return res.status(400).json({ error: "Indeed search isn't set up. Add RAPIDAPI_KEY in Vercel (see the README)." });
    try {
      res.status(200).json({ jobs: await indeed.searchPage({ ...common, page: start / 10 + 1 }) });
    } catch (e) {
      if (e instanceof indeed.QuotaExceeded) return res.status(402).json({ error: "The free Indeed search quota for this month is used up." });
      res.status(502).json({ error: e.message });
    }
    return;
  }

  try {
    const jobs = await searchPage({ ...common, start, experience: arr(b.experience), sort: b.sort });
    res.status(200).json({ jobs });
  } catch (e) {
    if (e instanceof RateLimited) return res.status(429).json({ error: "LinkedIn is limiting requests right now." });
    res.status(502).json({ error: `Could not reach LinkedIn: ${e.message}` });
  }
}
