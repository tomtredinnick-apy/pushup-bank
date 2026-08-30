# Pushup Bank

A mobile-friendly PWA for tracking daily push-ups with a banking mechanic: reps done above today's target roll forward and can cover a future day's target, so a big day earns you a lighter one later.

## Running it

It's a static site — no build step, no server-side code. Any static host works:

- **Quickest for yourself:** open `index.html` directly in a browser, or serve the folder locally:
  ```bash
  python3 -m http.server 8080
  ```
  then visit `http://localhost:8080`.
- **To share with friends:** push this folder to a static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages) and send them the URL. Each person who opens it gets their own independent profile — nothing is shared between devices or browsers.
- **Install as an app:** on the site, use the browser's "Add to Home Screen" (iOS Safari) or the install icon in the address bar (Chrome/Edge/Android). It then runs full-screen like a native app and works offline via a service worker.

## How data is stored

Everything lives in the browser's `localStorage` — per profile, per browser. There's no backend, no accounts, no sync. This means:

- Multiple people can use the exact same deployed link and never see each other's data.
- One person can also run multiple profiles in the same browser (switch via the ☰ menu), each locked behind an optional 4-digit PIN — a lightweight lock, not real security.
- Data does **not** sync across devices. Use Settings → Export to download a JSON backup, and Import to restore it (e.g. moving to a new phone).
- A true multi-device / cross-friend leaderboard experience would need a small backend (auth + a database) — this is intentionally out of scope for v1.

## The target algorithm

- **Baseline:** onboarding asks for your max reps in one set (or reps in 60 seconds), then computes a per-set target (~60% of your one-set max, or ~35% of your 60-second count) across 3–5 sets — ambitious across the whole day, doable per set.
- **Weekly ramp:** every 7 days the daily target rises by a ramp rate that starts at 6%, nudging up by 1% (capped at 10%) when you consistently finish the week with big surplus, and is hard-capped so no single week-over-week jump exceeds 15%.
- **Auto-recalibration:** three real (non-banked) misses in a row rolls the target back down to the last level you actually hit with real reps, and resets the ramp clock from there.
- **Rest day:** Sundays by default (configurable in Settings) — no target, no streak penalty, but logging still counts and any reps still bank.
- **Banking:** surplus reps (logged − target) add to a bank, capped at 3 days' worth of your current target. The bank auto-applies to each new day's target as it opens, so a big surplus can cover a full rest day or take the edge off a hard one.

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup for the three screens (Home, History, Settings) + onboarding |
| `styles.css` | All styling, light/dark aware |
| `app.js` | All app logic: storage, target/bank/streak engine, rendering |
| `manifest.json`, `sw.js`, `icons/` | PWA install + offline support |
