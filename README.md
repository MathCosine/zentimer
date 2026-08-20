# zen

A very small timer for study periods, with the current local time shown large.

No accounts, no tracking, no build step, no dependencies — a handful of static files that run
entirely in the browser. Everything it remembers (your lengths, alarms, theme, today's
sessions) lives in `localStorage` on your own device.

## Using it

### Sessions and breaks

- **Pick a length** — 15 / 30 / 60 / 90 / 120 minutes, nudge with −5 / +5, or click the
  countdown and type: `45`, `50:00`, `1h30`, `90m`, `25s`.
- **Run it** — `begin` / `pause` / `resume`.
- **A session rolls straight into a 10-minute break.** When focus time is up a soft chime
  sounds, the ring blooms and turns sage green, and the break starts on its own — the rest is
  taken rather than skipped. `end break` returns to a fresh session early; `−5` / `+5` change
  the break length and it remembers.
- When the break finishes it chimes again and settles back to `ready` at your session length.
  It never starts the next session for you — that part is yours.
- Breaks don't count toward the day's focused time, and only completed sessions are counted.

### Alarms

Clock-time alarms, independent of the timer — useful for "leave at 16:30" while a session runs.

- `+ alarm` (or the `a` key), then type a time: `16:30`, `4:30pm`, `930`, `18` — or a
  distance from now, like `45m` or `2h`. A time that has already passed is set for tomorrow.
- Every armed alarm is listed under the timer with its countdown (`16:30 · in 2h 15m`), so you
  can see at a glance what's still coming.
- When one goes off its pill lights up and pulses, the tab title reads `alarm · zen`, and it
  chimes up to three times over a minute and a half in case you stepped away. Tap it to
  dismiss, or `×` to remove one early.

### The clock

Click it to switch between 24-hour and 12-hour. Below it: the date and your timezone, both
read from the device.

### Keys

| key | |
|---|---|
| `space` | begin / pause |
| `r` | reset (ends a break early) |
| `a` | add an alarm |
| `e` | edit the length |
| `↑` `↓` | ± 1 minute |
| `f` | fullscreen |
| `s` | chime on / off |
| `t` | light / dark |

### Nice to know

- The countdown is anchored to a wall-clock timestamp, so it stays accurate if the tab is
  hidden or throttled, and it survives a reload — close the tab mid-session and it picks up
  where it should be. Alarms are stored the same way.
- While a timer runs it asks for a screen wake lock, so the phone or laptop shouldn't dim.
- The bell icon turns on browser notifications for session, break and alarm endings
  (optional, asks once).
- Theme follows the system by default; the moon/sun button overrides it.

## Publishing it on GitHub Pages

The site is plain static files at the repository root, so no workflow is needed:

1. **Settings → Pages**
2. **Source: Deploy from a branch**
3. Branch: the branch holding this code, folder `/ (root)` → **Save**

It appears at `https://<user>.github.io/zentimer/` within a minute or so. On a phone,
"Add to Home Screen" installs it as a standalone app (see `manifest.webmanifest`).

## Files

```
index.html              markup
assets/style.css        theme tokens, layout, animations
assets/app.js           clock, timer, breaks, alarms, storage, chimes
manifest.webmanifest    add-to-home-screen
```
