#!/usr/bin/env python3
"""Sport Brain -> Apple TV: wake the Apple TV and open the streaming app that has the game.

Runs inside the virtual environment made by setup.sh (~/Library/Application Support/SportBrain/venv),
which holds pyatv. Talks to the Apple TV over Apple's Companion protocol, the same one the iPhone
remote and the Shortcuts "Open App on Apple TV" action use.

  sportbrain_atv.py scan                     list Apple TVs on the network
  sportbrain_atv.py pair [--name NAME]       one-time pairing; asks for the PIN shown on the TV
  sportbrain_atv.py apps                     list installed tvOS apps and refresh the service -> app map
  sportbrain_atv.py launch KEY [--url URL]   wake the Apple TV and open the app for service KEY
  sportbrain_atv.py status                   is everything set up? (no network)

Files (all outside the repo, never committed):
  appletv-credentials.json  the pairing credentials (mode 600)
  appletv.json              which installed app each service key opens, written by `apps`

Exit codes for `launch`: 0 opened, 1 Apple TV error, 2 not set up, 3 no tvOS app for that service.
"""
import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

SUPPORT = Path.home() / "Library" / "Application Support" / "SportBrain"
CREDS = SUPPORT / "appletv-credentials.json"
APPMAP = SUPPORT / "appletv.json"

# Service keys from config.json -> how the app is named on tvOS. Matching is done against the app
# list read from the user's own Apple TV (`apps`), so bundle ids are never guessed: an exact name
# match wins, then a name that starts with one of these. CONFIRMED records what the Living Room
# Apple TV actually reported, for reference and as a fallback if the app list cannot be read.
SERVICE_APP_NAMES = {
    "hulu": ["Hulu"],
    "peacock": ["Peacock"],
    "paramount": ["Paramount+", "Paramount Plus", "Paramount"],
    "espn": ["ESPN"],
    "prime": ["Prime Video", "Amazon Prime Video"],
    "appletv": ["TV", "Apple TV"],
    "mlb": ["MLB", "MLB.TV", "SNY"],
    "willow": ["Willow", "Willow TV"],
    "youtube": ["YouTube"],
    "rugbypass": ["RugbyPass TV", "RugbyPass"],
    "fandango": ["Fandango at Home", "Fandango", "Vudu"],
    "netflix": ["Netflix"],
    "fubo": ["Fubo", "fuboTV"],
    "bein": ["beIN SPORTS", "beIN"],
    "flo": ["FloSports", "FloRugby"],
}
# Names that only match exactly (too short or too generic to prefix-match).
EXACT_ONLY = {"TV", "Apple TV", "MLB", "SNY"}
CONFIRMED = {}  # filled in after pairing from the real app list; see README


class Fail(Exception):
    def __init__(self, msg, code=1):
        super().__init__(msg)
        self.code = code


def out(obj):
    print(json.dumps(obj), flush=True)


def load_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def write_private(path, obj):
    SUPPORT.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, path)


def match_apps(apps):
    """apps: list of (name, bundle). Returns {service key: {"bundle", "name"}}."""
    result = {}
    for key, names in SERVICE_APP_NAMES.items():
        hit = None
        for want in names:  # exact name first, in preference order
            hit = next((a for a in apps if (a[0] or "").strip().lower() == want.lower()), None)
            if hit:
                break
        if not hit:
            for want in names:
                if want in EXACT_ONLY:
                    continue
                hit = next((a for a in apps if (a[0] or "").strip().lower().startswith(want.lower())), None)
                if hit:
                    break
        if hit:
            result[key] = {"bundle": hit[1], "name": hit[0]}
    return result


# --- device ----------------------------------------------------------------------------------

def is_apple_tv(conf):
    from pyatv.const import Protocol
    svc = conf.get_service(Protocol.Companion)
    model = (conf.device_info.model_str or "")
    return svc is not None and "Apple TV" in model and "HomePod" not in model


async def find_config(loop, creds=None, timeout=5):
    import pyatv
    from pyatv.const import Protocol
    confs = []
    if creds and creds.get("address"):
        # Unicast to the last known address is quick; fall back to a network-wide scan.
        confs = [c for c in await pyatv.scan(loop, hosts=[creds["address"]], timeout=3)
                 if creds["identifier"] in c.all_identifiers]
    if not confs:
        ident = creds["identifier"] if creds else None
        confs = await pyatv.scan(loop, identifier=ident, timeout=timeout)
    confs = [c for c in confs if is_apple_tv(c)]
    if not confs:
        raise Fail("Apple TV not found on the network (is it on Wi-Fi/Ethernet and the Mac on the same network?)")
    conf = confs[0]
    for s in conf.services:  # only Companion is paired; the others would demand their own pairing
        s.enabled = s.protocol == Protocol.Companion
    return conf


async def connected(loop):
    import pyatv
    from pyatv.const import Protocol
    creds = load_json(CREDS)
    if not creds or not creds.get("companion"):
        raise Fail("Apple TV not paired yet: run appletv/setup.sh", 2)
    conf = await find_config(loop, creds)
    if str(conf.address) != creds.get("address"):
        creds["address"] = str(conf.address)
        write_private(CREDS, creds)
    conf.set_credentials(Protocol.Companion, creds["companion"])
    return await asyncio.wait_for(pyatv.connect(conf, loop, protocol=Protocol.Companion), 15)


# --- commands --------------------------------------------------------------------------------

