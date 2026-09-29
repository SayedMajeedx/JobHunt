// Prompts shared by every AI provider JobHunt can use (Claude via the Anthropic API, or a free provider such as Groq).

export const SENIORITY = ["internship", "entry", "associate", "mid-senior", "director", "executive"];

// shape of each answer: "" = text, 0 = number, [] = list of text
export const PROFILE_SHAPE = {
  name: "", headline: "", email: "", phone: "", linkedin_url: "", location: "", years_experience: 0,
  seniority: "", current_title: "", titles: [], target_titles: [], skills: [], soft_skills: [], industries: [],
  languages: [], education: [], certifications: [], search_locations: [], summary: "", strengths: [], improvements: [],
};
export const TAILOR_SHAPE = {
  fit_score: 0, verdict: "", why_you_fit: [], gaps: [], cv_tweaks: [], keywords_to_add: [], interview_topics: [],
  outreach_message: "", cover_letter: "",
};

export function profileMessages(cvText = "", liText = "") {
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
- seniority: one of ${SENIORITY.join(", ")}.
- titles: roles held, most recent first.
- target_titles: 4–6 LinkedIn job-search queries this person should run — realistic next roles at their level or one step up, plus close adjacent titles recruiters actually use. Plain titles only.
- skills: hard skills, tools and domain expertise, most relevant first (max 40). soft_skills separately.
- search_locations: the candidate's city/country from the documents, formatted as LinkedIn accepts (e.g. "Dubai, United Arab Emirates").
- summary: 2–3 sentences on who this candidate is and what they are best positioned for.
- strengths: 3–5 things that make this profile competitive.
- improvements: 4–8 specific, actionable fixes to the CV/LinkedIn that would raise interview rates (quote the weak part where useful). If both documents are present, flag inconsistencies between them.`;
  return { system, user };
}

export function tailorMessages(profile, job, cvText = "") {
  const system = "You are an expert career coach helping a candidate apply to one specific job. Be honest about fit, " +
    "concrete, and never invent experience the candidate does not have.";
  const jobText = `Title: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location || ""}\nSeniority: ${job.seniority || ""}\n` +
    `Employment type: ${job.employment_type || ""}\n\n${job.description || "(no description available)"}`;
  const cleanProfile = { ...profile };
  delete cleanProfile.analyzed_at;
  const user = `<candidate_profile>\n${JSON.stringify(cleanProfile, null, 1)}\n</candidate_profile>\n\n` +
    (cvText ? `<cv>\n${cvText}\n</cv>\n\n` : "") +
    `<job_posting>\n${jobText}\n</job_posting>\n\n` +
    "Produce: fit_score (0–100, calibrated: 80+ only for a strong match), a one-sentence verdict, why_you_fit (3–5 " +
    "evidence-based points), gaps (with how to address each), cv_tweaks (specific edits to make the CV match this " +
    "posting), keywords_to_add (ATS terms from the posting the CV lacks but the candidate can honestly claim), " +
    "interview_topics (likely questions/areas to prepare), outreach_message (a LinkedIn connection note to the " +
    "recruiter or hiring manager, under 300 characters, use [Name] as placeholder), and cover_letter (under 250 " +
    "words, specific to this company and role).";
  return { system, user };
}

/** Adds the answer format to the request, for models without built-in schema support. */
export function withJsonFormat({ system, user }, shape) {
  return {
    system,
    user: `${user}\n\nReply with ONLY a JSON object, no other text, using exactly these keys ` +
      `("" = text, 0 = number, [] = list of text):\n${JSON.stringify(shape, null, 1)}`,
  };
}

/** Read a model's reply and return an object with exactly the keys of `shape`. */
export function parseReply(text, shape) {
  const src = String(text || "");
  const fenced = src.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fenced ? fenced[1] : src;
  const a = body.indexOf("{"), b = body.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("The AI didn't return an answer in the expected format. Try again.");
  body = body.slice(a, b + 1);
  let data;
  try { data = JSON.parse(body); }
  catch { throw new Error("The AI's answer was incomplete. Try again."); }

  const out = {};
  for (const [k, def] of Object.entries(shape)) {
    const v = data[k];
    if (Array.isArray(def)) out[k] = Array.isArray(v) ? v.map((x) => String(typeof x === "object" ? JSON.stringify(x) : x)).filter(Boolean) : v ? [String(v)] : [];
    else if (typeof def === "number") out[k] = Number.isFinite(+v) ? +v : 0;
    else out[k] = v == null ? "" : String(v);
  }
  if (out.seniority !== undefined && !SENIORITY.includes(out.seniority)) out.seniority = "";
  const filled = Object.keys(shape).filter((k) => data[k] !== undefined).length;
  if (filled < Object.keys(shape).length / 2) throw new Error("The AI's answer was missing most of the details. Try again.");
  return out;
}
