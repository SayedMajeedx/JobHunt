# JobHunt

A private job-search app you can install on your phone and computer.

- **Find jobs**: reads your CV and/or LinkedIn profile PDF, works out your target roles and skills, searches LinkedIn's public job listings, and scores every job against you.
- **Applications**: a board and table of every application, with stages, follow-up reminders, contacts, message templates and an activity log.

Your data is stored in your own Supabase database and synced across every device you sign in on.

## How it fits together

| Piece | Where it runs | What it does |
|---|---|---|
| The app (`public/`) | Your browser, installable as an app | All screens, CV reading, match scoring, search pacing |
| Server functions (`api/`) | Vercel | Fetch LinkedIn pages; call the AI provider (optional) |
| Database | Supabase | Profile, jobs, applications, contacts, activity |

## Setup (about 15 minutes)

### 1. Supabase

1. **SQL Editor → New query**: paste all of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
2. **Authentication → Users → Add user → Create new user**: enter your email and a password, and tick **Auto Confirm User**. This is your login.
3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up", so nobody else can create an account.
4. **Project Settings → API**: copy the **Project URL** and the **anon / publishable** key. Never use the `service_role` / secret key.

### 2. Vercel

Choose one:

- **GitHub (recommended):** push this folder to a GitHub repository, then in Vercel choose **Add New → Project** and import it. No build settings are needed; `vercel.json` has them.
- **From your computer:** run `npx vercel` in this folder and follow the prompts.

Then in Vercel go to **Project → Settings → Environment Variables** and add:

| Name | Value | Required |
|---|---|---|
| `SUPABASE_URL` | Project URL from Supabase | yes |
| `SUPABASE_ANON_KEY` | anon / publishable key | yes |
| `GROQ_API_KEY` | Free key from [console.groq.com/keys](https://console.groq.com/keys) (no card). Turns on AI analysis inside the app | recommended |
| `ALLOWED_EMAILS` | Your email; extra protection so only you can use the server functions | optional |

**AI options.** Set one of these; if several are set, the first in this list wins:
- `ANTHROPIC_API_KEY` uses Claude. This needs paid API credits, which are separate from a Claude Pro subscription.
- `GROQ_API_KEY` is free with no card, and Groq doesn't use your prompts for training. The default model is `openai/gpt-oss-120b`.
- `GEMINI_API_KEY` is free from aistudio.google.com. Note that Google may use free-tier content, including your CV, to improve its products.
- `AI_MODEL` optionally overrides the Groq or Gemini model, if the default is ever retired.

**Redeploy** after adding variables (Deployments → ⋯ → Redeploy).

### 3. Install it as an app

- **iPhone / iPad:** open your Vercel URL in **Safari** → Share → **Add to Home Screen**.
- **Android:** open it in **Chrome** → ⋮ menu → **Install app**.
- **Windows / Mac:** in Chrome or Edge, click the install icon at the right of the address bar.

## Good to know

- **Keep the app open while a search runs.** The browser paces the requests, about 2 seconds each. On a phone, switching away for a long time can pause the search; you can simply run it again.
- **LinkedIn limits:** searches use LinkedIn's public, logged-out job pages. LinkedIn is stricter with cloud servers than with home connections, so if it starts limiting requests, the search stops early and keeps what it found. Wait 10–15 minutes before searching again. Automated collection may conflict with LinkedIn's terms; keep it to personal use at a sensible volume.
- **Offline:** the app opens without a connection and shows the last data you viewed on that device. Changes need a connection.
- **Costs:** everything can run free: Supabase Free, Vercel Hobby and Groq's free tier. If you use up Groq's free limit for the day, AI features pause until it resets; search and tracking keep working.
- **Backups:** Settings → Download full backup gives you a JSON file you can restore at any time.

## Run it locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000. With no Supabase settings, it uses a temporary in-browser database, so you can try it without any accounts (sign in with any email and password). To use your real database locally, create `.env.local` with the same variables as Vercel.

`local-app/` contains the earlier desktop-only version (Python), kept for reference.
