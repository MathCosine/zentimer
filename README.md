# pip

A study desk that plans your evening: your tasks, a timer, and tonight laid out before
bedtime. It works around your calendar, notices what has to come first, and still makes
room for practice. Two small pixel creatures potter about at the bottom.

Static files on GitHub Pages, no build step. Everything lives in the browser first; with an
account it syncs through Supabase, one row at a time, and the AI and the calendar work
through that account.

## Pages

| | |
|---|---|
| `/` | the front page, with the real desk running in a frame |
| `/app/` | the desk |
| `/account/` | sign in, make an account, forgotten password, your account |
| `/welcome/` | a minute of setting up: classes, practice, bedtime, calendar, a note for the AI |
| `/privacy.html` | what it stores, and what the AI is sent |

## Setting it up

| | |
|---|---|
| [`supabase/README.md`](supabase/README.md) | the database: run `supabase/schema.sql` (safe to run again after every update) |
| [`docs/ACCOUNTS.md`](docs/ACCOUNTS.md) | redirect URLs, and the optional "continue with Google" |
| [`docs/AI.md`](docs/AI.md) | the AI: Puter needs nothing; the optional own-server AI needs two free keys |
| [`docs/CALENDAR.md`](docs/CALENDAR.md) | the calendar relay, and where people find their iCal link |

## The AI

By default through [Puter](https://puter.com): each person connects their own free Puter
account, so there is no key and no server to run. Or, optionally, Groq and Gemini through an
Edge Function on your own Supabase project. Either way two models answer at once, each
answer is checked against what pip actually has, and when they disagree a third call judges
between them.

- **✦ by the add box** turns a note, or a pasted class page, into task cards: class, due
  date, minutes and what comes first. You fix them or leave some out, then add them.
- **Tonight's plan** is written by the AI from your tasks, deadlines, calendar, bedtime and
  "about you, right now" in settings. Every step is checked: made-up tasks are dropped,
  nothing comes before what it needs, and anything due tomorrow goes in even if it was left
  out. It asks only after a change that matters, once things have been quiet for 90
  seconds, and at most every half hour on its own. Whenever it can't answer, the rule-based
  planner takes over, as before.
- **The week.** **week** in the day row shows the next seven days: how much homework
  each holds against the time it has after school and around your calendar, big work
  spread out, a day that is too full marked, and the AI's note on what it moved.
- **Do this first.** A task can need others finished first. The reading takes on the quiz's
  deadline, and the quiz waits behind it. The AI suggests links it notices; you accept them.

## The shape of it

The page fills whatever window you give it, so it works docked as a strip down the side of
a monitor as well as full width:

- **narrow** — one column: the time and four buttons (alarms, music, account, menu), the
  timer, tonight (bars, up next, the day), then the task list taking whatever height is
  left and scrolling on its own.
- **900px and wider** — two columns: the timer and tonight on the left, the task list full
  height on the right.

Buttons squish when pressed, ticks pop, rows slide to their new places, finishing the
evening's homework gets a little confetti, and all of it stands down under "reduce motion".

## Tasks

- **Lists** down the top (`everything`, `School`, `Extracurricular`, plus any you add), a
  search box that is always there, the tag tiles button, and one more button for sort,
  split, finished tasks, paste and new list. **Tags** sit underneath as filter chips.
- **Tags come for free**: type `PHY Workbook Week 5` and it tags itself `PHY`. Anything
  starting with a short capitalised word does. `paste` takes a whole list at once, one per
  line, which is how you move in from Google Tasks.
- **Repeat** daily, on weekdays, or weekly — the daily ones come back each morning and are
  ticked off per day, so yesterday's tick doesn't clear today's. Give a repeat **a time and a
  length** and it lays itself on the timeline every day it's due. Move it and it stays where
  you put it; throw it off and it stays off for that day.
- **Due dates** are optional. Overdue goes red; today and tomorrow say so.
- **Tap a task** and the row opens into an editor in place — title, tags, due date, repeat,
  time, length, which list. No dialogs anywhere in the app: pasting a batch, naming a list and
  naming a block all happen inline.

## Today's plan

A timeline of the day, snapped to 15 minutes.

- **Any day, not just this one.** `‹` and `›` step through days — plan tomorrow tonight,
  or look back at yesterday. The day pill turns yellow when you're away from today; tap it
  (or *back to today*) to return. The timer always keeps tracking *today's* blocks, whatever
  day you happen to be looking at.
- It sizes itself to the window — a tall dock gets a tall timeline, a short one gets less,
  and opening it on a short screen borrows the today/alarms row rather than crushing the list.
- Tucked away it shows a few hours either side of now, with a red line for the time.
- **Rest the pointer on it and it grows**, smoothly, taking room from the list below rather
  than covering it. Passing through on your way somewhere else won't trigger it. The ▣ pin
  keeps it open; `esc` or moving away closes it.
- `+` on a task drops it in the next free slot. On empty timeline, **drag out the length you
  want** — a dashed preview follows the pointer with its times — or just tap for half an hour.
  Either way the name box is already waiting for you.
- Drag a block to move it, drag its bottom edge to make it longer. Click one to get the bar:
  rename, ±15 minutes, finished, remove.
- The bar above it always says what you should be doing now, or what's next.

### When something runs long

The block you're in turns amber the moment it should have ended, and the bar says how far
over you are with one button to **push the rest of the day back by that much** — so the
plan follows what actually happened rather than quietly becoming a lie. It only counts as
running over for an hour and a half; after that it's just an unfinished block from earlier
and stops nagging.

## The timer

Same pomodoro as before — 15 / 30 / 45 / 60 / 90 / 120, then a 10-minute break — except it
now knows what you're on. Whatever block is running shows under the ring, and the time you
spend is logged against that task.

## The creatures

Pip (terracotta) and pop (mint, with a sprig) potter along the floor at the bottom of the
window — and the margins either side when the window is wide enough — doing sixteen different
things, and both come running when an alarm goes off. They keep off the cards so they never
stand in front of what you're reading. `p` hides them and gives the strip back.

## Everything else

Alarms (the clock button, which wears the next one's time) with a full-screen ring, four
generated ambient tracks behind the headphone button, and in the ⋯ menu: settings, sound,
notifications, pets, night mode, full screen. `space` start, `r` reset, `a` alarm,
`m` music, `p` pets, `f` fullscreen, `t` theme, `,` settings.

## Files

```
index.html                    the front page
app/index.html                the desk
account/index.html            signing in, and your account
welcome/index.html            the first minute
assets/style.css              palette, layout, components, the feel of it
assets/pages.css              the account and welcome pages
assets/landing.css            the front page
assets/config.js              sync settings (and google: true for Google sign-in)
assets/store.js               the data: lists, tags, tasks, links, blocks, logs
assets/sync.js                rows up and down to Supabase
assets/plan.js                the planner: list, tonight, up next, timeline, week
assets/ai.js                  asking the AI (Puter, or your server), and when
assets/ai-brain.js            what the AI is asked, and how its answers are checked
assets/calendar.js            your calendar, read in
assets/motion.js              the small movements
assets/app.js                 clock, timer, breaks, alarms, the top buttons
assets/settings.js            the settings page
assets/account.js             the account page
assets/welcome.js             the welcome
assets/pet.js                 pip and pop
assets/music.js               the ambience, generated with Web Audio
supabase/schema.sql           the tables, row-level security, the AI allowance
supabase/functions/ai         the AI relay (Groq + Gemini)
supabase/functions/calendar   the calendar relay
test/                         Playwright suites (see test/README.md)
```
