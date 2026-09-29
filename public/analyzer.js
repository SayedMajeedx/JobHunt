// Built-in CV analysis and job-match scoring. Runs entirely in the browser.

const SKILLS = [
  // programming & software
  "Python", "Java", "JavaScript", "TypeScript", "C++", "C#", ".NET", "ASP.NET", "PHP", "Ruby", "Golang", "Rust",
  "Kotlin", "Swift", "Scala", "Perl", "MATLAB", "VBA", "Bash", "PowerShell", "SQL", "NoSQL", "T-SQL", "PL/SQL",
  "HTML", "CSS", "React", "React Native", "Angular", "Vue", "Next.js", "Node.js", "Express", "Django", "Flask",
  "FastAPI", "Spring", "Spring Boot", "Laravel", "Rails", "Flutter", "GraphQL", "REST", "REST API", "Microservices",
  "Git", "GitHub", "GitLab", "CI/CD", "Jenkins", "Docker", "Kubernetes", "Terraform", "Ansible", "Linux",
  "AWS", "Azure", "GCP", "Google Cloud", "Serverless", "Lambda", "DevOps", "SRE", "Agile", "Scrum", "Kanban",
  "Jira", "Confluence", "Unit Testing", "Test Automation", "Selenium", "Cypress", "QA", "System Design",
  "Object-Oriented Programming", "Data Structures", "Algorithms", "API Design", "Mobile Development",
  "Web Development", "Full Stack", "Frontend", "Backend", "Embedded Systems", "IoT",
  // data & AI
  "Data Analysis", "Data Analytics", "Data Science", "Data Engineering", "Data Visualization", "Data Modeling",
  "Data Warehousing", "Data Governance", "Data Quality", "ETL", "ELT", "Big Data", "Spark", "PySpark", "Hadoop",
  "Kafka", "Airflow", "dbt", "Snowflake", "Databricks", "BigQuery", "Redshift", "PostgreSQL", "MySQL",
  "SQL Server", "Oracle", "MongoDB", "Redis", "Elasticsearch", "Excel", "Advanced Excel", "Power Query",
  "Pivot Tables", "Power BI", "Tableau", "Looker", "Qlik", "SSRS", "SSIS", "DAX", "Google Analytics",
  "Statistics", "Statistical Analysis", "A/B Testing", "Forecasting", "Predictive Modeling", "Machine Learning",
  "Deep Learning", "NLP", "Natural Language Processing", "Computer Vision", "LLM", "Generative AI",
  "Prompt Engineering", "TensorFlow", "PyTorch", "scikit-learn", "Pandas", "NumPy", "R Programming", "SAS",
  "SPSS", "Stata", "MLOps", "Business Intelligence", "Reporting", "Dashboards", "KPI", "Data Mining",
  // security & infrastructure
  "Cybersecurity", "Information Security", "Network Security", "SIEM", "SOC", "Penetration Testing",
  "Vulnerability Management", "ISO 27001", "NIST", "IAM", "Firewall", "Networking", "TCP/IP", "Cisco",
  "Active Directory", "Windows Server", "VMware", "ITIL", "IT Support", "Help Desk", "ServiceNow",
  // product, project, business
  "Project Management", "Program Management", "Product Management", "Product Strategy", "Roadmapping",
  "Stakeholder Management", "Requirements Gathering", "Business Analysis", "Process Improvement",
  "Business Process", "Change Management", "Risk Management", "Strategic Planning", "Strategy",
  "Business Development", "Operations Management", "Operations", "Supply Chain", "Logistics", "Procurement",
  "Inventory Management", "Vendor Management", "Contract Management", "Negotiation", "Budgeting",
  "Lean", "Six Sigma", "PMP", "PRINCE2", "OKRs", "Market Research", "Competitive Analysis", "Consulting",
  "Management Consulting", "Due Diligence", "Business Strategy", "Digital Transformation", "ERP", "SAP",
  "Oracle ERP", "Microsoft Dynamics", "Salesforce", "HubSpot", "CRM", "Zoho", "Odoo",
  // finance & accounting
  "Financial Analysis", "Financial Modeling", "Financial Reporting", "FP&A", "Accounting", "Bookkeeping",
  "Auditing", "Internal Audit", "External Audit", "IFRS", "GAAP", "Tax", "VAT", "Corporate Finance",
  "Valuation", "Investment Banking", "Private Equity", "Asset Management", "Portfolio Management",
  "Treasury", "Cash Flow", "Accounts Payable", "Accounts Receivable", "Payroll", "Reconciliation",
  "Cost Accounting", "Compliance", "AML", "KYC", "Credit Analysis", "Credit Risk", "Underwriting",
  "Banking", "Insurance", "Fintech", "QuickBooks", "Xero", "CFA", "ACCA", "CPA", "CMA",
  // marketing, sales, communication
  "Digital Marketing", "Marketing Strategy", "Content Marketing", "Social Media", "Social Media Marketing",
  "SEO", "SEM", "PPC", "Google Ads", "Meta Ads", "Email Marketing", "Marketing Automation", "Brand Management",
  "Branding", "Copywriting", "Content Creation", "Content Strategy", "Public Relations", "Communications",
  "Event Management", "Growth Marketing", "Performance Marketing", "E-commerce", "Shopify", "Sales",
  "B2B Sales", "B2C", "Account Management", "Key Account Management", "Lead Generation", "Cold Calling",
  "Customer Success", "Customer Service", "Customer Experience", "Client Relationship Management",
  "Presentation Skills", "Public Speaking", "Business Writing", "Pricing", "Merchandising", "Retail",
  // people & admin
  "Human Resources", "Recruitment", "Talent Acquisition", "Sourcing", "Onboarding", "Employee Relations",
  "Performance Management", "Compensation and Benefits", "Learning and Development", "Training",
  "HRIS", "Workday", "Organizational Development", "Labor Law", "Office Management", "Administration",
  "Executive Support", "Scheduling", "Data Entry", "Documentation", "Technical Writing",
  // design & media
  "UX", "UI", "UX Design", "UI Design", "User Research", "Wireframing", "Prototyping", "Figma", "Sketch",
  "Adobe XD", "Adobe Photoshop", "Adobe Illustrator", "Adobe InDesign", "Adobe Premiere", "After Effects",
  "Graphic Design", "Motion Graphics", "Video Editing", "Photography", "AutoCAD", "Revit", "SolidWorks",
  "3D Modeling", "Canva",
  // engineering, construction, health, other
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
];
const SOFT_SKILLS = new Set([
  "Leadership", "Team Leadership", "People Management", "Mentoring", "Coaching", "Problem Solving",
  "Critical Thinking", "Communication", "Teamwork", "Time Management", "Analytical Skills",
  "Attention to Detail", "Decision Making", "Cross-functional Collaboration", "Multitasking", "Adaptability",
  "Presentation Skills", "Public Speaking", "Negotiation", "Stakeholder Management",
]);
const ALIASES = {
  Golang: ["Go lang", "Golang"], "R Programming": ["R programming", "RStudio"],
  "Google Cloud": ["Google Cloud Platform", "Google Cloud"], "Machine Learning": ["Machine Learning", "ML models"],
  "Power BI": ["Power BI", "PowerBI"], "Node.js": ["Node.js", "NodeJS", "Node JS"],
  "Microsoft Office": ["MS Office", "Microsoft Office"], Excel: ["Excel", "MS Excel"],
  "Human Resources": ["Human Resources", "HR"], "Customer Service": ["Customer Service", "Customer Support"],
};
const ROLE_WORDS = [
  "manager", "engineer", "analyst", "developer", "consultant", "specialist", "director", "lead", "officer",
  "coordinator", "executive", "designer", "accountant", "administrator", "associate", "head", "architect",
  "scientist", "intern", "assistant", "supervisor", "representative", "advisor", "adviser", "strategist",
  "planner", "technician", "teacher", "lecturer", "nurse", "controller", "auditor", "president", "founder",
  "owner", "partner", "programmer", "researcher", "agent", "clerk", "buyer", "recruiter", "trainer",
  "writer", "editor", "producer", "marketer", "chief", "vp", "cto", "ceo", "cfo", "coo", "surveyor",
  "estimator", "inspector", "operator", "tester", "support", "tutor", "pharmacist", "physician",
  "doctor", "lawyer", "counsel", "paralegal", "cashier", "banker", "trader", "underwriter", "product owner",
  "scrum master", "sales", "secretary", "receptionist",
];
export const SENIORITY_ORDER = ["internship", "entry", "associate", "mid-senior", "director", "executive"];
const LINKEDIN_SENIORITY = {
  internship: "internship", "entry level": "entry", associate: "associate",
  "mid-senior level": "mid-senior", director: "director", executive: "executive",
};
const COUNTRIES = new Set([
  "united arab emirates", "uae", "saudi arabia", "ksa", "qatar", "kuwait", "bahrain", "oman", "egypt", "jordan",
  "lebanon", "iraq", "morocco", "tunisia", "algeria", "turkey", "türkiye", "pakistan", "india", "bangladesh",
  "sri lanka", "nepal", "philippines", "indonesia", "malaysia", "singapore", "thailand", "vietnam", "china",
  "hong kong", "japan", "south korea", "australia", "new zealand", "united kingdom", "uk", "england", "scotland",
  "ireland", "germany", "france", "spain", "portugal", "italy", "netherlands", "belgium", "switzerland",
  "austria", "sweden", "norway", "denmark", "finland", "poland", "czechia", "romania", "greece", "hungary",
  "united states", "usa", "canada", "mexico", "brazil", "argentina", "chile", "colombia", "peru",
  "south africa", "nigeria", "kenya", "ghana", "ethiopia",
]);
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const HEADINGS = new RegExp(
  "^(contact|top skills|skills|core skills|key skills|technical skills|competencies|core competencies|languages|" +
  "certifications?|licenses? (&|and) certifications|honors?[- ]awards|awards|publications|summary|" +
  "professional summary|profile|about|about me|objective|career objective|experience|work experience|" +
  "professional experience|employment history|work history|career history|education|academic background|" +
  "projects|volunteer(ing)?( experience)?|interests|hobbies|references|achievements|key achievements|" +
  "training|courses|personal (details|information))\\s*:?$", "i");
