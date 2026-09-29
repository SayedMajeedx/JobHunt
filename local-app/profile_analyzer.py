"""Turn a CV and/or LinkedIn profile PDF into a structured profile, and score jobs against it.

Two analyzers produce the same profile shape:
  * analyze_builtin  - offline, rule based, always available
  * analyze_with_claude - richer analysis when an Anthropic API key is configured
"""
import io
import json
import re
from datetime import date

from pypdf import PdfReader

# --------------------------------------------------------------------------- PDF

def pdf_to_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    pages = [(p.extract_text() or "") for p in reader.pages]
    text = "\n".join(pages)
    text = text.replace(" ", " ").replace("", "•")
    text = re.sub(r"Page \d+ of \d+", "", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


# --------------------------------------------------------------------------- vocabularies

SKILLS = [
    # programming & software
    "Python", "Java", "JavaScript", "TypeScript", "C++", "C#", ".NET", "ASP.NET", "PHP", "Ruby", "Golang", "Rust",
    "Kotlin", "Swift", "Scala", "Perl", "MATLAB", "VBA", "Bash", "PowerShell", "SQL", "NoSQL", "T-SQL", "PL/SQL",
    "HTML", "CSS", "React", "React Native", "Angular", "Vue", "Next.js", "Node.js", "Express", "Django", "Flask",
    "FastAPI", "Spring", "Spring Boot", "Laravel", "Rails", "Flutter", "GraphQL", "REST", "REST API", "Microservices",
    "Git", "GitHub", "GitLab", "CI/CD", "Jenkins", "Docker", "Kubernetes", "Terraform", "Ansible", "Linux",
    "AWS", "Azure", "GCP", "Google Cloud", "Serverless", "Lambda", "DevOps", "SRE", "Agile", "Scrum", "Kanban",
    "Jira", "Confluence", "Unit Testing", "Test Automation", "Selenium", "Cypress", "QA", "System Design",
    "Object-Oriented Programming", "Data Structures", "Algorithms", "API Design", "Mobile Development",
    "Web Development", "Full Stack", "Frontend", "Backend", "Embedded Systems", "IoT",
    # data & AI
    "Data Analysis", "Data Analytics", "Data Science", "Data Engineering", "Data Visualization", "Data Modeling",
    "Data Warehousing", "Data Governance", "Data Quality", "ETL", "ELT", "Big Data", "Spark", "PySpark", "Hadoop",
    "Kafka", "Airflow", "dbt", "Snowflake", "Databricks", "BigQuery", "Redshift", "PostgreSQL", "MySQL",
    "SQL Server", "Oracle", "MongoDB", "Redis", "Elasticsearch", "Excel", "Advanced Excel", "Power Query",
    "Pivot Tables", "Power BI", "Tableau", "Looker", "Qlik", "SSRS", "SSIS", "DAX", "Google Analytics",
    "Statistics", "Statistical Analysis", "A/B Testing", "Forecasting", "Predictive Modeling", "Machine Learning",
    "Deep Learning", "NLP", "Natural Language Processing", "Computer Vision", "LLM", "Generative AI",
    "Prompt Engineering", "TensorFlow", "PyTorch", "scikit-learn", "Pandas", "NumPy", "R Programming", "SAS",
    "SPSS", "Stata", "MLOps", "Business Intelligence", "Reporting", "Dashboards", "KPI", "Data Mining",
    # security & infrastructure
    "Cybersecurity", "Information Security", "Network Security", "SIEM", "SOC", "Penetration Testing",
    "Vulnerability Management", "ISO 27001", "NIST", "IAM", "Firewall", "Networking", "TCP/IP", "Cisco",
    "Active Directory", "Windows Server", "VMware", "ITIL", "IT Support", "Help Desk", "ServiceNow",
    # product, project, business
    "Project Management", "Program Management", "Product Management", "Product Strategy", "Roadmapping",
    "Stakeholder Management", "Requirements Gathering", "Business Analysis", "Process Improvement",
    "Business Process", "Change Management", "Risk Management", "Strategic Planning", "Strategy",
    "Business Development", "Operations Management", "Operations", "Supply Chain", "Logistics", "Procurement",
    "Inventory Management", "Vendor Management", "Contract Management", "Negotiation", "Budgeting",
    "Lean", "Six Sigma", "PMP", "PRINCE2", "OKRs", "Market Research", "Competitive Analysis", "Consulting",
    "Management Consulting", "Due Diligence", "Business Strategy", "Digital Transformation", "ERP", "SAP",
    "Oracle ERP", "Microsoft Dynamics", "Salesforce", "HubSpot", "CRM", "Zoho", "Odoo",
    # finance & accounting
    "Financial Analysis", "Financial Modeling", "Financial Reporting", "FP&A", "Accounting", "Bookkeeping",
    "Auditing", "Internal Audit", "External Audit", "IFRS", "GAAP", "Tax", "VAT", "Corporate Finance",
    "Valuation", "Investment Banking", "Private Equity", "Asset Management", "Portfolio Management",
    "Treasury", "Cash Flow", "Accounts Payable", "Accounts Receivable", "Payroll", "Reconciliation",
    "Cost Accounting", "Compliance", "AML", "KYC", "Credit Analysis", "Credit Risk", "Underwriting",
    "Banking", "Insurance", "Fintech", "QuickBooks", "Xero", "CFA", "ACCA", "CPA", "CMA",
    # marketing, sales, communication
    "Digital Marketing", "Marketing Strategy", "Content Marketing", "Social Media", "Social Media Marketing",
    "SEO", "SEM", "PPC", "Google Ads", "Meta Ads", "Email Marketing", "Marketing Automation", "Brand Management",
    "Branding", "Copywriting", "Content Creation", "Content Strategy", "Public Relations", "Communications",
    "Event Management", "Growth Marketing", "Performance Marketing", "E-commerce", "Shopify", "Sales",
    "B2B Sales", "B2C", "Account Management", "Key Account Management", "Lead Generation", "Cold Calling",
    "Customer Success", "Customer Service", "Customer Experience", "Client Relationship Management",
    "Presentation Skills", "Public Speaking", "Business Writing", "Pricing", "Merchandising", "Retail",
    # people & admin
    "Human Resources", "Recruitment", "Talent Acquisition", "Sourcing", "Onboarding", "Employee Relations",
    "Performance Management", "Compensation and Benefits", "Learning and Development", "Training",
    "HRIS", "Workday", "Organizational Development", "Labor Law", "Office Management", "Administration",
    "Executive Support", "Scheduling", "Data Entry", "Documentation", "Technical Writing",
    # design & media
    "UX", "UI", "UX Design", "UI Design", "User Research", "Wireframing", "Prototyping", "Figma", "Sketch",
    "Adobe XD", "Adobe Photoshop", "Adobe Illustrator", "Adobe InDesign", "Adobe Premiere", "After Effects",
    "Graphic Design", "Motion Graphics", "Video Editing", "Photography", "AutoCAD", "Revit", "SolidWorks",
    "3D Modeling", "Canva",
    # engineering, construction, health, other
    "Mechanical Engineering", "Electrical Engineering", "Civil Engineering", "Structural Engineering",
    "HVAC", "MEP", "Construction Management", "Site Management", "Quantity Surveying", "Cost Estimation",
    "Primavera", "MS Project", "Health and Safety", "HSE", "Quality Assurance", "Quality Control", "ISO 9001",
    "Manufacturing", "Maintenance", "PLC", "SCADA", "Oil and Gas", "Renewable Energy", "Telecommunications",
    "Real Estate", "Property Management", "Facilities Management", "Hospitality", "Food and Beverage",
    "Patient Care", "Clinical Research", "Healthcare", "Pharmaceuticals", "Nursing", "Medical Devices",
    "Regulatory Affairs", "GMP", "Teaching", "Curriculum Development", "Education", "Legal", "Contract Law",
    "Litigation", "Corporate Law", "Research", "Microsoft Office", "Microsoft Word", "PowerPoint", "Outlook",
    "Google Workspace", "Leadership", "Team Leadership", "People Management", "Mentoring", "Coaching",
    "Problem Solving", "Critical Thinking", "Communication", "Teamwork", "Time Management", "Analytical Skills",
    "Attention to Detail", "Decision Making", "Cross-functional Collaboration", "Multitasking", "Adaptability",
]
SOFT_SKILLS = {
    "Leadership", "Team Leadership", "People Management", "Mentoring", "Coaching", "Problem Solving",
    "Critical Thinking", "Communication", "Teamwork", "Time Management", "Analytical Skills",
    "Attention to Detail", "Decision Making", "Cross-functional Collaboration", "Multitasking", "Adaptability",
    "Presentation Skills", "Public Speaking", "Negotiation", "Stakeholder Management",
}
ALIASES = {
    "Golang": ["Go lang", "Golang"], "R Programming": ["R programming", "RStudio"],
    "Natural Language Processing": ["Natural Language Processing"], "Google Cloud": ["Google Cloud Platform"],
    "Machine Learning": ["Machine Learning", "ML models"], "Power BI": ["Power BI", "PowerBI"],
    "Node.js": ["Node.js", "NodeJS", "Node JS"], "Microsoft Office": ["MS Office", "Microsoft Office"],
    "Excel": ["Excel", "MS Excel"], "Human Resources": ["Human Resources", "HR"],
    "Customer Service": ["Customer Service", "Customer Support"], "UX": ["UX"], "UI": ["UI"],
}

ROLE_WORDS = (
    "manager", "engineer", "analyst", "developer", "consultant", "specialist", "director", "lead", "officer",
    "coordinator", "executive", "designer", "accountant", "administrator", "associate", "head", "architect",
    "scientist", "intern", "assistant", "supervisor", "representative", "advisor", "adviser", "strategist",
    "planner", "technician", "teacher", "lecturer", "nurse", "controller", "auditor", "president", "founder",
    "owner", "partner", "programmer", "researcher", "agent", "clerk", "buyer", "recruiter", "trainer",
    "writer", "editor", "producer", "marketer", "chief", "vp", "cto", "ceo", "cfo", "coo", "surveyor",
    "estimator", "inspector", "operator", "tester", "support", "partner", "tutor", "pharmacist", "physician",
    "doctor", "lawyer", "counsel", "paralegal", "cashier", "banker", "trader", "underwriter", "product owner",
    "scrum master", "sales", "secretary", "receptionist",
)
SENIORITY_ORDER = ["internship", "entry", "associate", "mid-senior", "director", "executive"]
LINKEDIN_SENIORITY = {
    "internship": "internship", "entry level": "entry", "associate": "associate",
    "mid-senior level": "mid-senior", "director": "director", "executive": "executive",
}
COUNTRIES = {
    "united arab emirates", "uae", "saudi arabia", "ksa", "qatar", "kuwait", "bahrain", "oman", "egypt", "jordan",
    "lebanon", "iraq", "morocco", "tunisia", "algeria", "turkey", "türkiye", "pakistan", "india", "bangladesh",
    "sri lanka", "nepal", "philippines", "indonesia", "malaysia", "singapore", "thailand", "vietnam", "china",
    "hong kong", "japan", "south korea", "australia", "new zealand", "united kingdom", "uk", "england", "scotland",
    "ireland", "germany", "france", "spain", "portugal", "italy", "netherlands", "belgium", "switzerland",
    "austria", "sweden", "norway", "denmark", "finland", "poland", "czechia", "romania", "greece", "hungary",
    "united states", "usa", "canada", "mexico", "brazil", "argentina", "chile", "colombia", "peru",
    "south africa", "nigeria", "kenya", "ghana", "ethiopia",
}
MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
HEADINGS = re.compile(
    r"^(contact|top skills|skills|core skills|key skills|technical skills|competencies|core competencies|languages|"
    r"certifications?|licenses? (&|and) certifications|honors?[- ]awards|awards|publications|summary|"
    r"professional summary|profile|about|about me|objective|career objective|experience|work experience|"
    r"professional experience|employment history|work history|career history|education|academic background|"
    r"projects|volunteer(ing)?( experience)?|interests|hobbies|references|achievements|key achievements|"
    r"training|courses|personal (details|information))\s*:?$", re.I)

WEAK_PHRASES = ["responsible for", "worked on", "helped with", "duties included", "tasked with", "involved in"]


def _skill_pattern(term):
    return re.compile(r"(?<![A-Za-z0-9+#])" + re.escape(term) + r"(?![A-Za-z0-9+#])", re.I)


_SKILL_PATTERNS = []
for s in SKILLS:
    variants = ALIASES.get(s, [s])
    _SKILL_PATTERNS.append((s, [_skill_pattern(v) for v in variants]))


def find_skills(text):
    found = []
    for name, pats in _SKILL_PATTERNS:
        if any(p.search(text) for p in pats):
            found.append(name)
    # drop generic terms when a more specific one matched (e.g. "Excel" when "Advanced Excel")
    lower = {f.lower() for f in found}
    return [f for f in found if not any(f.lower() != o and f.lower() in o.split() for o in lower)] or found


# --------------------------------------------------------------------------- helpers

def _lines(text):
    return [l.strip(" \t•·-–—*|") for l in text.splitlines()]


def _section(lines, names, stop_any=True):
    """Lines under the first heading matching one of `names`, up to the next heading."""
    out, inside = [], False
    for l in lines:
        if not l:
            if inside:
                out.append("")
            continue
        is_head = bool(HEADINGS.match(l))
        if inside and is_head and stop_any:
            break
        if is_head and re.match(r"^(" + "|".join(names) + r")\s*:?$", l, re.I):
            inside = True
            continue
        if inside:
            out.append(l)
    return out


DATE_RANGE = re.compile(
    r"(?:(?P<m1>jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+|(?P<n1>\d{1,2})[/.-])?"
    r"(?P<y1>(?:19|20)\d{2})\s*(?:-|–|—|to|until)\s*"
    r"(?:(?:(?P<m2>jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+|(?P<n2>\d{1,2})[/.-])?"
    r"(?P<y2>(?:19|20)\d{2})|(?P<now>present|current|now|today|date|ongoing))", re.I)


def _range_months(m):
    today = date.today()
    y1 = int(m.group("y1"))
    mo1 = MONTHS.get((m.group("m1") or "")[:3].lower()) or int(m.group("n1") or 1)
    if m.group("now"):
        y2, mo2 = today.year, today.month
    else:
        y2 = int(m.group("y2"))
        mo2 = MONTHS.get((m.group("m2") or "")[:3].lower()) or int(m.group("n2") or 12)
    a, b = y1 * 12 + min(max(mo1, 1), 12), y2 * 12 + min(max(mo2, 1), 12)
    return (a, b) if b >= a else None


def _years_from_ranges(ranges):
    ranges = sorted(r for r in ranges if r)
    total, cur = 0, None
    for a, b in ranges:
        if cur and a <= cur[1]:
            cur = (cur[0], max(cur[1], b))
        else:
            if cur:
                total += cur[1] - cur[0] + 1
            cur = (a, b)
    if cur:
        total += cur[1] - cur[0] + 1
    return round(total / 12, 1)


def _looks_like_title(s):
    if not s or len(s) > 90 or len(s) < 3 or "@" in s or "http" in s.lower():
        return False
    low = s.lower()
    return any(re.search(r"\b" + re.escape(w) + r"\b", low) for w in ROLE_WORDS)


def _clean_title(s):
    s = DATE_RANGE.sub("", s)
    s = re.sub(r"\(.*?\)", "", s)
    for part in re.split(r"\s[|•·@–—-]\s|,\s| at ", s):
        part = part.strip(" ,|-–—")
        if _looks_like_title(part):
            return part
    return ""


def core_title(t):
    t = re.sub(r"(?i)\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|head of|i{1,3}|iv|trainee)\b", "", t or "")
    return " ".join(t.replace(" ,", ",").split()).strip(" ,-")


def seniority_from(years, titles):
    t = " ".join(titles[:2]).lower()
    if re.search(r"\b(chief|ceo|cto|cfo|coo|founder|president|vp|vice president)\b", t):
        return "executive"
    if re.search(r"\b(director|head of|head)\b", t):
        return "director"
    if re.search(r"\bintern", t):
        return "internship"
    if years is None:
        years = 0
    if re.search(r"\b(senior|sr|lead|manager|principal|staff)\b", t) or years >= 5:
        return "mid-senior"
    if years >= 2:
        return "associate"
    return "entry"


# --------------------------------------------------------------------------- built-in analyzer

def analyze_builtin(cv_text="", li_text=""):
    text = "\n".join(t for t in (li_text, cv_text) if t)
    lines = _lines(text)
    nonempty = [l for l in lines if l]

    email = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", text)
    phone = re.search(r"(?:\+|00)?\d[\d\s().-]{7,}\d", text)
    li_url = re.search(r"(?:https?://)?(?:[a-z]{2,3}\.)?linkedin\.com/in/[\w\-%]+", text, re.I)

    # name: first short line of capitalised words that is not a heading
    name = ""
    for l in nonempty[:40]:
        words = l.split()
        if 2 <= len(words) <= 4 and not HEADINGS.match(l) and not re.search(r"[\d@/|:]", l) \
                and all(w[:1].isupper() for w in words) and not _looks_like_title(l) \
                and l.lower() not in COUNTRIES:
            name = l
            break
    headline = ""
    if name and name in nonempty:
        i = nonempty.index(name)
        if i + 1 < len(nonempty) and len(nonempty[i + 1]) < 180 and not HEADINGS.match(nonempty[i + 1]):
            headline = nonempty[i + 1]

    location = ""
    for l in nonempty[:60]:
        parts = [p.strip().lower() for p in l.split(",")]
        if 2 <= len(parts) <= 4 and len(l) < 70 and parts[-1] in COUNTRIES:
            location = l
            break

    # experience section → date ranges and titles
    exp = _section(lines, ["experience", "work experience", "professional experience", "employment history",
                           "work history", "career history"])
    exp_lines = exp if len([l for l in exp if l]) > 2 else lines
    ranges, titles = [], []
    for i, l in enumerate(exp_lines):
        m = DATE_RANGE.search(l)
        if not m:
            continue
        near = exp_lines[i - 1] if i > 0 else ""
        if exp is exp_lines or not re.search(r"(?i)universit|college|school|bachelor|master|degree|diploma", near + l):
            ranges.append(_range_months(m))
        cand = _clean_title(l)
        j = i - 1
        while not cand and j >= max(0, i - 3):
            cand = _clean_title(exp_lines[j]) if exp_lines[j] else ""
            j -= 1
        if not cand and i + 1 < len(exp_lines):
            cand = _clean_title(exp_lines[i + 1])
        if cand and cand.lower() not in [t.lower() for t in titles]:
            titles.append(cand)
    if not titles and headline:
        t = _clean_title(headline)
        if t:
            titles.append(t)
    years = _years_from_ranges(ranges) if ranges else None
    li_years = [int(y) for y in re.findall(r"\((\d+) years?", li_text or "")]
    if li_text and not years and li_years:
        years = float(sum(li_years))

    # skills: declared sections + dictionary scan
    declared = []
    for sec in (["top skills"], ["skills", "core skills", "key skills", "technical skills", "competencies",
                                  "core competencies"]):
        for l in _section(lines, sec):
            for part in re.split(r"[,;•|]", l):
                p = part.strip()
                if 1 < len(p) < 40 and not DATE_RANGE.search(p):
                    declared.append(p)
    scanned = find_skills("\n".join(l for l in lines if not HEADINGS.match(l)))
    skills, seen = [], set()
    for s in declared + scanned:
        k = s.lower()
        if k not in seen:
            seen.add(k)
            skills.append(s)
    hard = [s for s in skills if s not in SOFT_SKILLS]
    soft = [s for s in skills if s in SOFT_SKILLS]

    languages = [l for l in _section(lines, ["languages"]) if l and len(l) < 60]
    certs = [l for l in _section(lines, ["certifications?", "licenses? (&|and) certifications"]) if l and len(l) < 120]
    education = []
    for l in nonempty:
        if re.search(r"(?i)\b(bachelor|master|mba|ph\.?d|b\.?sc|m\.?sc|b\.?eng|m\.?eng|b\.?com|b\.?a\.?|m\.?a\.?|"
                     r"diploma|degree|university|college)\b", l) and len(l) < 160:
            if l not in education:
                education.append(l)
        if len(education) >= 4:
            break

    seniority = seniority_from(years, titles)
    targets = []
    for t in titles[:3]:
        if seniority not in ("entry", "internship") and re.search(r"(?i)\b(junior|jr|intern|trainee|assistant)\b", t):
            continue
        core = core_title(t)
        for v in (t, core if len(core.split()) > 1 else ""):
            if v and v.lower() not in [x.lower() for x in targets]:
                targets.append(v)
    targets = targets[:5]

    # CV quality checks
    bullets = [l for l in lines if l and len(l) > 25]
    quantified = [l for l in bullets if re.search(r"\d+\s*%|[$€£]\s?\d|\d+[kKmM]\b|\b\d{2,}\b", l)
                  and not DATE_RANGE.search(l)]
    weak = sum(text.lower().count(p) for p in WEAK_PHRASES)
    words = len(re.findall(r"\w+", cv_text or li_text))
    improvements, strengths = [], []
    if not email:
        improvements.append("Add a professional email address to the top of your CV.")
    if not phone:
        improvements.append("Add a phone number with country code.")
    if cv_text and not re.search(r"linkedin\.com/in/", cv_text, re.I):
        improvements.append("Add your LinkedIn profile URL to your CV header.")
    if len(quantified) < 3:
        improvements.append("Quantify your achievements — add numbers, %, revenue, time saved or team size "
                            "to at least 3–5 bullet points.")
    else:
        strengths.append(f"{len(quantified)} bullet points already show measurable results.")
    if weak:
        improvements.append(f"Replace passive phrases like “responsible for” / “worked on” ({weak} found) "
                            "with action verbs: led, built, delivered, increased, reduced.")
    if not _section(lines, ["summary", "professional summary", "profile", "about", "about me", "objective"]):
        improvements.append("Add a 2–3 line professional summary aimed at your target role.")
    if len(hard) < 8:
        improvements.append("List more concrete tools and skills — recruiters and ATS filters search for them.")
    else:
        strengths.append(f"Strong keyword coverage: {len(hard)} hard skills detected.")
    if cv_text and words > 1100:
        improvements.append(f"Your CV is long (~{words} words). Aim for 1–2 pages focused on the last 10 years.")
    elif cv_text and words < 250:
        improvements.append("Your CV looks thin — expand on scope, impact and tools used in each role.")
    if years:
        strengths.append(f"About {years:g} years of experience detected.")

    return {
        "source": "builtin",
        "name": name, "headline": headline, "email": email.group(0) if email else "",
        "phone": phone.group(0).strip() if phone else "", "linkedin_url": li_url.group(0) if li_url else "",
        "location": location, "years_experience": years, "seniority": seniority,
        "current_title": titles[0] if titles else "", "titles": titles[:8], "target_titles": targets,
        "skills": hard[:40], "soft_skills": soft[:12], "industries": [], "languages": languages[:6],
        "education": education, "certifications": certs[:8],
        "search_locations": [location] if location else [],
        "summary": "", "strengths": strengths, "improvements": improvements,
    }


# --------------------------------------------------------------------------- Claude analyzer

PROFILE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["name", "headline", "email", "phone", "linkedin_url", "location", "years_experience",
                 "seniority", "current_title", "titles", "target_titles", "skills", "soft_skills", "industries",
                 "languages", "education", "certifications", "search_locations", "summary", "strengths",
                 "improvements"],
    "properties": {
        "name": {"type": "string"}, "headline": {"type": "string"}, "email": {"type": "string"},
        "phone": {"type": "string"}, "linkedin_url": {"type": "string"}, "location": {"type": "string"},
        "years_experience": {"type": "number"},
        "seniority": {"type": "string", "enum": SENIORITY_ORDER},
        "current_title": {"type": "string"},
        "titles": {"type": "array", "items": {"type": "string"}},
        "target_titles": {"type": "array", "items": {"type": "string"}},
        "skills": {"type": "array", "items": {"type": "string"}},
        "soft_skills": {"type": "array", "items": {"type": "string"}},
        "industries": {"type": "array", "items": {"type": "string"}},
        "languages": {"type": "array", "items": {"type": "string"}},
        "education": {"type": "array", "items": {"type": "string"}},
        "certifications": {"type": "array", "items": {"type": "string"}},
        "search_locations": {"type": "array", "items": {"type": "string"}},
        "summary": {"type": "string"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "improvements": {"type": "array", "items": {"type": "string"}},
    },
}

TAILOR_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["fit_score", "verdict", "why_you_fit", "gaps", "cv_tweaks", "keywords_to_add",
                 "interview_topics", "outreach_message", "cover_letter"],
    "properties": {
        "fit_score": {"type": "integer"},
        "verdict": {"type": "string"},
        "why_you_fit": {"type": "array", "items": {"type": "string"}},
        "gaps": {"type": "array", "items": {"type": "string"}},
        "cv_tweaks": {"type": "array", "items": {"type": "string"}},
        "keywords_to_add": {"type": "array", "items": {"type": "string"}},
        "interview_topics": {"type": "array", "items": {"type": "string"}},
        "outreach_message": {"type": "string"},
        "cover_letter": {"type": "string"},
    },
}

