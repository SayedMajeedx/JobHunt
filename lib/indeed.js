// Indeed (and other boards) through JSearch, which reads Google for Jobs.
// Indeed has no public API and blocks cloud servers, so this is the reliable free route.
// Free plan on RapidAPI: about 200 requests/month, no card. One request = one page of ~10 jobs.
// Set RAPIDAPI_KEY in Vercel. Each result already includes the full description.
import { createHash } from "node:crypto";

const HOST = "jsearch.p.rapidapi.com";
// Current endpoint first; the older one is kept as a fallback in case an account still uses it.
const ENDPOINTS = [`https://${HOST}/search-v2`, `https://${HOST}/search`];
export const configured = () => Boolean(process.env.RAPIDAPI_KEY);

export class QuotaExceeded extends Error {}

const DATE_POSTED = { "24h": "today", week: "week", month: "month", any: "all" };
const JOB_TYPE = { "full-time": "FULLTIME", "part-time": "PARTTIME", contract: "CONTRACTOR", internship: "INTERN" };
const EMPLOYMENT = { FULLTIME: "Full-time", PARTTIME: "Part-time", CONTRACTOR: "Contract", INTERN: "Internship" };

// JSearch returns US jobs unless it is told the country, so derive it from the location.
const COUNTRY = {
  "united arab emirates": "ae", uae: "ae", dubai: "ae", "abu dhabi": "ae", sharjah: "ae", ajman: "ae",
  "saudi arabia": "sa", ksa: "sa", riyadh: "sa", jeddah: "sa", dammam: "sa", qatar: "qa", doha: "qa",
  kuwait: "kw", "kuwait city": "kw", bahrain: "bh", manama: "bh", oman: "om", muscat: "om",
  egypt: "eg", cairo: "eg", jordan: "jo", amman: "jo", lebanon: "lb", beirut: "lb", morocco: "ma",
  turkey: "tr", türkiye: "tr", istanbul: "tr", pakistan: "pk", karachi: "pk", lahore: "pk", india: "in",
  bangalore: "in", bengaluru: "in", mumbai: "in", delhi: "in", philippines: "ph", manila: "ph",
  singapore: "sg", malaysia: "my", "kuala lumpur": "my", indonesia: "id", jakarta: "id", "hong kong": "hk",
  japan: "jp", tokyo: "jp", australia: "au", sydney: "au", melbourne: "au", "new zealand": "nz",
  "united kingdom": "gb", uk: "gb", england: "gb", london: "gb", manchester: "gb", ireland: "ie", dublin: "ie",
  germany: "de", berlin: "de", munich: "de", france: "fr", paris: "fr", spain: "es", madrid: "es",
  netherlands: "nl", amsterdam: "nl", belgium: "be", switzerland: "ch", zurich: "ch", austria: "at",
  italy: "it", milan: "it", portugal: "pt", lisbon: "pt", sweden: "se", norway: "no", denmark: "dk",
  finland: "fi", poland: "pl", warsaw: "pl", canada: "ca", toronto: "ca", vancouver: "ca",
  "united states": "us", usa: "us", "new york": "us", mexico: "mx", brazil: "br", "south africa": "za",
  nigeria: "ng", kenya: "ke",
};

export function countryOf(location) {
  const parts = String(location || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  for (const part of parts.reverse()) if (COUNTRY[part]) return COUNTRY[part];
  return "";
}

// Same shape as a LinkedIn card, so the rest of the app treats both alike.
// LinkedIn's own listings are excluded to avoid duplicates; they come from the LinkedIn search.
export async function searchPage({ keywords, location = "", date_posted = "week", work_types = [], job_types = [] }) {
  const p = new URLSearchParams({
    query: location ? `${keywords} in ${location}` : keywords,
    num_pages: "1", date_posted: DATE_POSTED[date_posted] || "week",
    exclude_job_publishers: "LinkedIn",
  });
  const country = countryOf(location);
  if (country) p.set("country", country);
  const types = job_types.map((x) => JOB_TYPE[x]).filter(Boolean);
  if (types.length) p.set("employment_types", types.join(","));
  if (work_types.length === 1 && work_types[0] === "remote") p.set("work_from_home", "true");

  let r;
  for (const endpoint of ENDPOINTS) {
    r = await fetch(`${endpoint}?${p}`, { headers: { "x-rapidapi-key": process.env.RAPIDAPI_KEY, "x-rapidapi-host": HOST } });
    if (r.status !== 404) break;
  }
  if (r.status === 429 || r.status === 402) throw new QuotaExceeded(`JSearch returned ${r.status}`);
  if (r.status === 401 || r.status === 403) throw new Error("JSearch rejected the RAPIDAPI_KEY. Check the key and that you subscribed to JSearch's free Basic plan.");
  if (r.status === 404) throw new Error("JSearch's search address wasn't found. Check that you subscribed to JSearch (by OpenWeb Ninja) on RapidAPI.");
  if (!r.ok) throw new Error(`JSearch returned ${r.status}`);

  const body = await r.json();
  const list = Array.isArray(body.data) ? body.data : Array.isArray(body.data?.jobs) ? body.data.jobs : [];
  const quota = {
    remaining: num(r.headers.get("x-ratelimit-requests-remaining")),
    limit: num(r.headers.get("x-ratelimit-requests-limit")),
  };
  return { jobs: list.map(toJob).filter(Boolean), quota: quota.remaining === null ? null : quota };
}

const num = (v) => (v === null || v === "" || Number.isNaN(+v) ? null : +v);

function toJob(j) {
  if (!j.job_id || !j.job_title) return null;
  const options = Array.isArray(j.apply_options) ? j.apply_options : [];
  const indeed = options.find((o) => /indeed/i.test(o.publisher || "") || /indeed\./i.test(o.apply_link || ""));
  const url = indeed?.apply_link || j.job_apply_link || j.job_google_link || "";
  if (!/^https?:\/\//.test(url)) return null;
  const direct = options.find((o) => o.is_direct && o.apply_link);
  const posted = j.job_posted_at_datetime_utc ||
    (Number(j.job_posted_at_timestamp) ? new Date(Number(j.job_posted_at_timestamp) * 1000).toISOString() : "");
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
    employment_type: EMPLOYMENT[j.job_employment_type] || j.job_employment_type || "",
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
