// Claude analysis of the CV / LinkedIn profile text (extracted from the PDFs in the browser).
import { onlyPost, requireUser } from "../lib/auth.js";
import { analyzeProfile, ClaudeError } from "../lib/claude.js";

const MAX = 120_000;

export default async function handler(req, res) {
  if (!onlyPost(req, res) || !(await requireUser(req, res))) return;
  const { cv_text = "", li_text = "" } = req.body || {};
  if (!String(cv_text).trim() && !String(li_text).trim()) return res.status(400).json({ error: "No CV text received." });
  try {
    res.status(200).json({ profile: await analyzeProfile(String(cv_text).slice(0, MAX), String(li_text).slice(0, MAX)) });
  } catch (e) {
    res.status(e instanceof ClaudeError ? e.status : 500).json({ error: e.message });
  }
}
