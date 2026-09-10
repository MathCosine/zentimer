# pip

A cutesy study timer with a little pixel creature who potters about the page while you work.

No accounts, no tracking, no build step, no third-party requests — a handful of static files that
run entirely in the browser. Everything it remembers (your lengths, alarms, theme, today's
sessions) lives in `localStorage` on your own device.

## Pip

Pip is drawn from character grids in `assets/pet.js` — no image files, no sprite sheets, no
libraries. He wanders the page on his own, walking along the bottom of the window and hopping up
onto the top edge of the cards, and settles into one of sixteen things to do:

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

What he picks is weighted by what *you're* doing. While a session runs he's mostly at the laptop,
the whiteboard or the flashcards; on a break he naps, swims and plays; when nothing's running he
just mooches. He cheers with confetti when a session lands, jumps when an alarm goes off, and says
hello if you click him. He has no needs, no hunger and nothing to grind — he's company, not a
chore.

Press `p` (or the creature button, top right) to send him away if you need a clear screen.

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
- When one goes off its row lights up, the tab title reads `alarm · pip`, and it chimes up to
  three times over a minute and a half in case you stepped away. Tap it to dismiss.

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
| `p` | hide / show pip |
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
- Pip animates at 12fps and stops entirely when the tab is in the background.

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
assets/pet.js                 pip: sprites, behaviour, canvas
assets/fonts/fredoka-*.woff2  the typeface, self-hosted (SIL OFL, see OFL.txt)
manifest.webmanifest          add-to-home-screen
```
