# Build Prompt: Pushup Bank App

Paste this into a coding assistant (Claude Code, Cursor, Bolt, v0, Replit Agent, etc.) to build the app.

## Overview

Build a mobile-friendly web app called **Pushup Bank** for tracking daily push-ups with a "banking" mechanic. It's for personal use on a phone, and needs to be easy to share with friends so each of them can run their own tracker too.

## Core concept

- Users log push-up reps in sets throughout the day (e.g. tap "+10" after a set, or enter a custom number).
- Each day has a personalized target rep count.
- **Sundays are automatic rest days** — no target is set, no streak penalty, but logging still works and still counts toward totals if the user wants to do reps anyway.
- Reps done beyond the daily target are **banked**: they roll forward and can automatically cover part or all of a future day's target, so a big day earns a lighter day later.
- The app also tracks a running **lifetime total**, current streak, and longest streak.

## Target-setting algorithm (make targets "challenging but achievable")

- **Onboarding baseline:** ask a new user how many push-ups they can currently do in one set (or in 60 seconds). Use this to compute a starting daily target, split across 3–5 sets, that's ambitious but doable on day one.
- **Progressive overload:** increase the daily target gradually — roughly 5–8% per week — and cap any single week-over-week jump at ~15%, so it never spikes unreasonably.
- **Auto-recalibration:** if a user misses target on 3+ non-banked days in a row, quietly step the target back down to the last level they actually hit, rather than letting failure compound. If a user is consistently finishing with a large banked surplus, nudge the ramp rate up slightly.
- Recompute Sundays as target-free regardless of where the ramp is.

## Banking mechanic

- Each day: `surplus = reps logged today − today's target` (can be negative).
- Positive surplus adds to a **bank balance**.
- The bank balance can auto-cover a future day's target (in full or in part) — so a user with enough banked reps can take a day off (beyond the free Sunday) without breaking their streak.
- Cap the bank (e.g. max ~3 days' worth of target) so it can't be hoarded indefinitely and used to disappear for weeks at a time.
- Show the bank balance prominently, e.g. "184 banked — covers 2 more rest days."

## Multi-user / sharing

- Friends need to be able to use the same app independently, each with their own baseline, target curve, bank, and history — no shared data by default.
- Keep signup as low-friction as possible (e.g. name + PIN, or a magic link) so friends actually bother to use it.
- Nice-to-have for a later version, not required for v1: an opt-in leaderboard comparing streaks or lifetime totals between friends.

## Data model

- **Set:** timestamp, rep count.
- **Day:** date, target, total logged, bank surplus/deficit for that day, is-rest-day flag.
- **User (lifetime):** total reps ever, current streak, longest streak, days active, current bank balance, current target-ramp stage.

## Platform & tech

- Build as a responsive web app, installable as a PWA, so it works well on a phone home screen without needing app-store distribution — this is the easiest way for friends to pick it up via a link.
- For a v1/MVP, local persistence (e.g. localStorage/IndexedDB) per device is fine for personal use. Flag explicitly in the build that multi-device sync and true friend-sharing (so each friend's data lives on their own device/account reliably) will need a lightweight backend + auth in a later version — don't silently skip this trade-off.
- Keep the UI to three screens:
  1. **Home/Today** — big log buttons (+1 / +5 / +10 / custom), a progress ring for today vs. target, and the current bank balance.
  2. **History/Stats** — a calendar heatmap of hit/missed/banked/rest days, lifetime total, current and longest streak.
  3. **Settings/Onboarding** — baseline test, view/adjust the target ramp, manage the user profile.

## Acceptance criteria

- A new user finishes onboarding with a starting target that matches their stated ability.
- Logging a set updates today's total and progress display immediately.
- Surplus reps visibly bank and can cover a future day's target.
- Sundays are automatically rest days with no target and no streak penalty.
- Targets increase week over week but never exceed the capped jump size.
- A second user on the same app/device gets a clean slate — no crossover with the first user's data.

Adjust the ramp percentage, banking cap, and rest-day rules to taste before building — the numbers above are reasonable defaults, not fixed requirements.