const WEAK_PHRASES = ["responsible for", "worked on", "helped with", "duties included", "tasked with", "involved in"];

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const skillRe = (term, flags = "i") => new RegExp(`(?<![A-Za-z0-9+#])${reEsc(term)}(?![A-Za-z0-9+#])`, flags);
const SKILL_PATTERNS = SKILLS.map((s) => [s, (ALIASES[s] || [s]).map((v) => skillRe(v))]);

export function findSkills(text) {
  const found = SKILL_PATTERNS.filter(([, pats]) => pats.some((p) => p.test(text))).map(([s]) => s);
  const lower = found.map((f) => f.toLowerCase());
  // drop a generic term when a more specific one matched ("Excel" when "Advanced Excel")
  const kept = found.filter((f) => !lower.some((o) => o !== f.toLowerCase() && o.split(" ").includes(f.toLowerCase())));
  return kept.length ? kept : found;
}

/* ------------------------------------------------------------------ helpers */
const lines = (text) => text.split(/\r?\n/).map((l) => l.trim().replace(/^[\s•·\-–—*|]+|[\s•·\-–—*|]+$/g, ""));

function section(ls, names) {
  const out = [];
  let inside = false;
  const target = new RegExp(`^(${names.join("|")})\\s*:?$`, "i");
  for (const l of ls) {
    if (!l) { if (inside) out.push(""); continue; }
    const isHead = HEADINGS.test(l);
    if (inside && isHead) break;
    if (isHead && target.test(l)) { inside = true; continue; }
    if (inside) out.push(l);
  }
  return out;
}

