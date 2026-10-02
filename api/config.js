// Public settings the browser needs to connect to Supabase. These values are safe to expose.
import { provider } from "../lib/ai.js";

export default function handler(req, res) {
  const ai = provider();
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseKey: process.env.SUPABASE_ANON_KEY || "",
    ai: Boolean(ai),
    aiName: ai?.name || "",
    indeed: Boolean(process.env.RAPIDAPI_KEY),
  });
}
