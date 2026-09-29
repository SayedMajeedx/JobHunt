"""Fetch job postings from LinkedIn's public (logged-out) job search pages.

No login or cookies are used. Requests are spaced out and back off on
rate-limit responses so a search stays polite and does not get blocked.
"""
import random
import re
import time
from urllib.parse import quote_plus

import requests
from bs4 import BeautifulSoup

SEARCH_URL = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
DETAIL_URL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{}"
PAGE_SIZE = 10

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

# LinkedIn filter codes
DATE_POSTED = {"24h": "r86400", "week": "r604800", "month": "r2592000", "any": ""}
WORK_TYPE = {"onsite": "1", "remote": "2", "hybrid": "3"}
EXPERIENCE = {"internship": "1", "entry": "2", "associate": "3", "mid-senior": "4", "director": "5", "executive": "6"}
JOB_TYPE = {"full-time": "F", "part-time": "P", "contract": "C", "temporary": "T", "internship": "I"}


class RateLimited(Exception):
    pass


_session = requests.Session()
_session.headers.update(HEADERS)


def _get(url, params=None, retries=3):
    delay = 4.0
    for attempt in range(retries + 1):
        try:
            r = _session.get(url, params=params, timeout=25)
        except requests.RequestException:
            if attempt == retries:
                raise
            time.sleep(delay)
            delay *= 2
            continue
        if r.status_code == 200:
            return r.text
        if r.status_code in (429, 999) or r.status_code >= 500:
            if attempt == retries:
                raise RateLimited(f"LinkedIn returned {r.status_code}")
            time.sleep(delay + random.uniform(0, 2))
            delay *= 2
            continue
        if r.status_code in (400, 404):
            return ""
        r.raise_for_status()
    return ""


def polite_pause():
    time.sleep(random.uniform(1.2, 2.6))


def _text(el):
    return " ".join(el.get_text(" ", strip=True).split()) if el else ""


def _clean_url(url):
    return url.split("?")[0] if url else ""


def search_page(keywords, location="", start=0, date_posted="week", work_types=(),
                experience=(), job_types=(), sort="R"):
    params = {"keywords": keywords, "location": location, "start": start, "sortBy": sort}
    if DATE_POSTED.get(date_posted):
        params["f_TPR"] = DATE_POSTED[date_posted]
    if work_types:
        params["f_WT"] = ",".join(WORK_TYPE[w] for w in work_types if w in WORK_TYPE)
    if experience:
        params["f_E"] = ",".join(EXPERIENCE[e] for e in experience if e in EXPERIENCE)
    if job_types:
        params["f_JT"] = ",".join(JOB_TYPE[j] for j in job_types if j in JOB_TYPE)

    html = _get(SEARCH_URL, params)
    soup = BeautifulSoup(html, "html.parser")
    jobs = []
    for card in soup.select("div.base-card, div.job-search-card"):
        urn = card.get("data-entity-urn", "")
        m = re.search(r"(\d+)$", urn)
        link = card.select_one("a.base-card__full-link")
        if not m and link:
            m = re.search(r"-(\d+)(?:\?|$)", link.get("href", ""))
        if not m:
            continue
        company_a = card.select_one("h4.base-search-card__subtitle a")
        time_el = card.select_one("time")
        logo = card.select_one("img")
        jobs.append({
            "id": m.group(1),
            "title": _text(card.select_one("h3.base-search-card__title")),
            "company": _text(card.select_one("h4.base-search-card__subtitle")),
            "company_url": _clean_url(company_a.get("href")) if company_a else "",
            "location": _text(card.select_one(".job-search-card__location")),
            "posted_date": time_el.get("datetime", "") if time_el else "",
            "posted_text": _text(time_el),
            "salary": _text(card.select_one(".job-search-card__salary-info")),
            "url": f"https://www.linkedin.com/jobs/view/{m.group(1)}/",
            "logo": (logo.get("data-delayed-url") or logo.get("src") or "") if logo else "",
        })
    return jobs


def job_detail(job_id):
    html = _get(DETAIL_URL.format(job_id))
    if not html:
        return {}
    soup = BeautifulSoup(html, "html.parser")
    out = {}

    desc = soup.select_one(".show-more-less-html__markup") or soup.select_one(".description__text")
    if desc:
        for br in desc.find_all("br"):
            br.replace_with("\n")
        for li in desc.find_all("li"):
            li.insert_before("\n• ")
        for p in desc.find_all(["p", "h1", "h2", "h3", "strong"]):
            p.insert_before("\n")
        text = desc.get_text("")
        out["description"] = re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", text)).strip()

    for item in soup.select(".description__job-criteria-item"):
        key = _text(item.select_one(".description__job-criteria-subheader")).lower()
        val = _text(item.select_one(".description__job-criteria-text"))
        if "seniority" in key:
            out["seniority"] = val
        elif "employment" in key:
            out["employment_type"] = val
        elif "function" in key:
            out["job_function"] = val
        elif "industr" in key:
            out["industries"] = val

    applicants = soup.select_one(".num-applicants__caption") or soup.select_one(".num-applicants__figure")
    if applicants:
        out["applicants"] = _text(applicants)

    salary = soup.select_one(".compensation__salary") or soup.select_one(".salary")
    if salary:
        out["salary"] = _text(salary)

    title = soup.select_one(".top-card-layout__title")
    if title:
        out["title"] = _text(title)
    org = soup.select_one(".topcard__org-name-link")
    if org:
        out["company"] = _text(org)
        out["company_url"] = _clean_url(org.get("href"))
    loc = soup.select_one(".topcard__flavor--bullet")
    if loc:
        out["location"] = _text(loc)

    # "Meet the hiring team" / job poster, shown on some postings
    poster = soup.select_one(".message-the-recruiter") or soup.select_one(".hirer-card")
    if poster:
        name = poster.select_one(".base-main-card__title") or poster.select_one("h3")
        role = poster.select_one(".base-main-card__subtitle") or poster.select_one("h4")
        a = poster.select_one("a[href*='/in/']")
        out["poster_name"] = _text(name)
        out["poster_title"] = _text(role)
        out["poster_url"] = _clean_url(a.get("href")) if a else ""

    # external "apply on company site" link, when LinkedIn exposes it to logged-out visitors
    code = soup.select_one("code#applyUrl")
    raw = code.string if code is not None and code.string else ""
    m = re.search(r"url=([^&\"]+)", raw) or re.search(r"(https?://[^\"<>\s]+)", raw)
    if m:
        url = requests.utils.unquote(m.group(1))
        if "linkedin.com" not in url:
            out["apply_url"] = url
    return out


def people_search_links(company, title=""):
    """Links the user can open in their own logged-in browser to find contacts."""
    c = quote_plus(f'"{company}"') if company else ""
    return {
        "recruiters": f"https://www.linkedin.com/search/results/people/?keywords={quote_plus('recruiter talent acquisition')}%20{c}",
        "hiring_manager": f"https://www.linkedin.com/search/results/people/?keywords={quote_plus(_manager_query(title))}%20{c}",
        "team": f"https://www.linkedin.com/search/results/people/?keywords={quote_plus(_core_title(title))}%20{c}",
        "careers": f"https://www.google.com/search?q={quote_plus(f'{company} careers {title}')}",
    }


def _core_title(title):
    t = re.sub(r"(?i)\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|head of|ii|iii|iv)\b", "", title or "")
    return " ".join(t.split())


def _manager_query(title):
    core = _core_title(title)
    return f"{core} manager" if core else "hiring manager"