const MON = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)";
const DATE_RANGE = new RegExp(
  `(?:(?<m1>${MON.slice(1, -1)})[a-z]*\\.?\\s+|(?<n1>\\d{1,2})[/.-])?(?<y1>(?:19|20)\\d{2})\\s*(?:-|–|—|to|until)\\s*` +
  `(?:(?:(?<m2>${MON.slice(1, -1)})[a-z]*\\.?\\s+|(?<n2>\\d{1,2})[/.-])?(?<y2>(?:19|20)\\d{2})|(?<now>present|current|now|today|date|ongoing))`,
  "i");

function rangeMonths(g) {
  const t = new Date();
  const y1 = +g.y1;
  const mo1 = MONTHS[(g.m1 || "").slice(0, 3).toLowerCase()] || +(g.n1 || 1);
  let y2, mo2;
  if (g.now) { y2 = t.getFullYear(); mo2 = t.getMonth() + 1; }
  else { y2 = +g.y2; mo2 = MONTHS[(g.m2 || "").slice(0, 3).toLowerCase()] || +(g.n2 || 12); }
  const clamp = (m) => Math.min(Math.max(m, 1), 12);
  const a = y1 * 12 + clamp(mo1), b = y2 * 12 + clamp(mo2);
  return b >= a ? [a, b] : null;
}

