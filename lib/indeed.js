// Indeed (and other boards) through JSearch, which reads Google for Jobs.
// Indeed has no public API and blocks cloud servers, so this is the reliable free route.
// Free plan on RapidAPI: 200 requests/month, no card. One request = one page of ~10 jobs.
// Set RAPIDAPI_KEY in Vercel. Each result already includes the full description.
import { createHash } from "node:crypto";

const URL_ = "https://jsearch.p.rapidapi.com/search";
export const configured = () => Boolean(process.env.RAPIDAPI_KEY);

export class QuotaExceeded extends Error {}

const DATE_POSTED = { "24h": "today", week: "week", month: "month", any: "all" };
const JOB_TYPE = { "full-time": "FULLTIME", "part-time": "PARTTIME", contract: "CONTRACTOR", internship: "INTERN" };
const EMPLOYMENT = { FULLTIME: "Full-time", PARTTIME: "Part-time", CONTRACTOR: "Contract", INTERN: "Internship" };

// Same shape as a LinkedIn card, so the rest of the app treats both alike.
// LinkedIn's own listings are excluded to avoid duplicates; they come from the LinkedIn search.
export async function searchPage({ keywords, location = "", page = 1, date_posted = "week", work_types = [], job_types = [] }) {
  const p = new URLSearchParams({
    query: location ? `${keywords} in ${location}` : keywords,
    page: String(page), num_pages: "1", date_posted: DATE_POSTED[date_posted] || "week",
    exclude_job_publishers: "LinkedIn",
  });
  const types = job_types.map((x) => JOB_TYPE[x]).filter(Boolean);
  if (types.length) p.set("employment_types", types.join(","));
  if (work_types.length === 1 && work_types[0] === "remote") p.set("work_from_home", "true");

  const r = await fetch(`${URL_}?${p}`, {
    headers: { "x-rapidapi-key": process.env.RAPIDAPI_KEY, "x-rapidapi-host": "jsearch.p.rapidapi.com" },
  });
  if (r.status === 429 || r.status === 402) throw new QuotaExceeded(`JSearch returned ${r.status}`);
  if (r.status === 401 || r.status === 403) throw new Error("JSearch rejected the RAPIDAPI_KEY. Check the key and that you subscribed to JSearch's free plan.");
  if (!r.ok) throw new Error(`JSearch returned ${r.status}`);
  const body = await r.json();
  return (body.data || []).map(toJob).filter(Boolean);
}

function toJob(j) {
  if (!j.job_id || !j.job_title) return null;
  const indeed = (j.apply_options || []).find((o) => /indeed/i.test(o.publisher || "") || /indeed\./i.test(o.apply_link || ""));
  const url = indeed?.apply_link || j.job_apply_link || "";
  if (!/^https?:\/\//.test(url)) return null;
  const direct = (j.apply_options || []).find((o) => o.is_direct && o.apply_link);
  const posted = j.job_posted_at_datetime_utc || "";
  return {
    id: "g" + createHash("sha1").update(String(j.job_id)).digest("hex").slice(0, 16),
    title: j.job_title,
    company: j.employer_name || "",
    company_url: j.employer_website || "",
    location: j.job_location || [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", "),
    posted_date: posted,
    posted_text: ago(posted),
    salary: salary(j),
    url,
    apply_url: direct && direct.apply_link !== url ? direct.apply_link : "",
    logo: j.employer_logo || "",
    description: String(j.job_description || "").trim(),
    employment_type: EMPLOYMENT[j.job_employment_type] || "",
  };
}

function salary(j) {
  const { job_min_salary: lo, job_max_salary: hi, job_salary_currency: cur, job_salary_period: per } = j;
  if (!lo && !hi) return "";
  const n = (v) => Math.round(v).toLocaleString("en-US");
  const range = lo && hi && lo !== hi ? `${n(lo)}–${n(hi)}` : n(lo || hi);
  return `${cur || ""} ${range}${per ? ` per ${String(per).toLowerCase()}` : ""}`.trim();
}

function ago(iso) {
  const t = Date.parse(iso);
  if (!t) return "";
  const d = Math.floor((Date.now() - t) / 86400000);
  if (d < 1) return "Today";
  if (d < 14) return `${d} day${d > 1 ? "s" : ""} ago`;
  return d < 60 ? `${Math.floor(d / 7)} weeks ago` : `${Math.floor(d / 30)} months ago`;
}
