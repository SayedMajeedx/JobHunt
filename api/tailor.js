// AI fit analysis, CV edits, outreach note and cover letter for one job.
import { AIError, tailorForJob } from "../lib/ai.js";
import { onlyPost, requireUser } from "../lib/auth.js";

export default async function handler(req, res) {
  if (!onlyPost(req, res) || !(await requireUser(req, res))) return;
  const { profile, job, cv_text = "" } = req.body || {};
  if (!profile || !job) return res.status(400).json({ error: "Missing profile or job." });
  try {
    res.status(200).json({ tailor: await tailorForJob(profile, job, String(cv_text).slice(0, 120_000)) });
  } catch (e) {
    res.status(e instanceof AIError ? e.status : 500).json({ error: e.message });
  }
}
