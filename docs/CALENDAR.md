# Your calendar in pip

pip can show a Google, Apple or Outlook calendar on the day and plan the
evening around it. It reads the calendar's private iCal link. It never writes
to the calendar.

## Once per Supabase project: the relay

Calendar hosts don't send CORS headers, so a web page can't read an iCal link
directly. A small Edge Function fetches it on pip's behalf:
[`supabase/functions/calendar/index.ts`](../supabase/functions/calendar/index.ts).

1. Supabase dashboard → **Edge Functions** → **Deploy a new function** →
   **Via editor**.
2. Name it **`calendar`** (exactly that).
3. Replace the example code with the contents of `index.ts`, then **Deploy**.
4. Leave **Verify JWT** switched on. Only people signed in to pip can use the
   relay.

The relay only fetches from calendar hosts (Google, iCloud, Outlook, Proton,
Fastmail), so it can't be used to fetch anything else. It stores nothing.

## Each person: their link

Settings → **calendar** → paste the link → **connect**.

- **Google:** Google Calendar on a computer → ⚙ Settings → click the calendar
  on the left → **Integrate calendar** → copy **Secret address in iCal
  format**.
- **Apple:** Calendar on a Mac → right-click the calendar → Share Calendar →
  Public Calendar → copy the link.
- **Outlook:** Settings → Calendar → Shared calendars → Publish a calendar →
  copy the ICS link.

The link is stored in that person's account (the `prefs` row, which only they
can read), so it follows them to every device. Anyone with the link can read
that calendar, so treat it like a password.

## What it does with the events

- They appear on the timeline and in the week as read-only blocks. To move
  one, move it in the calendar.
- They count as time that's already taken: "time till bed", "up next" and
  tonight's plan all work around them.
- All-day events appear as a line under the "now" strip instead of as blocks.
- pip checks the calendar every 15 minutes while it's open, and whenever
  you come back to the page. The last copy it read is kept, so the day still
  shows the events offline.
