// Public settings the browser needs to connect to Supabase. These values are safe to expose.
import { aiEnabled } from "../lib/claude.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseKey: process.env.SUPABASE_ANON_KEY || "",
    ai: aiEnabled(),
  });
}
