// Claude through the Anthropic API. Used when ANTHROPIC_API_KEY is set (paid API credits, separate from a
// Claude Pro subscription); otherwise lib/ai.js falls back to a free provider such as Groq.
import Anthropic from "@anthropic-ai/sdk";
import { profileMessages, SENIORITY, tailorMessages } from "./prompts.js";

const MODEL = "claude-opus-5";

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

async function claudeJSON({ system, user }, schema) {
  if (!aiEnabled()) throw new ClaudeError("Automatic Claude analysis isn't set up (no ANTHROPIC_API_KEY).", 400);
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
  return { ...(await claudeJSON(profileMessages(cvText, liText), PROFILE_SCHEMA)), source: "ai" };
}

export async function tailorForJob(profile, job, cvText = "") {
  return claudeJSON(tailorMessages(profile, job, cvText), TAILOR_SCHEMA);
}
