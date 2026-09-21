# pip — from a personal tool to a product

Decided 2026-09-21. Nothing here is built yet. Build order matters: stage 1
must land before anything else, because migrating data gets harder the more
people have some.

**Shape agreed:** public sign-up, Supabase free tier, per-row sync, a real
front page, plus accounts, undo + bin, offline, search and a week view.

---

## The problem this is solving

Today the whole account is **one JSON document with one `updated` stamp**. Two
devices can never both be right: whichever saves last replaces the other
outright. The 2026-09-21 fix stops that destroying data silently (a blank
device can no longer win, nothing is replaced without a local backup), but it
does not make concurrent editing *correct*. Edit on a laptop and a phone in the
same hour and one of them is still discarded.

Everything below assumes that gets fixed first.

---

## Stage 1 — per-row sync

The big one. Do it in a single sitting; a half-migrated account is worse than
an unmigrated one.

### Schema

One table per kind, each row owned by a user, each row carrying its own stamp
and its own tombstone.

```
tasks   id text, user_id uuid, list_id text, title text, tags text[],
        due date, repeat text, weekday int, at int, mins int,
        done bool, completions jsonb, skips jsonb, ord int,
        updated bigint, deleted_at bigint
blocks  id, user_id, date, start int, end int, task_id, title,
        done bool, ran_over int, updated, deleted_at
tags    id, user_id, name, colour, updated, deleted_at
lists   id, user_id, name, ord, updated, deleted_at
logs    id, user_id, task_id, block_id, date, ms, at        (append only)
prefs   user_id (pk), data jsonb, updated                   (one row, see below)
```

RLS on every table: `auth.uid() = user_id`, for all operations, `to
authenticated`. Same shape as the existing policy.

### Stamps come from the server, not the client

**This is the part that bites.** Two devices' clocks disagree, sometimes by
minutes. If clients write their own `updated`, last-write-wins picks whichever
device has the faster clock, not whichever edit came last. A `before insert or
update` trigger sets `updated = (extract(epoch from now()) * 1000)::bigint`,
clients read it back, and ordering uses one clock. Clients keep a local stamp
only for ordering their own unsent changes.

### Client

- **Local mirror** stays authoritative for rendering, so the UI is never
  waiting on the network. IndexedDB rather than localStorage once rows are
  separate — localStorage is synchronous and rewrites the whole value.
- **Outbox**: every local change appends `{table, id, op, payload}`. Flushed in
  order when online; survives a reload. This is also what makes stage 4 work.
- **Delta pull**: `select * from <table> where updated > <last seen>`, per
  table, applying row-level last-write-wins. Store `last seen` per table.
- **Realtime**: subscribe per table filtered to `user_id`, apply rows as they
  arrive. Free-tier concurrent-connection limits apply; degrade to polling on
  failure rather than erroring.
- **Deletes are tombstones**: `deleted_at` set, row kept. A delete that is
  merely absent cannot be distinguished from a row this device has not pulled
  yet, which is how deleted things resurrect. Purge server-side after ~30 days.

### Conflicts

Per-row last-write-wins. Field-level merging is better in theory (two devices
editing different fields of one task) but is not worth the complexity here —
rows are small and one person rarely edits the same task on two devices at
once. Worth revisiting only if it actually bites.

### Migration

On first run of the new version, for an account that has a `pip_state` row:
read the document, write its contents out as rows, mark the account migrated
(a flag in `prefs`). Idempotent — safe to run twice. **Leave `pip_state` in
place untouched** as the escape hatch; drop it only after the new path has been
live for a while. Local-only users (never signed in) migrate their
localStorage document the same way on first load.

### Settings

Currently local-only (`pip.state.v1`): session lengths, break, day start/end,
theme, sound, notify, pets, 12/24h, music. These should follow the account, so
they go in `prefs.data`. **The running timer stays local** — a session counting
down on the laptop must not count down on the phone.

---

## Stage 2 — accounts

The sync panel currently asks for a Supabase URL and anon key. No normal person
can supply those. It becomes a real auth screen: sign up, sign in, forgotten
password, sign out, delete account.

- Credentials come from `assets/config.js`, already committed. The anon key is
  *meant* to be public; RLS is what protects the data. **The `service_role` key
  must never be in the repo, in config.js, or in any client file.**
- Delete account: `auth.users` already cascades to `pip_state`; every new table
  needs the same `on delete cascade`. Offer an export first.
- **Email confirmation must be ON for a public product** (it is currently off
  for convenience). That means Supabase's built-in email sender, which is
  rate-limited and explicitly not for production, has to be replaced with an
  SMTP provider — several have free tiers. Verify current limits before
  launching rather than trusting any number written here.
- Set the Site URL and redirect URLs to the real domain, or confirmation links
  point at localhost. (Already hit this once.)

---

## Stage 3 — landing page

- `/` becomes the front page: what it is, a screenshot or a live demo of the
  desk, `start free` and `sign in`.
- The app moves to `/app/`. localStorage is per-origin, not per-path, so
  existing local data survives the move.
- If a session already exists, the front page offers `open your desk` instead
  of a sign-up pitch.
- Keep the demo honest: let someone poke the desk before signing up. The app
  already works with no account, so the front page can embed the real thing.

---

## Stage 4 — offline

Closer than it sounds: the app is static, local-first, and stage 1 adds the
outbox.

- Service worker precaching the shell (HTML, CSS, the five scripts, the font,
  the icon), stale-while-revalidate for updates.
- Needs a cache-busting scheme, and a visible "a new version is ready, reload"
  rather than serving stale code forever.
- `manifest.webmanifest` exists but has a single SVG icon; installable PWAs
  want maskable PNGs at 192 and 512. `start_url`/`scope` become `/app/`.
- Writes already queue in the outbox, so offline editing just works; flush on
  reconnect.

---

## Stage 5 — undo and the bin

Falls out of tombstones almost free.

- An undo toast after any destructive action, undoing the last one.
- A bin in settings listing `deleted_at` rows, restorable, auto-purged after 30
  days with the date shown.

## Stage 6 — search and the week

- Search across titles and tags, filtering the list live. The list is already
  one scroller with sticky headings, so search slots in above it.
- Week view: seven columns of blocks, drag between days. The day view's
  geometry (`viewWindow`, `ppm`) generalises; the drag code already exists.

---

## Free tier: what to actually watch

Do not trust remembered numbers — check Supabase's current limits before
launching. The things that bite a public app on a free plan:

- **Projects pause after a stretch of inactivity.** Fine once real people use
  it; awkward before that.
- **Egress**, not rows. Text rows are tiny; delta sync keeps transfers small.
  Avoid refetching whole tables.
- **Realtime concurrent connections** are capped well below auth's user cap.
  Degrade to polling rather than failing.
- **Auth emails** are rate-limited on the built-in sender — see stage 2.

And the non-technical parts of being public: a privacy policy (what is stored,
where, how to delete it), a contact route, and some thought about what a
malicious sign-up can do. RLS means they can only reach their own rows, which
is most of it.

---

## Order and sizing

| Stage | What | Size | Can it be done in a short session? |
|---|---|---|---|
| 1 | Per-row sync + migration | Large | **No** — finish in one go |
| 2 | Accounts | Medium | Yes, in two parts |
| 3 | Landing page | Medium | Yes |
| 4 | Offline / PWA | Small–medium | Yes |
| 5 | Undo + bin | Small | Yes |
| 6 | Search + week view | Medium | Yes, separately |

Stages 5 and 6 depend on stage 1 but are independent of each other, and are the
safest things to pick up with a small budget. Stage 1 is the one to start
fresh and rested.
