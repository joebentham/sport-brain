# Sport Brain

A personal "what sport is on" board.

- `config.json`: teams, tiers, services and where-to-watch rules.
- `brain/build.mjs`: pulls fixtures and writes `data/today.json` and `data/sport-brain.ics`.
- `brain/EDITOR.md`: instructions for the daily editor run that writes `data/picks.json`, `data/manual.json` and `data/brief.json`.
- `index.html`: the page.

Run locally: `node brain/build.mjs`, then serve the folder (`python3 -m http.server 4173`).