MODEL = "claude-opus-5"


class ClaudeError(Exception):
    pass


def _claude_json(api_key, system, user, schema):
    import anthropic
    client = anthropic.Anthropic(api_key=api_key) if api_key else anthropic.Anthropic()
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=system,
            messages=[{"role": "user", "content": user}],
            output_config={"format": {"type": "json_schema", "schema": schema}},
        )
    except anthropic.AuthenticationError as e:
        raise ClaudeError("The Anthropic API key was rejected. Check it in Settings.") from e
    except anthropic.RateLimitError as e:
        raise ClaudeError("Anthropic rate limit reached — try again in a minute.") from e
    except anthropic.APIStatusError as e:
        raise ClaudeError(f"Anthropic API error {e.status_code}: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise ClaudeError("Could not reach the Anthropic API — check your internet connection.") from e
    if response.stop_reason == "refusal":
        raise ClaudeError("Claude declined this request.")
    if response.stop_reason == "max_tokens":
        raise ClaudeError("Claude's answer was cut off — try again.")
    text = next((b.text for b in response.content if b.type == "text"), "")
    return json.loads(text)


def analyze_with_claude(api_key, cv_text="", li_text=""):
    parts = []
    if li_text:
        parts.append(f"<linkedin_profile>\n{li_text}\n</linkedin_profile>")
    if cv_text:
        parts.append(f"<cv>\n{cv_text}\n</cv>")
    system = (
        "You are a senior technical recruiter and career coach. You read a candidate's CV and/or LinkedIn "
        "profile export and produce an accurate structured profile used to search LinkedIn for jobs and to "
        "coach the candidate. Only state facts present in the documents; leave a string empty or a list empty "
        "when unknown. years_experience is total professional experience (exclude education), 0 if unknown."
    )
    user = (
        "\n\n".join(parts) + "\n\n"
        "Build the profile:\n"
        "- titles: roles held, most recent first.\n"
        "- target_titles: 4–6 LinkedIn job-search queries this person should run — realistic next roles at "
        "their level or one step up, plus close adjacent titles recruiters actually use. Plain titles only.\n"
        "- skills: hard skills, tools and domain expertise, most relevant first (max 40). soft_skills separately.\n"
        "- search_locations: the candidate's city/country from the documents, formatted as LinkedIn accepts "
        "(e.g. \"Dubai, United Arab Emirates\").\n"
        "- summary: 2–3 sentences on who this candidate is and what they are best positioned for.\n"
        "- strengths: 3–5 things that make this profile competitive.\n"
        "- improvements: 4–8 specific, actionable fixes to the CV/LinkedIn that would raise interview rates "
        "(quote the weak part where useful). If both documents are present, flag inconsistencies between them."
    )
    data = _claude_json(api_key, system, user, PROFILE_SCHEMA)
    data["source"] = "ai"
    return data


def tailor_with_claude(api_key, profile, job, cv_text=""):
    system = (
        "You are an expert career coach helping a candidate apply to one specific job. Be honest about fit, "
        "concrete, and never invent experience the candidate does not have."
    )
    job_txt = (f"Title: {job.get('title')}\nCompany: {job.get('company')}\nLocation: {job.get('location')}\n"
               f"Seniority: {job.get('seniority')}\nEmployment type: {job.get('employment_type')}\n\n"
               f"{job.get('description') or '(no description available)'}")
    user = (
        f"<candidate_profile>\n{json.dumps(profile, ensure_ascii=False, indent=1)}\n</candidate_profile>\n\n"
        + (f"<cv>\n{cv_text}\n</cv>\n\n" if cv_text else "")
        + f"<job_posting>\n{job_txt}\n</job_posting>\n\n"
        "Produce: fit_score (0–100, calibrated: 80+ only for a strong match), a one-sentence verdict, "
        "why_you_fit (3–5 evidence-based points), gaps (with how to address each), cv_tweaks (specific edits "
        "to make the CV match this posting), keywords_to_add (ATS terms from the posting the CV lacks but the "
        "candidate can honestly claim), interview_topics (likely questions/areas to prepare), outreach_message "
        "(a LinkedIn connection note to the recruiter or hiring manager, under 300 characters, use "
        "[Name] as placeholder), and cover_letter (under 250 words, specific to this company and role)."
    )
    return _claude_json(api_key, system, user, TAILOR_SCHEMA)


# --------------------------------------------------------------------------- job matching

STOP = {"and", "or", "the", "of", "for", "to", "in", "a", "an", "with", "&", "-", "/", "at", "on", "m/f", "f/m"}


_ROLE_STEMS = {w[:5] for w in ROLE_WORDS if " " not in w}


def _stems(s):
    words = re.findall(r"[a-z0-9+#]+", (s or "").lower())
    return {w[:5] for w in words if w not in STOP and len(w) > 1}


def title_similarity(a, b):
    """Field words ("data", "marketing") matter more than role words ("analyst", "manager")."""
    sa, sb = _stems(core_title(a)), _stems(core_title(b))
    if not sa or not sb:
        return 0.0
    ra, rb = sa & _ROLE_STEMS, sb & _ROLE_STEMS
    da, db = sa - _ROLE_STEMS, sb - _ROLE_STEMS
    role = 1.0 if ra & rb else 0.0
    if not da and not db:
        return role
    domain = len(da & db) / len(da | db) if (da | db) else 0.0
    return 0.35 * role + 0.65 * domain


def score_job(profile, job):
    desc = job.get("description") or ""
    title = job.get("title") or ""
    jd_text = f"{title}\n{desc}"
    prof_skills = {s.lower() for s in (profile.get("skills") or []) + (profile.get("soft_skills") or [])}

    jd_skills = find_skills(jd_text) if desc else []
    # also credit declared profile skills that appear verbatim in the posting
    extra = [s for s in (profile.get("skills") or []) if s.lower() not in {j.lower() for j in jd_skills}
             and len(s) > 2 and _skill_pattern(s).search(jd_text)]
    matched = [s for s in jd_skills if s.lower() in prof_skills] + extra
    missing = [s for s in jd_skills if s.lower() not in prof_skills and s not in SOFT_SKILLS]
    # most-mentioned first, so the list leads with what the posting stresses
    missing.sort(key=lambda s: -len(_skill_pattern(s).findall(jd_text)))
    denom = max(6, min(len(jd_skills) + len(extra), 14))
    skill_score = min(1.0, len(matched) / denom) if (jd_skills or extra) else 0.4

    # title similarity against targets and recent titles
    title_score = 0.0
    for t in (profile.get("target_titles") or []) + (profile.get("titles") or [])[:2]:
        s = title_similarity(title, t)
        if core_title(t) and core_title(t).lower() in title.lower():
            s = max(s, 0.9)
        title_score = max(title_score, s)

    # seniority / years fit
    js = LINKEDIN_SENIORITY.get((job.get("seniority") or "").lower())
    ps = profile.get("seniority") or "associate"
    if js and ps in SENIORITY_ORDER:
        d = abs(SENIORITY_ORDER.index(js) - SENIORITY_ORDER.index(ps))
        sen_score = {0: 1.0, 1: 0.65}.get(d, 0.2)
    else:
        sen_score = 0.7
    req = re.findall(r"(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years|yrs)", desc, re.I)
    req_years = min((int(r) for r in req if 0 < int(r) < 25), default=None)
    yrs = profile.get("years_experience") or 0
    if req_years and yrs and req_years > yrs + 1.5:
        sen_score *= 0.5

    score = round(100 * (0.45 * skill_score + 0.4 * title_score + 0.15 * sen_score))
    reasons = []
    if title_score >= 0.6:
        reasons.append("Title closely matches your target roles")
    elif title_score < 0.25:
        reasons.append("Title differs from your target roles")
    if matched:
        reasons.append(f"{len(matched)} of your skills appear in the posting")
    if req_years:
        reasons.append(f"Asks for {req_years}+ years" + (f" (you have ~{yrs:g})" if yrs else ""))
    if js and js != ps:
        reasons.append(f"Seniority: {job.get('seniority')} (you: {ps})")
    return {"score": score, "matched": matched[:20], "missing": missing[:12], "reasons": reasons,
            "required_years": req_years}
