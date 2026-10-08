# Zeldo Project Skills & Habits

This file documents the habits every AI coding agent must follow when working on this repository. These habits keep the three Zeldo versions (Muse / Astra 6 / Gemini) documented, comparable, and showcase-ready on zeldo.site.

## 1. Patch Notes Habit (MANDATORY)

**Every commit message becomes a public patch note on zeldo.site.** Write commit messages for players, not just developers.

Good:
- "Add double-jump to the hero"
- "Fix boss gate blocking the wrong doorway"
- "New art: hero gets a pointed hat and tunic"

Bad:
- "fix stuff"
- "wip"
- "updates"

Rules:
- One logical change per commit
- Subject line under 72 chars, user-facing language
- No internal jargon, no ticket numbers
- NEVER mention other AI models or compare versions in commit messages

## 2. Screenshot Habit

After any visual change (art, UI, layout, effects):
1. Build and run locally
2. Take a screenshot: title screen + representative gameplay
3. Save to the hub's media folder via the update script (see below)

The hub at zeldo.site has a Media section showcasing visual progress. Keep it fresh.

## 3. Hub Update Workflow

After pushing changes, update zeldo.site:

```bash
cd ~/workspace/zeldo-site
python3 update.py
```

This script:
- Takes fresh screenshots of all three versions
- Pulls git history for patch notes
- Regenerates the hub page
- Deploys to zeldo.site

Run this whenever you ship something worth showing.

## 4. Branch Conventions

- `main` — the live version (what players get on the subdomain)
- `episode-N` — per-episode snapshots for the YouTube series
- Feature branches for work in progress, merge to main when done

## 5. What NOT to Do

- Don't copy ideas, code, or art from the other Zeldo versions. Each AI builds independently — that's the whole point of the comparison.
- Don't break the build. Run `npm run build` before pushing.
- Don't commit secrets, API keys, or .env files.

## 6. Hub Refresh (manual)

After pushing changes worth showing, refresh zeldo.site:

```bash
cd ~/workspace/zeldo-site && python3 auto-update.py
```

This pulls fresh patch notes from git history and redeploys the hub.
Screenshots refresh too when local builds are available.