async def cmd_scan(args, loop):
    import pyatv
    found = [c for c in await pyatv.scan(loop, timeout=6) if is_apple_tv(c)]
    for c in found:
        print(f"{c.name}  {c.address}  {c.device_info.model_str}  tvOS {c.device_info.version}  id {c.identifier}")
    if not found:
        print("No Apple TV found.")
    return 0


async def cmd_pair(args, loop):
    import pyatv
    from pyatv.const import Protocol
    confs = [c for c in await pyatv.scan(loop, timeout=6) if is_apple_tv(c)]
    if args.name:
        confs = [c for c in confs if c.name.lower() == args.name.lower()]
    if not confs:
        raise Fail("No Apple TV found" + (f" called {args.name!r}" if args.name else "") + ".")
    if len(confs) > 1:
        names = ", ".join(c.name for c in confs)
        raise Fail(f"More than one Apple TV ({names}); run again with --name \"<one of those>\".")
    conf = confs[0]
    print(f"Pairing with {conf.name} ({conf.device_info.model_str}, tvOS {conf.device_info.version})...")
    pairing = await pyatv.pair(conf, Protocol.Companion, loop, name="Sport Brain")
    try:
        await pairing.begin()
        if pairing.device_provides_pin:
            pin = input("Enter the 4-digit PIN shown on the TV: ").strip()
            if not pin.isdigit():
                raise Fail("The PIN is the 4 digits on the TV screen. Run setup again.")
            pairing.pin(int(pin))
        else:
            print("Enter this PIN on the TV: 1111")
            pairing.pin(1111)
            input("Press Return once you've entered it... ")
        await pairing.finish()
        if not pairing.has_paired:
            raise Fail("Pairing did not complete. Run setup again.")
        write_private(CREDS, {
            "name": conf.name, "identifier": conf.identifier, "address": str(conf.address),
            "companion": pairing.service.credentials,
        })
    finally:
        await pairing.close()
    print(f"Paired. Credentials saved to {CREDS}")
    return await cmd_apps(args, loop)


async def cmd_apps(args, loop):
    atv = await connected(loop)
    try:
        apps = [(a.name, a.identifier) for a in await atv.apps.app_list()]
    finally:
        atv.close()
    apps.sort(key=lambda a: (a[0] or "").lower())
    mapping = match_apps(apps)
    write_private(APPMAP, {"apps": mapping, "installed": [{"name": n, "bundle": b} for n, b in apps]})
    print("Installed apps:")
    for n, b in apps:
        print(f"  {n:32} {b}")
    print("\nService -> app:")
    for key in SERVICE_APP_NAMES:
        m = mapping.get(key)
        print(f"  {key:10} {m['name'] + '  (' + m['bundle'] + ')' if m else '-- not installed'}")
    print(f"\nSaved to {APPMAP}")
    return 0


async def cmd_launch(args, loop):
    from pyatv.const import PowerState
    m = (load_json(APPMAP) or {}).get("apps", {}).get(args.key) or CONFIRMED.get(args.key)
    if not load_json(CREDS):
        raise Fail("Apple TV not paired yet: run appletv/setup.sh", 2)
    if not m and not args.url:
        raise Fail(f"No tvOS app for {args.key!r} on this Apple TV", 3)
    if args.dry_run:
        out({"ok": True, "dry_run": True, "key": args.key, "app": m, "url": args.url})
        return 0
    atv = await connected(loop)
    try:
        try:
            if atv.power.power_state != PowerState.On:
                await asyncio.wait_for(atv.power.turn_on(await_new_state=True), 8)
        except Exception as e:  # waking is best effort: launching an app also wakes it on most tvOS versions
            print(f"turn_on: {e}", file=sys.stderr)
        opened = None
        if args.url:
            try:
                await asyncio.wait_for(atv.apps.launch_app(args.url), 10)
                opened = args.url
            except Exception as e:
                print(f"deep link failed, opening the app instead: {e}", file=sys.stderr)
        if not opened:
            if not m:
                raise Fail(f"No tvOS app for {args.key!r} on this Apple TV", 3)
            await asyncio.wait_for(atv.apps.launch_app(m["bundle"]), 10)
            opened = m["bundle"]
    finally:
        atv.close()
    out({"ok": True, "key": args.key, "opened": opened, "app": (m or {}).get("name")})
    return 0


async def cmd_status(args, loop):
    creds, amap = load_json(CREDS), load_json(APPMAP)
    out({"paired": bool(creds and creds.get("companion")), "device": (creds or {}).get("name"),
         "apps": {k: v["name"] for k, v in ((amap or {}).get("apps") or {}).items()}})
    return 0


def main():
    p = argparse.ArgumentParser(description="Sport Brain -> Apple TV")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("scan")
    pp = sub.add_parser("pair")
    pp.add_argument("--name")
    sub.add_parser("apps")
    lp = sub.add_parser("launch")
    lp.add_argument("key")
    lp.add_argument("--url")
    lp.add_argument("--dry-run", action="store_true")
    sub.add_parser("status")
    args = p.parse_args()
    fn = {"scan": cmd_scan, "pair": cmd_pair, "apps": cmd_apps, "launch": cmd_launch, "status": cmd_status}[args.cmd]

    async def run():
        return await fn(args, asyncio.get_running_loop())
    try:
        return asyncio.run(run())
    except Fail as e:
        print(str(e), file=sys.stderr)
        if args.cmd == "launch":
            out({"ok": False, "code": e.code, "error": str(e)})
        return e.code
    except KeyboardInterrupt:
        return 130
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        print(msg, file=sys.stderr)
        if args.cmd == "launch":
            out({"ok": False, "code": 1, "error": msg})
        return 1


if __name__ == "__main__":
    sys.exit(main())
