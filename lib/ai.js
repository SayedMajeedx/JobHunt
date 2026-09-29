// Picks the AI provider from the environment variables set in Vercel:
//   ANTHROPIC_API_KEY  → Claude (paid API credits)
//   GROQ_API_KEY       → Groq (free tier, no card; prompts aren't used for training)
//   GEMINI_API_KEY     → Google Gemini (free tier; Google may use free-tier content to improve its products)
// AI_MODEL optionally overrides the model for Groq / Gemini.
import * as claude from "./claude.js";
import { parseReply, PROFILE_SHAPE, profileMessages, TAILOR_SHAPE, tailorMessages, withJsonFormat } from "./prompts.js";

const OPENAI_COMPATIBLE = {
  groq: { name: "Groq", env: "GROQ_API_KEY", base: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" },
  gemini: { name: "Gemini", env: "GEMINI_API_KEY", base: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash" },
};

export class AIError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export function provider() {
  if (claude.aiEnabled()) return { id: "claude", name: "Claude" };
  for (const [id, p] of Object.entries(OPENAI_COMPATIBLE)) {
    if (process.env[p.env]) return { id, name: p.name, key: process.env[p.env], base: p.base, model: process.env.AI_MODEL || p.model };
  }
  return null;
}

async function chatJSON(p, messages, shape, jsonMode = true) {
  const { system, user } = withJsonFormat(messages, shape);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  let r;
  try {
    r = await fetch(`${p.base}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
      body: JSON.stringify({
        model: p.model,
        temperature: 0.3,
        max_tokens: 8000,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  } catch (e) {
    throw new AIError(e.name === "AbortError" ? `${p.name} took too long to answer. Try again.` : `Could not reach ${p.name}.`, 504);
  } finally {
    clearTimeout(timer);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || data?.[0]?.error?.message || `HTTP ${r.status}`;
    if (r.status === 400 && jsonMode && /response_format|json/i.test(msg)) return chatJSON(p, messages, shape, false);
    if (r.status === 401 || r.status === 403 || /api key/i.test(msg)) throw new AIError(`The ${p.name} API key was rejected. Check ${OPENAI_COMPATIBLE[p.id].env} in Vercel.`);
    if (r.status === 429) throw new AIError(`${p.name}'s free limit is reached for now. Try again in a minute (or tomorrow if the daily limit is used up).`, 429);
    if (r.status === 404 || /model/i.test(msg)) throw new AIError(`${p.name} doesn't offer the model "${p.model}" any more. Set AI_MODEL in Vercel to a current model.`);
    throw new AIError(`${p.name} error: ${msg}`);
  }
  const text = data?.choices?.[0]?.message?.content || "";
  try {
    return parseReply(text, shape);
  } catch (e) {
    throw new AIError(e.message);
  }
}

function current() {
  const p = provider();
  if (!p) throw new AIError("AI isn't set up. Add a free GROQ_API_KEY in Vercel (see Settings).", 400);
  return p;
}

async function viaClaude(fn) {
  try { return await fn(); } catch (e) { if (e instanceof claude.ClaudeError) throw new AIError(e.message, e.status); throw e; }
}

export async function analyzeProfile(cvText = "", liText = "") {
  const p = current();
  if (p.id === "claude") return viaClaude(() => claude.analyzeProfile(cvText, liText));
  const profile = await chatJSON(p, profileMessages(cvText, liText), PROFILE_SHAPE);
  return { ...profile, seniority: profile.seniority || "associate", source: "ai" };
}

export async function tailorForJob(profile, job, cvText = "") {
  const p = current();
  if (p.id === "claude") return viaClaude(() => claude.tailorForJob(profile, job, cvText));
  const t = await chatJSON(p, tailorMessages(profile, job, cvText), TAILOR_SHAPE);
  return { ...t, fit_score: Math.max(0, Math.min(100, Math.round(t.fit_score))) };
}
