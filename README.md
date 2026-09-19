# pip

A study desk for one long narrow window: the time, a timer, today's plan, and your task
lists — with two little pixel creatures pottering about on top of it all.

Static files on GitHub Pages. No build step, and nothing is fetched from anywhere unless you
switch sync on. Everything lives in the browser; fill in `assets/config.js` and it syncs
through Supabase instead (see `supabase/README.md`).

## The shape of it

The page fills whatever window you give it, so it works docked as a strip down the side of
a monitor as well as full width:

- **narrow** — one column: clock and timer, then today's plan, then the task list taking
  whatever height is left and scrolling on its own.
- **900px and wider** — two columns: the desk on the left, the task list full height on the
  right.

## Tasks

- **Lists** down the top (`everything`, `School`, `Extracurricular`, plus any you add) and
  **tags** underneath as filter chips. Tap chips to narrow, tap again to widen.
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
- Tucked away it shows a few hours either side of now, with a red line for the time.
- **Rest the pointer on it and it grows**, smoothly, taking room from the list below rather
  than covering it. Passing through on your way somewhere else won't trigger it. The ▣ pin
  keeps it open; `esc` or moving away closes it.
- `+` on a task drops it in the next free slot. Click empty space on the timeline to plan
  something that isn't a task at all — dinner, practice, a lesson — and type its name straight
  into the bar that appears.
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

Pip (terracotta) and pop (mint, with a sprig) wander the page, hop onto the cards, do
sixteen different things, and both come running when an alarm goes off. `p` hides them.

## Everything else

Alarms with a full-screen ring, four generated ambient tracks behind the headphone button,
day/night, notifications, wake lock. `space` start, `r` reset, `a` alarm, `m` music,
`p` pets, `f` fullscreen, `t` theme.

## Files

```
index.html                    markup
assets/style.css              palette, layout, components
assets/config.js              sync settings, blank until you fill them in
assets/store.js               the data: lists, tags, tasks, blocks, logs, sync
assets/plan.js                the planner: task list, filters, timeline
assets/app.js                 clock, timer, breaks, alarms, chimes
assets/pet.js                 pip and pop
assets/music.js               the ambience, generated with Web Audio
supabase/schema.sql           the table and its row-level security
supabase/README.md            how to switch sync on
```
