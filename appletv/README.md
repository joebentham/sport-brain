# Put sport on the Apple TV

One click in the island ("▶ Hulu on Apple TV") wakes the Living Room Apple TV and opens the app that has the game.
The TV itself wakes over HDMI-CEC when the Apple TV does.

## Set up (once)

```bash
appletv/setup.sh
```

or **Set up Apple TV…** in the Sport Brain menu bar menu (opens the same script in Terminal).
It makes a private Python environment at `~/Library/Application Support/SportBrain/venv`, installs pyatv,
finds the Apple TV, and asks for the 4-digit PIN the TV shows. Then it reads the list of installed apps
and saves which app each service opens. Run it again any time to re-pair or after installing new apps.

Nothing secret lives in this folder. Pairing credentials are in
`~/Library/Application Support/SportBrain/appletv-credentials.json` (mode 600); the service → app map is
`appletv.json` next to it. No passwords are involved: streaming sign-ins stay on the Apple TV.

## Using the launcher directly

```bash
PY="$HOME/Library/Application Support/SportBrain/venv/bin/python"
"$PY" appletv/sportbrain_atv.py launch hulu        # wake + open Hulu
"$PY" appletv/sportbrain_atv.py apps               # list installed apps, refresh the map
"$PY" appletv/sportbrain_atv.py status             # paired? which services have apps?
```

`launch KEY [--url URL]` takes a service key from `config.json`. Exit codes: 0 opened, 1 Apple TV error,
2 not paired, 3 no tvOS app for that service. The last stdout line is JSON (`{"ok": ...}`), which the island reads.
`build.sh` in `island/` copies the launcher and `setup.sh` into the app bundle.

## How it was chosen (Nov 2026)

| Route | For | Against |
| --- | --- | --- |
| **pyatv (Companion protocol)** — chosen | Open source, scriptable, one PIN pairing, `turn_on` + `launch_app` by bundle id or URL, can list installed apps so the map is read from the device, not guessed. Same protocol Apple's own remote and Shortcuts use. | Unofficial; tvOS updates have occasionally broken parts of Companion until pyatv catches up. Needs a Python venv. `atvremote` (its CLI) crashes on Python 3.15's asyncio, so we call the library from our own script. |
| Shortcuts "Open App on Apple TV" + `shortcuts run` | Apple-supported. | Each shortcut is built by hand in the Shortcuts app, one per service, no way to create them from the command line; no way to list installed apps; no wake/power control; no Apple documentation confirms the action runs from the Mac's `shortcuts` CLI. |
| AirPlay the Mac's browser | No pairing. | Mirrors a browser tab, not the native app: worse picture, Mac must stay awake, not "one click". |

Checked against the Living Room Apple TV 4K (gen 3) on tvOS 27.2 with pyatv 0.18.0 on Homebrew Python 3.15.

## Deep links

None of the services in the feed publish a documented deep link to a specific live event, and the feed only carries
landing-page URLs, so the goal is opening the right app. The launcher accepts `--url` and the island passes one only
for Apple TV app item pages (`https://tv.apple.com/...` with a path); if a URL fails it falls back to opening the app.

## Service → tvOS app

Matched by app name against the Apple TV's own app list at setup (see `SERVICE_APP_NAMES` in `sportbrain_atv.py`).
Confirmed from the Living Room Apple TV's own app list (12 Nov 2026, tvOS 27.2):

| Service key | tvOS app | Bundle id |
| --- | --- | --- |
| hulu | Hulu | com.hulu.plus |
| peacock | Peacock | com.peacocktv.peacock |
| paramount | Paramount+ | com.cbsvideo.app |
| espn | ESPN | com.espn.ScoreCenter |
| prime | Prime Video | com.amazon.aiv.AIVApp |
| appletv | TV | com.apple.TVWatchList |
| mlb | MLB | com.mlb.AtBatUniversal |
| willow | WillowTV | tv.willow |
| youtube | YouTube | com.google.ios.youtube |
| netflix | Netflix | com.netflix.Netflix |

Not installed, so the island offers only "Open on this Mac" for them: rugbypass, fandango, fubo, bein, flo.
Install one on the Apple TV, then run `sportbrain_atv.py apps` (or setup again) to pick it up.

## Known issue

pyatv 0.18 pairing breaks with srptools 2.0 (`SRPClientSession.__init__() takes 2 positional arguments`).
`setup.sh` pins `srptools<2`.

Tested 12 Nov 2026: `launch espn` opened ESPN on the Apple TV in under 2 s, both from the repo and from the copy
inside the island app. Waking from sleep is not yet tested (the Apple TV was already on).
