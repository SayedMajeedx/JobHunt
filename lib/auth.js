// Every server function except /api/config requires a signed-in Supabase user.
// Optionally restrict to specific emails with ALLOWED_EMAILS="you@example.com,other@example.com".

const verified = new Map(); // token -> { user, until }

export async function requireUser(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    res.status(500).json({ error: "Server is not configured: set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel." });
    return null;
  }
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Please sign in." });
    return null;
  }

  const hit = verified.get(token);
  let user = hit && hit.until > Date.now() ? hit.user : null;
  if (!user) {
    const r = await fetch(`${url.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (!r || !r.ok) {
      res.status(401).json({ error: "Your session has expired. Please sign in again." });
      return null;
    }
    user = await r.json();
    verified.set(token, { user, until: Date.now() + 5 * 60 * 1000 });
    if (verified.size > 200) verified.delete(verified.keys().next().value);
  }

  const allowed = (process.env.ALLOWED_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(String(user.email || "").toLowerCase())) {
    res.status(403).json({ error: "This account is not allowed to use this JobHunt." });
    return null;
  }
  return user;
}

export function onlyPost(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return false;
  }
  return true;
}
