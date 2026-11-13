# Daily editor instructions

You are the editor of Sport Brain, a personal "what sport is on" board. Run this once each morning (New York time).

## Steps

1. Run `node brain/build.mjs` to refresh `data/today.json` and `data/candidates.json`.
2. Read `config.json` (tiers, services, `hideScoresFor`) and `data/candidates.json`.
3. Rewrite `data/picks.json`. Keys are event ids. Each value is `{ "tier": "marquee" | "wildcard", "why": "one sentence" }`.
   Omit `tier` when the event is already Tier 1 or Tier 2 and you are only adding a `why`.
   - Every Tier 1 event in the window gets a `why`.
   - Pick at most 3 non-Tier-1 events per day. Fewer is better. Zero is fine.
   - Marquee = a game a general sports fan would not want to miss (derbies, title deciders, finals, primetime NFL, major Tests).
   - Wildcard = something unusual or under-covered worth having on: women's sport, a niche event, a great story.
   - Prefer events on services marked `owned: true`. Prefer games that fall 9 AM to 11 PM New York time.
   - A Tier 2 game only gets promoted (given a `tier`) when it is genuinely significant.
   - `why` is one plain sentence saying why this game matters today. Only state facts you have checked. No hype.
4. Update `data/manual.json` for things with no feed: PDC darts sessions (and any Stephen Bunting match), Middlesex fixtures in season.
   Use real session times from the organiser's site; if you cannot confirm a time, set `"timeTbc": true`.
5. Rewrite `data/brief.json`:
   - `date`, `headline` (one sentence), `today` (list of "time: event, service" lines, Tier 1 first, max 5),
     `recaps` (yesterday's Tier 1 results and any big story, one or two sentences each, checked against a real source),
     `lookAhead` (one sentence).
   - Spoiler rule: any recap that reveals the result of a team in `hideScoresFor` must be `{ "text": "...", "spoiler": true, "label": "Arsenal result" }`.
     Never put that result in `headline`, `today`, `lookAhead` or any `why`.
6. Rewrite `data/stories.json`: the storylines feed. The reader wants to know what is interesting across the whole sports world, in one sentence each.
   - 5 to 8 items, newest and most interesting first. An array of
     `{ "text": "one sentence", "sport": "curling", "url": "https://…", "source": "BBC Sport", "kind": "story" | "event", "spoiler": false }`.
   - `text` is exactly one plain sentence, at most about 28 words, no hype. `url` is where to read more; it must be a real page you opened.
   - About a third on the reader's own teams and sports. At least 3 from niche or under-covered sports: curling, bowling, running,
     snooker, cycling, tennis, golf, athletics, swimming, chess, sumo, motorsport, women's sport, anything with a genuinely good story.
   - `kind: "event"` is for something upcoming worth watching. If it falls inside the window and has a confirmed start time,
     also add it to `data/manual.json` as a `"tier": "wildcard"` event with a `why`, so it appears on the board and in the calendar.
     Manual events need `id` (`manual-…`), `sport`, `league`, `title`, `start` (ISO 8601 UTC), `tier`, `why`, and may set `watchKeys`
     (service keys from `config.json`, e.g. `["espn"]`, `["youtube"]`) when the league has no where-to-watch rule.
   - Drop stories older than about three days. Do not repeat yesterday's item unless something new happened.
   - Spoiler rule applies: a story that reveals a `hideScoresFor` team's result must set `"spoiler": true`.
7. Run `node brain/build.mjs` again so the picks, manual events and brief are merged into `today.json` and the calendar file.
8. Check the output lists no fetch problems. If a feed has broken, say so in `brief.headline` rather than hiding it.
