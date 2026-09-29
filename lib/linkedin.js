// Fetch one page of LinkedIn's public (logged-out) job search, or one job posting.
// Pacing between requests is done by the browser, which calls these one at a time.
import { parse } from "node-html-parser";

const SEARCH_URL = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
const DETAIL_URL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/";
export const PAGE_SIZE = 10;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const DATE_POSTED = { "24h": "r86400", week: "r604800", month: "r2592000", any: "" };
const WORK_TYPE = { onsite: "1", remote: "2", hybrid: "3" };
const EXPERIENCE = { internship: "1", entry: "2", associate: "3", "mid-senior": "4", director: "5", executive: "6" };
const JOB_TYPE = { "full-time": "F", "part-time": "P", contract: "C", temporary: "T", internship: "I" };

export class RateLimited extends Error {}

async function get(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, { headers: HEADERS, redirect: "follow" });
    if (r.ok) return r.text();
    if (r.status === 400 || r.status === 404) return "";
    if (r.status === 429 || r.status === 999 || r.status >= 500) {
      if (attempt === 0) { await new Promise((s) => setTimeout(s, 2500)); continue; }
      throw new RateLimited(`LinkedIn returned ${r.status}`);
    }
    throw new Error(`LinkedIn returned ${r.status}`);
  }
  return "";
}

const clean = (s) => decode(String(s || "")).replace(/\s+/g, " ").trim();
const text = (el) => (el ? clean(el.text) : "");
const bare = (u) => (u ? u.split("?")[0] : "");

function decode(s) {
  return s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
}

function htmlToText(html) {
  const t = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|ul|ol|h\d)>/gi, "\n")
    .replace(/<(p|div|h\d)[^>]*>/gi, "\n")
    .replace(/<strong[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decode(t).replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function searchPage({ keywords, location = "", start = 0, date_posted = "week", work_types = [],
  experience = [], job_types = [], sort = "R" }) {
  const p = new URLSearchParams({ keywords, location, start: String(start), sortBy: sort === "DD" ? "DD" : "R" });
  if (DATE_POSTED[date_posted]) p.set("f_TPR", DATE_POSTED[date_posted]);
  const codes = (list, map) => list.map((x) => map[x]).filter(Boolean).join(",");
  if (work_types.length) p.set("f_WT", codes(work_types, WORK_TYPE));
  if (experience.length) p.set("f_E", codes(experience, EXPERIENCE));
  if (job_types.length) p.set("f_JT", codes(job_types, JOB_TYPE));

  const root = parse(await get(`${SEARCH_URL}?${p}`));
  const jobs = [];
  for (const card of root.querySelectorAll("div.base-card, div.job-search-card")) {
    const link = card.querySelector("a.base-card__full-link");
    const m = (card.getAttribute("data-entity-urn") || "").match(/(\d+)$/) ||
      (link?.getAttribute("href") || "").match(/-(\d+)(?:\?|$)/);
    if (!m) continue;
    const id = m[1];
    const companyA = card.querySelector("h4.base-search-card__subtitle a");
    const time = card.querySelector("time");
    const logo = card.querySelector("img");
    jobs.push({
      id,
      title: text(card.querySelector("h3.base-search-card__title")),
      company: text(card.querySelector("h4.base-search-card__subtitle")),
      company_url: bare(companyA?.getAttribute("href")),
      location: text(card.querySelector(".job-search-card__location")),
      posted_date: time?.getAttribute("datetime") || "",
      posted_text: text(time),
      salary: text(card.querySelector(".job-search-card__salary-info")),
      url: `https://www.linkedin.com/jobs/view/${id}/`,
      logo: decode(logo?.getAttribute("data-delayed-url") || logo?.getAttribute("src") || ""),
    });
  }
  return jobs;
}

export async function jobDetail(id) {
  if (!/^\d+$/.test(String(id))) throw new Error("Invalid job id");
  const html = await get(DETAIL_URL + id);
  if (!html) return null;
  const root = parse(html);
  const out = {};

  const desc = root.querySelector(".show-more-less-html__markup") || root.querySelector(".description__text");
  if (desc) out.description = htmlToText(desc.innerHTML);

  for (const item of root.querySelectorAll(".description__job-criteria-item")) {
    const k = text(item.querySelector(".description__job-criteria-subheader")).toLowerCase();
    const v = text(item.querySelector(".description__job-criteria-text"));
    if (k.includes("seniority")) out.seniority = v;
    else if (k.includes("employment")) out.employment_type = v;
    else if (k.includes("function")) out.job_function = v;
    else if (k.includes("industr")) out.industries = v;
  }
  const applicants = root.querySelector(".num-applicants__caption") || root.querySelector(".num-applicants__figure");
  if (applicants) out.applicants = text(applicants);
  const salary = root.querySelector(".compensation__salary") || root.querySelector(".salary");
  if (salary) out.salary = text(salary);
  const title = root.querySelector(".top-card-layout__title");
  if (title) out.title = text(title);
  const org = root.querySelector(".topcard__org-name-link");
  if (org) { out.company = text(org); out.company_url = bare(org.getAttribute("href")); }
  const loc = root.querySelector(".topcard__flavor--bullet");
  if (loc) out.location = text(loc);

  const poster = root.querySelector(".message-the-recruiter") || root.querySelector(".hirer-card");
  if (poster) {
    out.poster_name = text(poster.querySelector(".base-main-card__title") || poster.querySelector("h3"));
    out.poster_title = text(poster.querySelector(".base-main-card__subtitle") || poster.querySelector("h4"));
    const a = poster.querySelectorAll("a").find((x) => (x.getAttribute("href") || "").includes("/in/"));
    out.poster_url = bare(a?.getAttribute("href"));
  }

  const code = root.querySelector("code#applyUrl");
  const raw = code ? code.innerHTML : "";
  const m = raw.match(/url=([^&"]+)/) || raw.match(/(https?:\/\/[^"<>\s]+)/);
  if (m) {
    const url = decodeURIComponent(decode(m[1]));
    if (!url.includes("linkedin.com")) out.apply_url = url;
  }
  return out;
}
