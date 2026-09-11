# pip

A cutesy study timer with two little pixel creatures who potter about the page while you work.

No accounts, no tracking, no build step, no third-party requests — a handful of static files that
run entirely in the browser. Everything it remembers (your lengths, alarms, theme, today's
sessions) lives in `localStorage` on your own device.

## Pip and pop

Pip is terracotta. Pop is mint, with a little sprig on his head. Both are drawn from character
grids in `assets/pet.js` — no image files, no sprite sheets, no libraries. They wander the page on
their own, walking along the bottom of the window and hopping up onto the top edge of the cards,
keeping out of each other's way, and each settles into one of sixteen things to do:

| | | |
|---|---|---|
| 💻 taps away at a laptop | 📋 draws on a whiteboard | 🗂 flips through flashcards |
| 📖 turns the pages of a book | ☕ leans in for a sip | 🎧 bobs along to music |
| 🍪 nibbles a biscuit | 🪴 waters a plant, which grows | 🧱 stacks a tower of blocks |
| 🧹 sweeps up | 🎈 holds a balloon | ⚽ boots a football about |
| 🏊 paddles in a puddle | 😴 naps, with Zzz | 🤸 stretches and hums |
| 👀 has a look around | | |

Every one of them animates — his six legs tap while he types, shuffle while he sweeps, lift while
he draws — and he sticks with a thing for anywhere from twenty seconds to two minutes rather than
flitting about.

What they pick is weighted by what *you're* doing. While a session runs they're mostly at the
laptop, the whiteboard or the flashcards; on a break they nap, swim and play; when nothing's
running they just mooch. Every minute or two they wander over to each other for a natter. They
cheer with confetti when a session lands, both come running when an alarm goes off, and either
will say hello if you click him. They have no needs, no hunger and nothing to grind — they're
company, not a chore.

Press `p` (or the creature button, top right) to send them away if you need a clear screen.

## Using it

### Sessions and breaks

- **Pick a length** — 15 / 30 / 45 / 60 / 90 / 120 minutes, nudge with −5 / +5, or click the countdown
  and type: `45`, `50:00`, `1h30`, `90m`, `25s`.
- **Run it** — `start` / `pause` / `resume`.
- **A session rolls straight into a 10-minute break.** When focus time is up a chime sounds, the
  ring turns mint green and the break starts on its own, so the rest gets taken rather than
  skipped. `end break` returns to a fresh session early; `−5` / `+5` change the break length and
  it remembers.
- When the break finishes it chimes again and settles back to `ready`. It never starts the next
  session for you — that part is yours.
- Breaks don't count toward the day's focused time, and only completed sessions are counted.

### Alarms

Clock-time alarms, independent of the timer — useful for "leave at 16:30" while a session runs.

- `+ alarm` (or the `a` key), then type a time: `16:30`, `4:30pm`, `930`, `18` — or a distance
  from now, like `45m` or `2h`. A time that has already passed is set for tomorrow.
- Every armed alarm is listed with its countdown, so you can see what's still coming.
- When one goes off you get the full performance: the screen dims and pulses, a card drops in with
  a ringing pixel clock and the time on it, both creatures drop what they're doing and come
  hurrying to the middle of the screen to jump about, and the tab title reads `alarm · pip`. If
  sound is on it also rings a two-tone alarm every six seconds for two minutes; muted, you get the
  animation only. Dismiss with the button, `esc`, `enter` or space.

### Study ambience

The headphone button opens a small panel with four calm tracks — **drift** (warm chords), **rain**
(a soft shower), **bells** (far away) and **hush** (deep and low) — plus a volume slider. `m`
plays and pauses.

None of it is a recording. Each track is a small machine built out of Web Audio oscillators and
filtered noise that plays itself, so nothing loops and nothing is downloaded. It ducks down on its
own while an alarm rings or a session lands, then comes back up.

### The clock

Click it to switch between 24-hour and 12-hour. Below it: the date and your timezone, both read
from the device.

### Keys

| key | |
|---|---|
| `space` | start / pause |
| `r` | reset (ends a break early) |
| `a` | add an alarm |
| `e` | edit the length |
| `↑` `↓` | ± 1 minute |
| `m` | ambience on / off |
| `p` | hide / show the pets |
| `f` | fullscreen |
| `s` | sound on / off |
| `t` | day / night |

### Nice to know

- The countdown is anchored to a wall-clock timestamp, so it stays accurate if the tab is hidden
  or throttled, and it survives a reload — close the tab mid-session and it picks up where it
  should be. Alarms and the day's tally are stored the same way.
- While a timer runs it asks for a screen wake lock, so the phone or laptop shouldn't dim.
- The bell icon turns on browser notifications for session, break and alarm endings.
- Day/night follows the system by default; the moon/sun button overrides it.
- The pets animate at 12fps and stop entirely when the tab is in the background.
- Ambience needs a click to start — browsers don't allow audio before you interact with a page —
  so it never resumes by itself on a reload, though it remembers the track and volume.

## Publishing it on GitHub Pages

The site is plain static files at the repository root, so no workflow is needed:

1. **Settings → Pages**
2. **Source: Deploy from a branch**
3. Branch: the branch holding this code, folder `/ (root)` → **Save**

It appears at `https://<user>.github.io/zentimer/` within a minute or so. On a phone,
"Add to Home Screen" installs it as a standalone app.

## Files

```
index.html                    markup
assets/style.css              theme tokens, layout, animations
assets/app.js                 clock, timer, breaks, alarms, storage, chimes
assets/pet.js                 pip and pop: sprites, behaviour, canvas
assets/music.js               the ambience, generated with Web Audio
assets/fonts/fredoka-*.woff2  the typeface, self-hosted (SIL OFL, see OFL.txt)
manifest.webmanifest          add-to-home-screen
```
