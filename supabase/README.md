# Turning sync on

The app works without any of this — everything is kept in the browser. Do this when
you want the same plan on your laptop and your phone.

1. **Make a project** at supabase.com (the free tier is plenty).
2. **Run the schema**: SQL Editor → new query → paste `schema.sql` → Run.
3. **Allow email sign-in**: Authentication → Providers → Email → on.
   **Turn *Confirm email* off.** With it on, Supabase emails you a link and you cannot sign
   in until you click it.
4. **Set the Site URL** so any link it does send comes back here rather than to a localhost
   that isn't running: Authentication → URL Configuration → Site URL →
   `https://<user>.github.io/zentimer/`, and add the same under Redirect URLs.
5. **Copy two things** from Project Settings → API:
   - Project URL — `https://xxxxxxxx.supabase.co`
   - `anon` **public** key — the long `eyJ…` one.
     This one is meant to live in client code; the row-level security policy above is
     what actually protects the data. Never paste the `service_role` key anywhere.
6. **In pip**: the cloud button (top right) → paste the URL and key, put in an email and a
   password you choose, and press connect. The first connect creates the account.

Do the same on any other device and the plan follows you.

## What syncs

One row per account holding the whole plan: lists, tags, tasks, day blocks and time
logs. Timer settings, alarms, theme and the pets stay local to each device on purpose —
they are per-desk, not per-person.

## If it stops working

The cloud panel prints whatever the error was. Common ones:

- *signed out* — the session expired; put the password in again.
- *Invalid API key* — the anon key got truncated in the paste.
- *permission denied for table pip_state* — the schema ran but the policy did not; re-run
  the bottom half of `schema.sql`.

The export button in the same panel writes the whole plan out as JSON, whatever state
sync is in.
