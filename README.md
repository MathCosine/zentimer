# zen

A very small timer for study periods, with the current local time shown large.

No accounts, no tracking, no build step, no dependencies — three static files that run
entirely in the browser. Everything it remembers (your last length, the theme, today's
sessions) lives in `localStorage` on your own device.

## Using it

- **Set a length** — tap a preset (10 / 15 / 25 / 50 / 90), use −5 / +5, or click the
  countdown and type: `25`, `50:00`, `1h30`, `90m`, `45s`, `1:05:00`.
- **Run it** — `begin` / `pause` / `resume`. When time is up a soft chime sounds, the ring
  blooms, and the display counts *upward* so you can see how long ago it landed.
- **Clock** — click it to switch between 24-hour and 12-hour. Below it: the date and your
  timezone, taken from the device.
- **Today** — completed sessions and total focused time, reset each morning.

### Keys

| key | |
|---|---|
| `space` | begin / pause |
| `r` | reset |
| `e` | edit the length |
| `↑` `↓` | ± 1 minute |
| `f` | fullscreen |
| `s` | chime on / off |
| `t` | light / dark |

### Nice to know

- The countdown is anchored to a wall-clock timestamp, so it stays accurate if the tab is
  hidden or throttled, and it survives a reload — close the tab mid-session and it picks up
  where it should be.
- While a timer runs it asks for a screen wake lock, so the phone or laptop shouldn't dim.
- The bell icon turns on a browser notification for when time is up (optional, asks once).
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
assets/app.js           clock, timer, storage, chime
manifest.webmanifest    add-to-home-screen
```
