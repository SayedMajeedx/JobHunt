// Optional Claude-powered analysis. Needs ANTHROPIC_API_KEY in the Vercel environment.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5";
const SENIORITY = ["internship", "entry", "associate", "mid-senior", "director", "executive"];

const str = { type: "string" };
const list = { type: "array", items: { type: "string" } };
const obj = (properties) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });

const PROFILE_SCHEMA = obj({
  name: str, headline: str, email: str, phone: str, linkedin_url: str, location: str,
  years_experience: { type: "number" }, seniority: { type: "string", enum: SENIORITY }, current_title: str,
  titles: list, target_titles: list, skills: list, soft_skills: list, industries: list, languages: list,
  education: list, certifications: list, search_locations: list, summary: str, strengths: list, improvements: list,
});

const TAILOR_SCHEMA = obj({
  fit_score: { type: "integer" }, verdict: str, why_you_fit: list, gaps: list, cv_tweaks: list,
  keywords_to_add: list, interview_topics: list, outreach_message: str, cover_letter: str,
});

export class ClaudeError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

async function claudeJSON(system, user, schema) {
  if (!aiEnabled()) throw new ClaudeError("Claude is not set up. Add ANTHROPIC_API_KEY in your Vercel project settings.", 400);
  const client = new Anthropic({ timeout: 55_000, maxRetries: 1 });
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new ClaudeError("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Vercel.");
    if (error instanceof Anthropic.RateLimitError) throw new ClaudeError("Anthropic rate limit reached. Try again in a minute.", 429);
    if (error instanceof Anthropic.APIConnectionTimeoutError) throw new ClaudeError("Claude took too long to answer. Try again.", 504);
    if (error instanceof Anthropic.APIError) throw new ClaudeError(`Anthropic API error ${error.status ?? ""}: ${error.message}`);
    throw error;
  }
  if (response.stop_reason === "refusal") throw new ClaudeError("Claude declined this request.");
  if (response.stop_reason === "max_tokens") throw new ClaudeError("Claude's answer was cut off. Try again.");
  const block = response.content.find((b) => b.type === "text");
  return JSON.parse(block?.text || "{}");
}

export async function analyzeProfile(cvText = "", liText = "") {
  const parts = [];
  if (liText) parts.push(`<linkedin_profile>\n${liText}\n</linkedin_profile>`);
  if (cvText) parts.push(`<cv>\n${cvText}\n</cv>`);
  const system =
    "You are a senior recruiter and career coach. You read a candidate's CV and/or LinkedIn profile export and " +
    "produce an accurate structured profile used to search LinkedIn for jobs and to coach the candidate. Only state " +
    "facts present in the documents; leave a string or list empty when unknown. years_experience is total " +
    "professional experience (exclude education), 0 if unknown.";
  const user = `${parts.join("\n\n")}

Build the profile:
- titles: roles held, most recent first.
- target_titles: 4–6 LinkedIn job-search queries this person should run — realistic next roles at their level or one step up, plus close adjacent titles recruiters actually use. Plain titles only.
- skills: hard skills, tools and domain expertise, most relevant first (max 40). soft_skills separately.
- search_locations: the candidate's city/country from the documents, formatted as LinkedIn accepts (e.g. "Dubai, United Arab Emirates").
- summary: 2–3 sentences on who this candidate is and what they are best positioned for.
- strengths: 3–5 things that make this profile competitive.
- improvements: 4–8 specific, actionable fixes to the CV/LinkedIn that would raise interview rates (quote the weak part where useful). If both documents are present, flag inconsistencies between them.`;
  const data = await claudeJSON(system, user, PROFILE_SCHEMA);
  return { ...data, source: "ai" };
}

export async function tailorForJob(profile, job, cvText = "") {
  const system = "You are an expert career coach helping a candidate apply to one specific job. Be honest about fit, " +
    "concrete, and never invent experience the candidate does not have.";
  const jobText = `Title: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location}\nSeniority: ${job.seniority || ""}\n` +
    `Employment type: ${job.employment_type || ""}\n\n${job.description || "(no description available)"}`;
  const user = `<candidate_profile>\n${JSON.stringify(profile, null, 1)}\n</candidate_profile>\n\n` +
    (cvText ? `<cv>\n${cvText}\n</cv>\n\n` : "") +
    `<job_posting>\n${jobText}\n</job_posting>\n\n` +
    "Produce: fit_score (0–100, calibrated: 80+ only for a strong match), a one-sentence verdict, why_you_fit (3–5 " +
    "evidence-based points), gaps (with how to address each), cv_tweaks (specific edits to make the CV match this " +
    "posting), keywords_to_add (ATS terms from the posting the CV lacks but the candidate can honestly claim), " +
    "interview_topics (likely questions/areas to prepare), outreach_message (a LinkedIn connection note to the " +
    "recruiter or hiring manager, under 300 characters, use [Name] as placeholder), and cover_letter (under 250 " +
    "words, specific to this company and role).";
  return claudeJSON(system, user, TAILOR_SCHEMA);
}
