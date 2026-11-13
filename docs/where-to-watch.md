# Where to watch: rules and sources

The board works out where to watch each game in `watchFor` in `brain/build.mjs`, using `config.json`:

1. **Listed channels.** ESPN's `broadcasts`/`geoBroadcasts` channel names are mapped through `channelToService`. A value can be one service key, a list of keys (a simulcast, e.g. NBC → Hulu Live and Peacock), or `null` (a known channel this viewer can't get, such as another team's regional network).
2. **In-market blackout.** If a New York regional network (MSG family, SNY, YES) is listed, the ESPN+ listing is dropped: ESPN+ carries NHL/MLB local games only outside the home market (`inMarketBlackout`).
3. **Fallback rules.** If no listed channel maps to a service, the first matching `leagueFallback` rule applies. `team:<name>` rules are tried first, then league-name substrings and `sport:<sport>`, in file order. Put specific rules before general ones, e.g. `premier league darts` before `darts` and `darts` before `premier league`.
4. **Editor events.** Entries in `data/manual.json` may carry `watchKeys`, which replace the fallback.

`services.<key>.owned` is `true`, `false` or `null` (unconfirmed). Re-check every rule below at the start of each season.

Last full check: **12 November 2026**.

## Rules

| Rule | Answer | Status | Source |
|---|---|---|---|
| PDC darts majors (Grand Slam 14–22 Nov 2026, World Championship Dec–Jan, Matchplay, Grand Prix) | ESPN+ (every session), selected sessions on ESPN2 (Hulu Live) | Confirmed. The ESPN deal (June 2026) replaced Peacock. Listings that still say Peacock come from the 2025 NBC deal. | https://www.sportcal.com/news/pdc-expands-darts-coverage-to-us-with-espn-deal/ · https://media.sportbusiness.com/news/pdc-secures-standalone-us-rights-deal-with-espn/ · PDC reconfirms the ESPN deal (9 Nov 2026): https://www.pdc.tv/news/2026/november/09/2027-bet365-us-darts-masters-dates---ticket-details-announced/ |
| Premier League Darts (Feb–May 2027) | ESPN+ (assumed) | **Unconfirmed**: the ESPN reports don't name it. Under the old deal Peacock had only the Play-Offs. | https://www.sportcal.com/media/nbc-secures-pdc-rights-renews-with-usa-swimming/ |
| England tour of Australia 2026/27 (ODIs 13, 15, 18 Nov; then T20Is) | Willow | ODIs confirmed. T20Is assumed (same Cricket Australia deal). | https://www.techradar.com/entertainment/cricket/how-to-watch-australia-vs-england-2026-odi-series-free · https://www.whathifi.com/streaming-entertainment/how-to-watch/australia-vs-england-odi-series-2026 |
| England tour of South Africa 2026/27 (Tests 17 Dec, 26 Dec, 3 Jan; ODIs 10–15 Jan; T20Is dropped) | Willow | **Unconfirmed** for this tour. Willow showed South Africa v Australia in 2026. | Fixtures: https://www.ecb.co.uk/news/4455456/fixtures-for-england-mens-202627-tour-to-south-africa-announced · Willow/SA: https://www.techradar.com/how-to-watch/cricket/south-africa-vs-australia-2026-1st-test |
| Other cricket (`sport:cricket`) | Willow | Usual US home; check each series | https://www.cabletv.com/sports/watch-willow-tv |
| Knicks / Rangers local games (MSG, MSGSN, MSG2, MSG+) | MSG Networks, **not owned**. Not on Hulu Live; streams on DAZN (exclusive DTC home from 2026–27), Fubo or DirecTV | Confirmed | https://www.msgnetworks.com/press-release/dazn-exclusive-direct-to-consumer-streaming-home-of-msg-and-yes-networks/ · https://www.antennaland.com/how-to-watch-msg-network/ |
| Knicks/Rangers/Nets games with no listing at all (`team:` rules) | MSG (YES for the Nets) | Assumed: no national broadcaster means the local network. Knicks at Toronto (15 Nov) had no US channel published on 12 Nov. | as above |
| Rangers on ESPN+ when MSG is also listed | Dropped (in-market blackout) | Confirmed: sportsmediawatch lists Rangers at Canucks (13 Nov) as MSG, with ESPN+ for out-of-market viewers only | https://www.sportsmediawatch.com/tv-schedules/nhl-tv-schedule/new-york-rangers/ |
| SNY (Mets) | MLB/SNY subscription **and** Hulu Live | Confirmed: SNY is on Hulu + Live TV (Nov 2026) | https://www.sportsmediawatch.com/2026/11/sny-baseball-night-new-york-sportsnite-studio-programs/ |
| NBC (SNF, NBA on NBC, Premier League on NBC) | Hulu Live + Peacock | Confirmed: every NBC NFL and NBA game streams on Peacock; the Premier League on NBC is simulcast on Peacock | https://www.nbcsports.com/pressbox/press-releases/nbc-sports-announces-its-complete-2026-27-nba-regular-season-schedule-featuring-100-games-across-nbc-peacock-and-nbcsn · https://www.peacocktv.com/sports/nfl · https://www.peacocktv.com/blog/2026-27-premier-league-on-peacock-schedule-dates-matches |
| NBCSN | Peacock | Confirmed for NBA (Peacock-exclusive Monday games, also on NBCSN). Hulu Live carriage of NBCSN is **unconfirmed**, so it is not mapped to Hulu. | as above |
| CBS | Hulu Live + Paramount+ | Confirmed for NFL on CBS (all Paramount+ plans). Other CBS sport needs Paramount+ Premium (live local CBS). | https://www.paramountplus.com/sneak-peak/how-to-watch-nfl-playoffs/ |
| ABC / ESPN | Hulu Live only | ESPN+ does not carry ABC/ESPN linear simulcasts, so there is no ESPN+ mapping | — |
| "Hulu", "Disney+" (ESPN NHL exclusives) | Hulu Live (includes Disney+ and ESPN) | Confirmed | https://espnpressroom.com/press-release/espn-announces-100-exclusive-national-hockey-league-games-for-2026-27-season/ |
| NBA TV | Not owned | Hulu Live does not carry it | https://www.cabletv.com/hulu/channels |
| NHL Network | `owned: null` | **Unconfirmed**: sources disagree on Hulu Live | https://www.cabletv.com/hulu/channels |
| Out-of-market NBA (other teams' regional networks) | NBA League Pass, not owned | Other teams' regional networks map to `null`; the `nba` rule supplies League Pass | — |
| Out-of-market NHL | ESPN+ (NHL Power Play), as listed by ESPN | Confirmed | https://espnpressroom.com/press-release/espn-announces-100-exclusive-national-hockey-league-games-for-2026-27-season/ |
| EFL League One / Two / Championship (Reading, Luton) | Paramount+ | CBS holds EFL rights through 2027–28 but shows **only selected** League One games. No US listing was found for Stockport v Reading (14 Nov). | https://www.renderfoot.com/blog/how-to-watch-efl-championship-in-usa · https://en.wikipedia.org/wiki/Sports_broadcasting_contracts_in_the_United_States |
| EFL Trophy (Luton) | Paramount+ | CBS must show at least 3 games a season, including the final, so most games are not on US TV | https://www.livesoccertv.com/competitions/england/football-league-trophy/watch/usa/ |
| MLS (NYCFC) | Apple TV | Confirmed: Season Pass ended, every 2026 match including the playoffs is on Apple TV | https://www.macrumors.com/2026/02/19/major-league-soccer-2026-season-start/ |
| Ligue 1 (Paris FC) | beIN Sports, not owned (Fubo, Sling, DirecTV) | US rights run through 2028–29 | https://www.livesoccertv.com/competitions/france/ligue-1/watch/usa/ · https://wheresports.com/league/french-ligue-1/ |

Rules carried over from the November 2026 research and not re-checked this pass: Premier League (Peacock/USA), Champions League, Europa, League Cup, Serie A, WSL, Women's Champions League (Paramount+), La Liga and FA Cup (ESPN+), Bundesliga (USA Network or free on Fandango), Nations League (mostly Fubo), Nations Championship rugby (free on RugbyPass TV) and Six Nations (Peacock, expected).

## Does the user have Willow?

Willow is not part of Hulu + Live TV, Peacock, Paramount+, ESPN+ or Prime Video. There are three places a subscription could be:

- **Direct**: sign in at https://www.willow.tv/ (or in the Willow app). If a live match plays, the subscription is active.
- **Prime Video Channels**: check https://www.amazon.com/yourchannels for a Willow channel ($9.99/month add-on).
- **Sling TV**: check for the Dakshin Flex or Desi Binge Plus add-on.

If none of these is active, set `services.willow.owned` to `false`. If one is, set it to `true`.

## How to re-check

Run `node brain/build.mjs`, then list every event whose `watch.options` is empty and every channel in `watch.channels` that has no key in `channelToService`. Map anything new that matters to the user. A team's own regional network goes to its service. Other teams' regional networks go to `null`.
