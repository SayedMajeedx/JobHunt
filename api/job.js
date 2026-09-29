// Full details of one LinkedIn job posting.
import { onlyPost, requireUser } from "../lib/auth.js";
import { jobDetail, RateLimited } from "../lib/linkedin.js";

export default async function handler(req, res) {
  if (!onlyPost(req, res) || !(await requireUser(req, res))) return;
  try {
    const job = await jobDetail(String((req.body || {}).id || ""));
    if (!job) return res.status(404).json({ error: "LinkedIn did not return this job. It may have been closed." });
    res.status(200).json({ job });
  } catch (e) {
    if (e instanceof RateLimited) return res.status(429).json({ error: "LinkedIn is limiting requests right now." });
    res.status(502).json({ error: `Could not reach LinkedIn: ${e.message}` });
  }
}