function yearsFromRanges(ranges) {
  const rs = ranges.filter(Boolean).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let total = 0, cur = null;
  for (const [a, b] of rs) {
    if (cur && a <= cur[1]) cur = [cur[0], Math.max(cur[1], b)];
    else { if (cur) total += cur[1] - cur[0] + 1; cur = [a, b]; }
  }
  if (cur) total += cur[1] - cur[0] + 1;
  return Math.round((total / 12) * 10) / 10;
}

function looksLikeTitle(s) {
  if (!s || s.length > 90 || s.length < 3 || s.includes("@") || /http/i.test(s)) return false;
  const low = s.toLowerCase();
  return ROLE_WORDS.some((w) => new RegExp(`\\b${reEsc(w)}\\b`).test(low));
}

function cleanTitle(s) {
  s = s.replace(new RegExp(DATE_RANGE.source, "gi"), "").replace(/\(.*?\)/g, "");
  for (let part of s.split(/\s[|•·@–—-]\s|,\s| at /)) {
    part = part.replace(/^[\s,|\-–—]+|[\s,|\-–—]+$/g, "");
    if (looksLikeTitle(part)) return part;
  }
  return "";
}

export function coreTitle(t) {
  return String(t || "").replace(/\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|head of|i{1,3}|iv|trainee)\b/gi, "")
    .replace(/\s+/g, " ").replace(/^[\s,-]+|[\s,-]+$/g, "");
}

function seniorityFrom(years, titles) {
  const t = titles.slice(0, 2).join(" ").toLowerCase();
  if (/\b(chief|ceo|cto|cfo|coo|founder|president|vp|vice president)\b/.test(t)) return "executive";
  if (/\b(director|head of|head)\b/.test(t)) return "director";
  if (/\bintern/.test(t)) return "internship";
  years = years || 0;
  if (/\b(senior|sr|lead|manager|principal|staff)\b/.test(t) || years >= 5) return "mid-senior";
  if (years >= 2) return "associate";
  return "entry";
}

