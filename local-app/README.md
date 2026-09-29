# JobHunt

A private job-search workspace that runs on your own computer. It has two parts:

1. **Find jobs**: reads your CV and/or LinkedIn profile, works out your target roles and skills, searches LinkedIn's public job listings, and scores every job against you.
2. **Applications**: tracks every application from saved to offer, with contacts, follow-up reminders, message templates and a full activity log.

## Start

Double-click **`start.bat`**. The first run installs what it needs (Python 3.10+ required); your browser then opens at http://127.0.0.1:5000. Keep the black window open while you use the app.

## Typical workflow

1. **Profile**: upload your CV (PDF) and your LinkedIn profile PDF. To get the LinkedIn PDF, go to your profile → *Resources* → *Save to PDF*. Check the target titles, skills and locations it found, and edit them if needed; they drive the search and the scores.
2. **Find jobs**: pick titles, locations and filters, then search. Results come in live, ranked by match score. Open a job to see the full description, why it scored the way it did, which skills you have or lack, and links to find recruiters and hiring managers at that company.
3. Click **Save** or **Applied**. Marking a job as applied logs the date and schedules a follow-up for 7 days later.
4. **Today** shows what's overdue, due today and due this week, plus applications with no reply after 3 weeks.
5. **Applications**: drag cards across the board, or use the table. Open any application to add contacts, log calls, emails and interviews, and copy ready-made messages (follow-ups, referral requests, thank-you notes, offer replies).

Moving an application to a new stage sets a sensible next step automatically. For example, Interviewing sets "Send a thank-you note within 24h" and Offer sets "Review and negotiate". You can edit or snooze any of them.

## Optional: Claude analysis

Add an Anthropic API key in **Settings** to get:
- a more accurate profile analysis with CV improvement advice
- per job: a fit score, CV edits, keywords to add, interview topics, a LinkedIn connection note and a cover letter

Without a key, everything else still works using the built-in analyzer.

## Good to know

- All your data stays in `data/jobhunt.db`. Use *Settings → Download full backup* now and then.
- Searches are paced on purpose (about 2 seconds per request). If LinkedIn starts limiting requests, the search stops and keeps what it found. Wait 10–15 minutes before searching again.
- It uses LinkedIn's public, logged-out job pages, and never your LinkedIn login. Automated collection may still conflict with LinkedIn's terms, so keep it to personal use at a sensible volume.