/* ------------------------------------------------------------------ built-in analyser */
export function analyzeBuiltin(cvText = "", liText = "") {
  const text = [liText, cvText].filter(Boolean).join("\n");
  const ls = lines(text);
  const nonempty = ls.filter(Boolean);

  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const phone = text.match(/(?:\+|00)?\d[\d\s().-]{7,}\d/);
  const liUrl = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[\w\-%]+/i);

  let name = "";
  for (const l of nonempty.slice(0, 40)) {
    const words = l.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && !HEADINGS.test(l) && !/[\d@/|:]/.test(l) &&
        words.every((w) => w[0] && w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase()) &&
        !looksLikeTitle(l) && !COUNTRIES.has(l.toLowerCase())) { name = l; break; }
  }
  let headline = "";
  const ni = nonempty.indexOf(name);
  if (name && ni >= 0 && nonempty[ni + 1] && nonempty[ni + 1].length < 180 && !HEADINGS.test(nonempty[ni + 1])) headline = nonempty[ni + 1];

  let location = "";
  for (const l of nonempty.slice(0, 60)) {
    const parts = l.split(",").map((p) => p.trim().toLowerCase());
    if (parts.length >= 2 && parts.length <= 4 && l.length < 70 && COUNTRIES.has(parts[parts.length - 1])) { location = l; break; }
  }

  const exp = section(ls, ["experience", "work experience", "professional experience", "employment history", "work history", "career history"]);
  const useExp = exp.filter(Boolean).length > 2;
  const expLines = useExp ? exp : ls;
  const ranges = [], titles = [];
  expLines.forEach((l, i) => {
    const m = l.match(DATE_RANGE);
    if (!m) return;
    const near = i > 0 ? expLines[i - 1] : "";
    if (useExp || !/universit|college|school|bachelor|master|degree|diploma/i.test(near + l)) ranges.push(rangeMonths(m.groups));
    let cand = cleanTitle(l);
    for (let j = i - 1; !cand && j >= Math.max(0, i - 3); j--) cand = expLines[j] ? cleanTitle(expLines[j]) : "";
    if (!cand && i + 1 < expLines.length) cand = cleanTitle(expLines[i + 1]);
    if (cand && !titles.some((t) => t.toLowerCase() === cand.toLowerCase())) titles.push(cand);
  });
  if (!titles.length && headline) { const t = cleanTitle(headline); if (t) titles.push(t); }
  let years = ranges.length ? yearsFromRanges(ranges) : null;
  const liYears = [...(liText || "").matchAll(/\((\d+) years?/g)].map((m) => +m[1]);
  if (liText && !years && liYears.length) years = liYears.reduce((a, b) => a + b, 0);

  const declared = [];
  for (const names of [["top skills"], ["skills", "core skills", "key skills", "technical skills", "competencies", "core competencies"]]) {
    for (const l of section(ls, names)) {
      for (const part of l.split(/[,;•|]/)) {
        const p = part.trim();
        if (p.length > 1 && p.length < 40 && !DATE_RANGE.test(p)) declared.push(p);
      }
    }
  }
  const scanned = findSkills(ls.filter((l) => !HEADINGS.test(l)).join("\n"));
  const seen = new Set(), skills = [];
  for (const s of [...declared, ...scanned]) { const k = s.toLowerCase(); if (!seen.has(k)) { seen.add(k); skills.push(s); } }
  const hard = skills.filter((s) => !SOFT_SKILLS.has(s));
  const soft = skills.filter((s) => SOFT_SKILLS.has(s));

  const languages = section(ls, ["languages"]).filter((l) => l && l.length < 60);
  const certs = section(ls, ["certifications?", "licenses? (&|and) certifications"]).filter((l) => l && l.length < 120);
  const education = [];
  for (const l of nonempty) {
    if (/\b(bachelor|master|mba|ph\.?d|b\.?sc|m\.?sc|b\.?eng|m\.?eng|b\.?com|diploma|degree|university|college)\b/i.test(l) && l.length < 160 && !education.includes(l)) education.push(l);
    if (education.length >= 4) break;
  }

  const seniority = seniorityFrom(years, titles);
  const targets = [];
  for (const t of titles.slice(0, 3)) {
    if (!["entry", "internship"].includes(seniority) && /\b(junior|jr|intern|trainee|assistant)\b/i.test(t)) continue;
    const core = coreTitle(t);
    for (const v of [t, core.split(" ").length > 1 ? core : ""]) {
      if (v && !targets.some((x) => x.toLowerCase() === v.toLowerCase())) targets.push(v);
    }
  }

  const bullets = ls.filter((l) => l && l.length > 25);
  const quantified = bullets.filter((l) => /\d+\s*%|[$€£]\s?\d|\d+[kKmM]\b|\b\d{2,}\b/.test(l) && !DATE_RANGE.test(l));
  const lowerText = text.toLowerCase();
  const weak = WEAK_PHRASES.reduce((n, p) => n + lowerText.split(p).length - 1, 0);
  const words = ((cvText || liText).match(/\w+/g) || []).length;
  const improvements = [], strengths = [];
  if (!email) improvements.push("Add a professional email address to the top of your CV.");
  if (!phone) improvements.push("Add a phone number with country code.");
  if (cvText && !/linkedin\.com\/in\//i.test(cvText)) improvements.push("Add your LinkedIn profile URL to your CV header.");
  if (quantified.length < 3) improvements.push("Quantify your achievements — add numbers, %, revenue, time saved or team size to at least 3–5 bullet points.");
  else strengths.push(`${quantified.length} bullet points already show measurable results.`);
  if (weak) improvements.push(`Replace passive phrases like “responsible for” / “worked on” (${weak} found) with action verbs: led, built, delivered, increased, reduced.`);
  if (!section(ls, ["summary", "professional summary", "profile", "about", "about me", "objective"]).length) improvements.push("Add a 2–3 line professional summary aimed at your target role.");
  if (hard.length < 8) improvements.push("List more concrete tools and skills — recruiters and ATS filters search for them.");
  else strengths.push(`Strong keyword coverage: ${hard.length} hard skills detected.`);
  if (cvText && words > 1100) improvements.push(`Your CV is long (~${words} words). Aim for 1–2 pages focused on the last 10 years.`);
  else if (cvText && words < 250) improvements.push("Your CV looks thin — expand on scope, impact and tools used in each role.");
  if (years) strengths.push(`About ${years} years of experience detected.`);

  return {
    source: "builtin", name, headline, email: email ? email[0] : "", phone: phone ? phone[0].trim() : "",
    linkedin_url: liUrl ? liUrl[0] : "", location, years_experience: years, seniority,
    current_title: titles[0] || "", titles: titles.slice(0, 8), target_titles: targets.slice(0, 5),
    skills: hard.slice(0, 40), soft_skills: soft.slice(0, 12), industries: [], languages: languages.slice(0, 6),
    education, certifications: certs.slice(0, 8), search_locations: location ? [location] : [],
    summary: "", strengths, improvements,
  };
}

/* ------------------------------------------------------------------ job matching */
const STOP = new Set(["and", "or", "the", "of", "for", "to", "in", "a", "an", "with", "at", "on"]);
const ROLE_STEMS = new Set(ROLE_WORDS.filter((w) => !w.includes(" ")).map((w) => w.slice(0, 5)));
const stems = (s) => new Set((String(s || "").toLowerCase().match(/[a-z0-9+#]+/g) || [])
  .filter((w) => !STOP.has(w) && w.length > 1).map((w) => w.slice(0, 5)));

export function titleSimilarity(a, b) {
  const sa = stems(coreTitle(a)), sb = stems(coreTitle(b));
  if (!sa.size || !sb.size) return 0;
  const inter = (x, y) => [...x].filter((v) => y.has(v));
  const ra = new Set([...sa].filter((x) => ROLE_STEMS.has(x))), rb = new Set([...sb].filter((x) => ROLE_STEMS.has(x)));
  const da = new Set([...sa].filter((x) => !ROLE_STEMS.has(x))), db = new Set([...sb].filter((x) => !ROLE_STEMS.has(x)));
  const role = inter(ra, rb).length ? 1 : 0;
  if (!da.size && !db.size) return role;
  const union = new Set([...da, ...db]);
  return 0.35 * role + 0.65 * (inter(da, db).length / union.size);
}

export function scoreJob(profile, job) {
  const desc = job.description || "";
  const title = job.title || "";
  const jd = `${title}\n${desc}`;
  const profSkills = new Set([...(profile.skills || []), ...(profile.soft_skills || [])].map((s) => s.toLowerCase()));

  const jdSkills = desc ? findSkills(jd) : [];
  const jdLower = new Set(jdSkills.map((s) => s.toLowerCase()));
  const extra = (profile.skills || []).filter((s) => !jdLower.has(s.toLowerCase()) && s.length > 2 && skillRe(s).test(jd));
  const matched = [...jdSkills.filter((s) => profSkills.has(s.toLowerCase())), ...extra];
  const count = (s) => (jd.match(skillRe(s, "gi")) || []).length;
  const missing = jdSkills.filter((s) => !profSkills.has(s.toLowerCase()) && !SOFT_SKILLS.has(s)).sort((a, b) => count(b) - count(a));
  const denom = Math.max(6, Math.min(jdSkills.length + extra.length, 14));
  const skillScore = jdSkills.length || extra.length ? Math.min(1, matched.length / denom) : 0.4;

  let titleScore = 0;
  for (const t of [...(profile.target_titles || []), ...(profile.titles || []).slice(0, 2)]) {
    let s = titleSimilarity(title, t);
    const core = coreTitle(t).toLowerCase();
    if (core && title.toLowerCase().includes(core)) s = Math.max(s, 0.9);
    titleScore = Math.max(titleScore, s);
  }

  const js = LINKEDIN_SENIORITY[(job.seniority || "").toLowerCase()];
  const ps = profile.seniority || "associate";
  let senScore = 0.7;
  if (js && SENIORITY_ORDER.includes(ps)) {
    const d = Math.abs(SENIORITY_ORDER.indexOf(js) - SENIORITY_ORDER.indexOf(ps));
    senScore = d === 0 ? 1 : d === 1 ? 0.65 : 0.2;
  }
  const reqs = [...desc.matchAll(/(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years|yrs)/gi)].map((m) => +m[1]).filter((n) => n > 0 && n < 25);
  const reqYears = reqs.length ? Math.min(...reqs) : null;
  const yrs = profile.years_experience || 0;
  if (reqYears && yrs && reqYears > yrs + 1.5) senScore *= 0.5;

  const score = Math.round(100 * (0.45 * skillScore + 0.4 * titleScore + 0.15 * senScore));
  const reasons = [];
  if (titleScore >= 0.6) reasons.push("Title closely matches your target roles");
  else if (titleScore < 0.25) reasons.push("Title differs from your target roles");
  if (matched.length) reasons.push(`${matched.length} of your skills appear in the posting`);
  if (reqYears) reasons.push(`Asks for ${reqYears}+ years${yrs ? ` (you have ~${yrs})` : ""}`);
  if (js && js !== ps) reasons.push(`Seniority: ${job.seniority} (you: ${ps})`);
  return { score, matched: matched.slice(0, 20), missing: missing.slice(0, 12), reasons, required_years: reqYears };
}
