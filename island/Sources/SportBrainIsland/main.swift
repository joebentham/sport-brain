import AppKit
import Combine
import ServiceManagement
import SwiftUI

let pageURL = URL(string: "https://joebentham.github.io/sport-brain/")!
let dataURL = URL(string: "https://joebentham.github.io/sport-brain/data/today.json")!
let espnBase = "https://site.api.espn.com/apis/site/v2/sports"

// MARK: - Data

struct Tier: Codable, Equatable {
    let raw: String
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let i = try? c.decode(Int.self) { raw = String(i) } else { raw = (try? c.decode(String.self)) ?? "" }
    }
    func encode(to encoder: Encoder) throws { var c = encoder.singleValueContainer(); try c.encode(raw) }
}

struct WatchOption: Codable {
    /// Service key from config.json (`hulu`, `espn`, ...), used to pick the tvOS app.
    let key: String?
    let name: String
    let owned: Bool?
    let url: String?
}

struct Watch: Codable {
    let options: [WatchOption]
    let note: String?
}

struct Score: Codable {
    var home: String?
    var away: String?
}

struct Event: Codable, Identifiable {
    let id: String
    let sport: String
    let league: String?
    let title: String
    let detail: String?
    let home: String?
    let away: String?
    let homeAbbr: String?
    let awayAbbr: String?
    let start: String
    var state: String
    var statusText: String?
    var score: Score?
    let tier: Tier
    let pick: String?
    let hideScore: Bool?
    let watch: Watch
    let why: String?
    let timeTbc: Bool?
    let feed: String?

    static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    var date: Date { Event.iso.date(from: start) ?? .distantFuture }
    var rank: Int { tier.raw == "1" ? 0 : (pick != nil || tier.raw == "marquee" || tier.raw == "wildcard") ? 1 : 2 }
    var isMine: Bool { tier.raw == "1" }
    var emoji: String {
        ["soccer": "⚽️", "football": "🏈", "cricket": "🏏", "rugby": "🏉", "darts": "🎯",
         "basketball": "🏀", "hockey": "🏒", "baseball": "⚾️"][sport] ?? "🏟️"
    }
    /// Rough "probably still on" length in hours, for when the feed has not caught up.
    var hours: Double {
        ["cricket": 8, "football": 3.5, "baseball": 3.5, "darts": 9, "soccer": 2, "rugby": 2][sport] ?? 2.5
    }
    var awayFirst: Bool { title.contains(" at ") }
    var matchup: String {
        guard let h = homeAbbr, let a = awayAbbr else { return String(title.prefix(26)) }
        return awayFirst ? "\(a) @ \(h)" : "\(h) v \(a)"
    }
    /// The service to open: the first one that is owned or unconfirmed.
    var link: WatchOption? { watch.options.first { $0.owned != false && $0.url != nil } }
    /// The service to send to the Apple TV: the first owned-or-unconfirmed option whose tvOS app is installed there.
    var tvTarget: (option: WatchOption, app: String)? {
        for o in watch.options where o.owned != false {
            if let k = o.key, let app = AppleTV.appName(for: k) { return (o, app) }
        }
        return nil
    }
    var whereText: String {
        if let l = link { return l.name + (l.owned == nil ? "?" : "") }
        if let first = watch.options.first { return "Not on your services (\(first.name))" }
        return "Where to watch unknown"
    }
    func shortScore(_ s: String?) -> String {
        guard let s = s else { return "-" }
        return s.components(separatedBy: " (").first ?? s
    }
    var scoreLine: String {
        guard let h = homeAbbr ?? home, let a = awayAbbr ?? away else { return "" }
        let hs = shortScore(score?.home), as_ = shortScore(score?.away)
        return awayFirst ? "\(a) \(as_)  \(h) \(hs)" : "\(h) \(hs)  \(a) \(as_)"
    }
}

// MARK: - Apple TV

/// Bridge to appletv/sportbrain_atv.py (copied into the app bundle by build.sh), which wakes the Apple TV and
/// opens the app over pyatv. Ready once appletv/setup.sh has made the Python environment and paired.
enum AppleTV {
    static let support = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/SportBrain")
    static var python: URL { support.appendingPathComponent("venv/bin/python") }
    static var script: URL? { Bundle.main.url(forResource: "sportbrain_atv", withExtension: "py") }
    static var setupScript: URL? { Bundle.main.url(forResource: "setup", withExtension: "sh") }
    private static var cache: (stamp: Date, apps: [String: String])?

    /// Service key -> installed tvOS app name, from appletv.json (written at pairing). Empty when not set up.
    static var apps: [String: String] {
        let fm = FileManager.default
        let map = support.appendingPathComponent("appletv.json")
        guard fm.isExecutableFile(atPath: python.path), script != nil,
              fm.fileExists(atPath: support.appendingPathComponent("appletv-credentials.json").path),
              let stamp = (try? fm.attributesOfItem(atPath: map.path))?[.modificationDate] as? Date else { return [:] }
        if let c = cache, c.stamp == stamp { return c.apps }
        var apps: [String: String] = [:]
        if let data = try? Data(contentsOf: map),
           let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let m = root["apps"] as? [String: [String: Any]] {
            for (k, v) in m { if let n = v["name"] as? String { apps[k] = n } }
        }
        cache = (stamp, apps)
        return apps
    }
    static var isReady: Bool { !apps.isEmpty }
    static func appName(for key: String) -> String? { apps[key] }

    /// A link worth handing to tvOS instead of just opening the app: only Apple TV app item pages for now,
    /// since no other service in the feed has a documented deep link to a live event.
    static func deepLink(_ o: WatchOption) -> String? {
        guard o.key == "appletv", let s = o.url, let u = URL(string: s), u.host == "tv.apple.com", u.path.count > 1 else { return nil }
        return s
    }

    /// Runs the launcher off the main thread; calls back on main with nil on success or a short error.
    static func launch(key: String, url: String?, done: @escaping (String?) -> Void) {
        guard let script = script else { done("Launcher missing from the app"); return }
        DispatchQueue.global(qos: .userInitiated).async {
            let p = Process()
            p.executableURL = python
            p.arguments = [script.path, "launch", key] + (url.map { ["--url", $0] } ?? [])
            let pipe = Pipe()
            p.standardOutput = pipe
            // The launcher's stderr goes to ~/Library/Logs/SportBrain/appletv.log, so failures can be diagnosed.
            let logDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/SportBrain")
            try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
            let logURL = logDir.appendingPathComponent("appletv.log")
            if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
            let log = try? FileHandle(forWritingTo: logURL)
            log?.seekToEndOfFile()
            log?.write(Data("\n[\(Date())] launch \(key)\(url.map { " --url \($0)" } ?? "")\n".utf8))
            p.standardError = log ?? FileHandle.nullDevice
            var failure: String?
            defer { try? log?.close() }
            do {
                try p.run()
                let killer = DispatchWorkItem { if p.isRunning { p.terminate() } }
                DispatchQueue.global().asyncAfter(deadline: .now() + 40, execute: killer)
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                p.waitUntilExit()
                killer.cancel()
                let last = String(decoding: data, as: UTF8.self).split(separator: "\n").last.map(String.init) ?? ""
                let json = (try? JSONSerialization.jsonObject(with: Data(last.utf8))) as? [String: Any]
                if p.terminationStatus != 0 || json?["ok"] as? Bool != true {
                    failure = (json?["error"] as? String) ?? (p.terminationReason == .uncaughtSignal ? "Apple TV timed out" : "Apple TV didn't respond")
                }
                log?.write(Data("result: \(failure ?? "ok") (exit \(p.terminationStatus))\n".utf8))
            } catch {
                failure = "Couldn't start the launcher"
            }
            DispatchQueue.main.async { done(failure) }
        }
    }

    /// Opens the one-time setup (environment + pairing) in Terminal.
    static func openSetup() {
        guard let s = setupScript else { return }
        NSWorkspace.shared.open([s], withApplicationAt: URL(fileURLWithPath: "/System/Applications/Utilities/Terminal.app"),
                                configuration: NSWorkspace.OpenConfiguration())
    }
}

/// Feedback for the last "Watch on Apple TV" press, shown in the island and the menu bar for a few seconds.
struct TVNote {
    enum Phase { case sending, done, failed }
    let id: String
    let phase: Phase
    let text: String
}

struct Payload: Codable {
    let generatedAt: String
    let events: [Event]
}

let timeFormatter: DateFormatter = {
    let f = DateFormatter()
    f.timeStyle = .short
    f.dateStyle = .none
    return f
}()
let dayFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "EEE"
    return f
}()

/// Debug: `--fake-live` (or SPORT_BRAIN_FAKE_LIVE=1) adds two made-up games, one live and one about to start,
/// so the switcher and show/hide logic can be checked when nothing real is on. Off in normal launches.
let fakeLive = CommandLine.arguments.contains("--fake-live") || ProcessInfo.processInfo.environment["SPORT_BRAIN_FAKE_LIVE"] == "1"
let launchedAt = Date()

func fakeEvents() -> [Event] {
    let iso = { (d: Date) in Event.iso.string(from: d) }
    let json = """
    [{"id":"fake-1","sport":"soccer","league":"Premier League","title":"Arsenal v Chelsea","detail":"Fake game for testing",
      "home":"Arsenal","away":"Chelsea","homeAbbr":"ARS","awayAbbr":"CHE","start":"\(iso(launchedAt.addingTimeInterval(-3600)))",
      "state":"in","statusText":"67'","score":{"home":"2","away":"1"},"tier":1,"hideScore":true,
      "watch":{"options":[{"name":"Sky Sports","owned":true,"url":"https://www.skysports.com/watch"},
        {"key":"peacock","name":"Peacock","owned":true,"url":"https://www.peacocktv.com/sports/live-and-upcoming"}]},"why":"Debug: fake live game."},
     {"id":"fake-2","sport":"basketball","league":"NBA","title":"Celtics at Knicks","detail":"Fake game for testing",
      "home":"Knicks","away":"Celtics","homeAbbr":"NYK","awayAbbr":"BOS","start":"\(iso(launchedAt.addingTimeInterval(360)))",
      "state":"pre","tier":2,"watch":{"options":[{"name":"NBA League Pass","owned":true,"url":"https://www.nba.com/watch"}]},
      "why":"Debug: fake game about to start."}]
    """
    return (try? JSONDecoder().decode([Event].self, from: Data(json.utf8))) ?? []
}

final class Store: ObservableObject {
    @Published var events: [Event] = []
    @Published var now = Date()
    @Published var revealed: Set<String> = []
    @Published var pulse = false
    @Published var hover = false
    /// The game picked in the switcher. Cleared once that game is no longer on, which brings back the automatic choice.
    @Published var selectedId: String?
    /// Show the island all day (next game when nothing is on), as the app used to.
    @Published var alwaysShow = UserDefaults.standard.bool(forKey: "alwaysShowIsland") {
        didSet { UserDefaults.standard.set(alwaysShow, forKey: "alwaysShowIsland") }
    }
    /// Something is live, about to start, or finished under five minutes ago: the island should be up.
    @Published private(set) var onAir = false
    /// Current size of the visible pill, reported by the view, used for hit-testing the mouse.
    var pillSize = CGSize(width: 290, height: 30)
    @Published var loaded = false
    private var liveIds: Set<String> = []
    private var lastActive: Date?
    private var lingerId: String?
    /// Events whose state has come from the ESPN poll, so their `pre` can be trusted over the clock.
    private var polled: Set<String> = []
    private var timers: [Timer] = []
    /// Per game: the match phase the feed last reported, when we first saw it, and whether we saw it begin.
    private var phase: [String: (name: String, since: Date, observed: Bool)] = [:]

    /// ESPN's match clock for rugby (and at times football) sticks for minutes on end, e.g. "1'" ten minutes in.
    /// When the feed's minute lags, count the minutes ourselves from the moment the half began. If we did not
    /// see the half begin (the app started mid-game), count from the scheduled time and mark it "~" as approximate.
    private func liveClock(_ e: Event, phaseName: String?, feedText: String?) -> String? {
        let half: Int
        switch e.sport {
        case "rugby": half = 40
        case "soccer": half = 45
        default: return feedText
        }
        guard let name = phaseName else { return feedText }
        let prev = phase[e.id]
        if prev?.name != name {
            let sawItStart = prev != nil || (polled.contains(e.id) && e.state == "pre")
            phase[e.id] = (name, now, sawItStart)
        }
        guard let p = phase[e.id] else { return feedText }
        if name.contains("HALFTIME") { return "HT" }
        let base: Int, anchor: Date
        if name.contains("FIRST_HALF") {
            base = 0
            anchor = p.observed ? p.since : e.date
        } else if name.contains("SECOND_HALF") {
            base = half
            anchor = p.observed ? p.since : e.date.addingTimeInterval(Double(half + 18) * 60)
        } else { return feedText }
        let est = base + max(Int(now.timeIntervalSince(anchor) / 60) + 1, 1)
        let feedMinute = feedText.flatMap { Int($0.trimmingCharacters(in: CharacterSet.decimalDigits.inverted)) }
        if let f = feedMinute, f >= est - 1 { return feedText }
        let cap = base + half
        return (p.observed ? "" : "~") + (est > cap ? "\(cap)+'" : "\(est)'")
    }

    func start() {
        load()
        timers.append(Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in self?.load() })
        timers.append(Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in self?.tick() })
    }

    func isLive(_ e: Event) -> Bool {
        if e.state == "in" { return true }
        // Fallback for events the feed has not reported on: assume on from the start time for a typical length.
        guard e.state == "pre", e.timeTbc != true, !polled.contains(e.id) else { return false }
        let elapsed = now.timeIntervalSince(e.date)
        return elapsed >= 0 && elapsed < e.hours * 3600
    }
    /// Starts within ten minutes, or the feed says it has not started yet although the start time has passed (delayed).
    func isSoon(_ e: Event) -> Bool {
        guard e.state == "pre", e.timeTbc != true, !isLive(e) else { return false }
        let until = e.date.timeIntervalSince(now)
        if until > 0 { return until <= 600 }
        return polled.contains(e.id) && -until < e.hours * 3600
    }
    func isActive(_ e: Event) -> Bool { e.timeTbc != true && (isLive(e) || isSoon(e)) }
    func isEnded(_ e: Event) -> Bool { e.state == "post" || (!isActive(e) && e.date < now) }

    /// Games that keep the island up, best first: live before about-to-start, then tier 1, picks, tier 2.
    var active: [Event] {
        events.filter(isActive).sorted { a, b in
            (isLive(a) ? 0 : 1, a.rank, a.date) < (isLive(b) ? 0 : 1, b.rank, b.date)
        }
    }
    var chosen: Event? { active.first { $0.id == selectedId } ?? active.first }
    var live: [Event] { events.filter(isLive).sorted { $0.rank < $1.rank } }
    var upcoming: [Event] {
        events.filter { !isLive($0) && $0.state != "post" && $0.timeTbc != true && $0.date > now }
    }
    /// The single answer to "what should I put on?": the best live game, else the next one worth knowing about.
    var top: Event? { live.first ?? upcoming.first { $0.rank < 2 } ?? upcoming.first }
    /// The game the island shows: the chosen active one, the one that just finished, or (always-show) the next one.
    var shown: Event? {
        if let c = chosen { return c }
        if onAir, let id = lingerId, let e = events.first(where: { $0.id == id }) { return e }
        return alwaysShow ? top : nil
    }
    var later: [Event] {
        let s = shown?.id
        let pool = (active.count > 1 ? [] : active) + upcoming.filter { !isActive($0) }
        return Array(pool.filter { $0.id != s }.prefix(3))
    }
    func scoreHidden(_ e: Event) -> Bool { e.hideScore == true && !revealed.contains(e.id) }
    func hasScore(_ e: Event) -> Bool { e.score != nil && (isLive(e) || e.state == "post") }

    func select(_ e: Event) {
        selectedId = e.id
        refreshOnAir()
    }

    @Published var tvNote: TVNote?
    private var tvNoteClear: DispatchWorkItem?

    func openOnMac(_ e: Event) {
        NSWorkspace.shared.open(e.link?.url.flatMap { URL(string: $0) } ?? pageURL)
    }

    /// Wakes the Apple TV and opens the game's app there. If that fails, says so and opens it on this Mac instead.
    func watchOnTV(_ e: Event) {
        guard let t = e.tvTarget, let key = t.option.key else { openOnMac(e); return }
        if tvNote?.phase == .sending { return }
        setNote(TVNote(id: e.id, phase: .sending, text: "Sending \(t.app) to Apple TV…"), clearAfter: nil)
        AppleTV.launch(key: key, url: AppleTV.deepLink(t.option)) { [weak self] err in
            guard let self = self else { return }
            if let err = err {
                NSLog("Apple TV launch failed: \(err)")
                self.setNote(TVNote(id: e.id, phase: .failed, text: "Apple TV didn't respond · opened here"), clearAfter: 7)
                self.openOnMac(e)
            } else {
                self.setNote(TVNote(id: e.id, phase: .done, text: "\(t.app) is opening on Apple TV"), clearAfter: 6)
            }
        }
    }

    private func setNote(_ n: TVNote, clearAfter: Double?) {
        tvNoteClear?.cancel()
        tvNote = n
        guard let s = clearAfter else { return }
        let w = DispatchWorkItem { [weak self] in self?.tvNote = nil }
        tvNoteClear = w
        DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: w)
    }

    func whenText(_ e: Event) -> String {
        let mins = Int(e.date.timeIntervalSince(now) / 60)
        if mins < 0 { return "starting" }
        if mins < 60 { return "in \(max(mins, 1)) min" }
        if Calendar.current.isDateInToday(e.date) { return timeFormatter.string(from: e.date) }
        return "\(dayFormatter.string(from: e.date)) \(timeFormatter.string(from: e.date))"
    }

    func load() {
        var req = URLRequest(url: dataURL)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            guard let data = data, let p = try? JSONDecoder().decode(Payload.self, from: data) else { return }
            DispatchQueue.main.async {
                self?.events = p.events + (fakeLive ? fakeEvents() : [])
                let first = self?.loaded == false
                self?.loaded = true
                self?.tick()
                // `--demo` opens the island once at launch, for checking the expanded layout.
                if first, CommandLine.arguments.contains("--demo") { self?.announce() }
            }
        }.resume()
    }

    func tick() {
        now = Date()
        // Poll live scores directly for anything on now or starting within ten minutes.
        let hot = events.filter { $0.feed != nil && $0.state != "post" && (isActive($0) || abs($0.date.timeIntervalSince(now)) < 600) }
        for feed in Set(hot.compactMap { $0.feed }) { poll(feed) }
        refreshOnAir()
    }

    /// Works out whether the island should be up, drops a stale selection, and opens the island when a game goes live.
    func refreshOnAir() {
        let a = active
        if let s = selectedId, !a.contains(where: { $0.id == s }) { selectedId = nil }
        if let c = chosen {
            lastActive = now
            lingerId = c.id
        }
        let on = !a.isEmpty || (lastActive.map { now.timeIntervalSince($0) < 300 } ?? false)
        if !on { lingerId = nil }
        if on != onAir { onAir = on }
        let ids = Set(live.filter { $0.timeTbc != true }.map(\.id))
        if loaded, !ids.subtracting(liveIds).isEmpty { announce() }
        liveIds = ids
    }

    func announce() {
        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) { pulse = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) { self?.pulse = false }
        }
    }

    private func poll(_ feed: String) {
        guard let url = URL(string: "\(espnBase)/\(feed)/scoreboard") else { return }
        var req = URLRequest(url: url)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            guard let data = data,
                  let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let evs = root["events"] as? [[String: Any]] else { return }
            var updates: [String: (String?, String?, String?, String?, String?)] = [:]
            for ev in evs {
                guard let id = ev["id"] as? String,
                      let comp = (ev["competitions"] as? [[String: Any]])?.first else { continue }
                let status = (comp["status"] as? [String: Any]) ?? (ev["status"] as? [String: Any]) ?? [:]
                let type = status["type"] as? [String: Any] ?? [:]
                var home: String?, away: String?
                for c in comp["competitors"] as? [[String: Any]] ?? [] {
                    let s = (c["score"] as? String) ?? ((c["score"] as? [String: Any])?["displayValue"] as? String)
                    if c["homeAway"] as? String == "home" { home = s } else { away = s }
                }
                updates[id] = (type["state"] as? String, (status["summary"] as? String) ?? (type["shortDetail"] as? String), home, away, type["name"] as? String)
            }
            DispatchQueue.main.async {
                guard let self = self else { return }
                var changed = self.events
                for i in changed.indices where changed[i].feed == feed {
                    let espnId = changed[i].id.components(separatedBy: "-").dropFirst().joined(separator: "-")
                    guard let u = updates[espnId] else { continue }
                    let clock = u.0 == "in" ? self.liveClock(changed[i], phaseName: u.4, feedText: u.1) : u.1
                    if let st = u.0 { changed[i].state = st; self.polled.insert(changed[i].id) }
                    if let d = clock { changed[i].statusText = d }
                    if changed[i].state != "pre" { changed[i].score = Score(home: u.2, away: u.3) }
                }
                self.events = changed
                self.refreshOnAir()
            }
        }.resume()
    }
}

// MARK: - Island view

struct IslandView: View {
    @ObservedObject var store: Store
    let notchWidth: CGFloat
    let barHeight: CGFloat
    private var expanded: Bool { store.hover || store.pulse }
    private var spring: Animation { .spring(response: 0.36, dampingFraction: 0.82) }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                collapsedRow.frame(height: barHeight)
                if expanded { expandedBody.transition(.opacity) }
            }
            .frame(width: expanded ? 440 : collapsedWidth)
            .background(Color.black)
            .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: expanded ? 28 : 13, bottomTrailingRadius: expanded ? 28 : 13, style: .continuous))
            .shadow(color: .black.opacity(expanded ? 0.4 : 0), radius: 20, y: 10)
            .background(GeometryReader { g in Color.clear.onAppear { store.pillSize = g.size }.onChange(of: g.size) { _, n in store.pillSize = n } })
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .environment(\.colorScheme, .dark)
        .animation(spring, value: expanded)
    }

    private var collapsedWidth: CGFloat { notchWidth > 0 ? notchWidth + 250 : 290 }

    private var collapsedRow: some View {
        let t = store.shown
        let live = t.map(store.isLive) ?? false
        let ended = t.map(store.isEnded) ?? false
        let others = store.active.filter { $0.id != t?.id }.count
        let left: String = {
            guard let t = t else { return store.loaded ? "Nothing on" : "Sport Brain" }
            if store.hasScore(t) && !store.scoreHidden(t) { return t.scoreLine }
            return t.matchup
        }()
        let right: String = {
            guard let t = t else { return "" }
            if live { return store.scoreHidden(t) ? "LIVE" : String((t.statusText ?? "LIVE").prefix(16)) }
            if ended { return store.scoreHidden(t) ? "Ended" : String((t.statusText ?? "Ended").prefix(16)) }
            return store.whenText(t)
        }()
        return HStack(spacing: 7) {
            Text(t?.emoji ?? "🏟️").font(.system(size: 12))
            if live { Circle().fill(Color.red).frame(width: 6, height: 6) }
            Text(left).font(.system(size: 12, weight: .semibold)).monospacedDigit().lineLimit(1)
            if others > 0 {
                Text("+\(others)").font(.system(size: 10, weight: .bold)).foregroundStyle(.white.opacity(0.7))
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background(Capsule().fill(Color.white.opacity(0.16)))
            }
            Spacer(minLength: notchWidth > 0 ? notchWidth : 8)
            Text(right).font(.system(size: 12, weight: .medium)).monospacedDigit().lineLimit(1)
                .foregroundStyle(live ? Color.red : Color.white.opacity(0.62))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
    }

    @ViewBuilder private var expandedBody: some View {
        VStack(alignment: .leading, spacing: 0) {
            if store.active.count > 1 { switcher.padding(.bottom, 12) }
            if let t = store.shown {
                let live = store.isLive(t)
                let ended = store.isEnded(t)
                Text(live ? "ON NOW" : ended ? "FINISHED" : store.isSoon(t) ? "STARTING · \(store.whenText(t).uppercased())" : "NEXT UP · \(store.whenText(t).uppercased())")
                    .font(.system(size: 11, weight: .bold)).kerning(0.5)
                    .foregroundStyle(live ? Color.red : ended ? Color.white.opacity(0.55) : Color.blue)
                Text((t.isMine ? "★ " : "") + t.title)
                    .font(.system(size: 18, weight: .bold)).padding(.top, 5).fixedSize(horizontal: false, vertical: true)
                Text([t.detail, t.league].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 12)).foregroundStyle(.white.opacity(0.6)).padding(.top, 2)
                if store.hasScore(t) {
                    if store.scoreHidden(t) {
                        Button("Score hidden · show") { store.revealed.insert(t.id) }
                            .buttonStyle(PillButton(fill: Color.white.opacity(0.14))).padding(.top, 9)
                    } else {
                        Text("\(t.scoreLine)\(t.statusText.map { "  ·  \($0)" } ?? "")")
                            .font(.system(size: 15, weight: .semibold)).monospacedDigit().padding(.top, 9)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                if let why = t.why {
                    Text(why).font(.system(size: 13)).foregroundStyle(.white.opacity(0.85)).padding(.top, 8)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 8) {
                    if let tv = t.tvTarget {
                        let sending = store.tvNote?.phase == .sending
                        Button(sending ? "Sending to Apple TV…" : "▶ \(tv.app) on Apple TV") { store.watchOnTV(t) }
                            .buttonStyle(PillButton(fill: .blue)).disabled(sending)
                        if t.link?.url != nil {
                            Button("Open on this Mac") { store.openOnMac(t) }
                                .buttonStyle(PillButton(fill: Color.white.opacity(0.14)))
                        }
                    } else if let l = t.link, let s = l.url, let url = URL(string: s) {
                        Button("▶ Watch on \(t.whereText)") { NSWorkspace.shared.open(url) }
                            .buttonStyle(PillButton(fill: .blue))
                    } else {
                        Text(t.whereText).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.6))
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(Capsule().fill(Color.white.opacity(0.12)))
                    }
                    Button(t.tvTarget == nil ? "Open board" : "Board") { NSWorkspace.shared.open(pageURL) }
                        .buttonStyle(PillButton(fill: Color.white.opacity(0.14)))
                }
                .padding(.top, 12)
                if let n = store.tvNote, n.id == t.id {
                    Text(n.text).font(.system(size: 12, weight: .medium))
                        .foregroundStyle(n.phase == .failed ? Color.orange : n.phase == .done ? Color.green : Color.white.opacity(0.7))
                        .padding(.top, 8)
                }
            } else {
                Text(store.loaded ? "Nothing on the schedule right now." : "Loading…")
                    .font(.system(size: 13)).foregroundStyle(.white.opacity(0.7))
            }
            if !store.later.isEmpty {
                Rectangle().fill(Color.white.opacity(0.12)).frame(height: 1).padding(.vertical, 12)
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(store.later) { e in
                        HStack(spacing: 8) {
                            Text(e.emoji).font(.system(size: 12))
                            Text((e.isMine ? "★ " : "") + e.title).font(.system(size: 12, weight: .medium)).lineLimit(1)
                            Spacer(minLength: 6)
                            Text(store.isLive(e) ? "LIVE" : store.whenText(e)).font(.system(size: 12)).monospacedDigit()
                                .foregroundStyle(store.isLive(e) ? Color.red : Color.white.opacity(0.55))
                        }
                    }
                }
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 18).padding(.top, 6).padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// One chip per game that is on or about to start; clicking one shows it in the pill and the detail below.
    private var switcher: some View {
        let current = store.shown?.id
        return HStack(spacing: 6) {
            ForEach(Array(store.active.prefix(4))) { e in
                let selected = e.id == current
                Button { store.select(e) } label: {
                    HStack(spacing: 5) {
                        Text(e.emoji).font(.system(size: 11))
                        if store.isLive(e) { Circle().fill(Color.red).frame(width: 5, height: 5) }
                        Text(e.matchup).font(.system(size: 11, weight: .semibold)).lineLimit(1)
                    }
                    .foregroundStyle(.white.opacity(selected ? 1 : 0.7))
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Capsule().fill(Color.white.opacity(selected ? 0.26 : 0.09)))
                    .overlay(Capsule().strokeBorder(Color.white.opacity(selected ? 0.45 : 0), lineWidth: 1))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
        }
    }
}

struct PillButton: ButtonStyle {
    let fill: Color
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(Capsule().fill(fill))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

// MARK: - Window, menu bar and app

final class IslandPanel: NSPanel {
    init() {
        super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 2)
        collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        isMovable = false
        hidesOnDeactivate = false
        isFloatingPanel = true
    }
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    // AppKit normally pushes windows below the menu bar; the island sits in it, like a notch.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

final class ClickThroughHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class ClosureItem: NSMenuItem {
    private var handler: (() -> Void)?
    convenience init(_ title: String, checked: Bool = false, _ handler: @escaping () -> Void) {
        self.init(title: title, action: #selector(fire), keyEquivalent: "")
        self.handler = handler
        target = self
        state = checked ? .on : .off
    }
    @objc private func fire() { handler?() }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let store = Store()
    var panel: IslandPanel?
    var statusItem: NSStatusItem!
    var bag: Set<AnyCancellable> = []
    var islandHidden: Bool {
        get { UserDefaults.standard.bool(forKey: "hideIsland") }
        set { UserDefaults.standard.set(newValue, forKey: "hideIsland") }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
        store.objectWillChange.receive(on: DispatchQueue.main).sink { [weak self] _ in
            DispatchQueue.main.async { self?.refreshStatus() }
        }.store(in: &bag)
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            self?.layout()
        }
        // SwiftUI hover stops firing once another app is active, so track the pointer directly.
        NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] _ in self?.trackPointer() }
        NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] e in self?.trackPointer(); return e }
        Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.trackPointer() }
        store.start()
        // Debug: `--tv-test KEY` sends KEY's app to the Apple TV once at launch, the same way the button does.
        if let i = CommandLine.arguments.firstIndex(of: "--tv-test"), i + 1 < CommandLine.arguments.count {
            AppleTV.launch(key: CommandLine.arguments[i + 1], url: nil) { err in NSLog("tv-test: \(err ?? "ok")") }
        }
        layout()
        refreshStatus()
    }

    func trackPointer() {
        guard let p = panel, p.isVisible else { return }
        let size = store.pillSize, m = NSEvent.mouseLocation, f = p.frame
        let slop: CGFloat = store.hover ? 10 : 0
        let rect = NSRect(x: f.midX - size.width / 2 - slop, y: f.maxY - size.height - slop, width: size.width + slop * 2, height: size.height + slop + 2)
        let inside = rect.contains(m)
        if inside != store.hover { store.hover = inside }
    }

    /// The island is on screen only while a game is on (or just finished), unless "Always show island" is ticked.
    /// Otherwise the panel is ordered out, so nothing is drawn and nothing catches clicks.
    func applyVisibility() {
        guard let p = panel else { return }
        let want = !islandHidden && (store.alwaysShow || store.onAir)
        if want, !p.isVisible {
            p.orderFrontRegardless()
        } else if !want, p.isVisible {
            p.orderOut(nil)
            if store.hover { store.hover = false }
        }
    }

    /// Pins the island to the top centre of the main screen. On a notched display it wraps the notch.
    func layout() {
        guard let screen = NSScreen.main ?? NSScreen.screens.first else { return }
        let p = panel ?? IslandPanel()
        panel = p
        var notch: CGFloat = 0
        if screen.safeAreaInsets.top > 0, let l = screen.auxiliaryTopLeftArea, let r = screen.auxiliaryTopRightArea {
            notch = max(screen.frame.width - l.width - r.width, 0)
        }
        let menuBar = screen.frame.maxY - screen.visibleFrame.maxY
        let bar = max(screen.safeAreaInsets.top, menuBar, 24)
        let size = NSSize(width: 520, height: 420)
        p.setFrame(NSRect(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY - size.height, width: size.width, height: size.height), display: true)
        p.contentView = ClickThroughHostingView(rootView: IslandView(store: store, notchWidth: notch, barHeight: bar))
        applyVisibility()
    }

    /// With the island switched on, the menu bar item is just an icon. With it switched off, the item carries the text.
    func refreshStatus() {
        applyVisibility()
        guard let button = statusItem.button else { return }
        if let n = store.tvNote {  // feedback for a menu-bar "Watch on Apple TV"
            button.title = "📺 " + (n.phase == .sending ? "Sending…" : n.phase == .done ? "On Apple TV" : "Apple TV failed")
            return
        }
        let shown = store.shown ?? store.top
        guard islandHidden, let t = shown else {
            button.title = shown?.emoji ?? "🏟️"
            return
        }
        let live = store.isLive(t)
        if store.hasScore(t) && !store.scoreHidden(t) { button.title = "\(t.emoji) \(t.scoreLine)" }
        else { button.title = "\(t.emoji) \(t.matchup) · \(live ? "LIVE" : store.isEnded(t) ? "Ended" : store.whenText(t))" }
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        var items: [Event] = []
        for e in (store.shown.map { [$0] } ?? []) + store.active + store.upcoming where !items.contains(where: { $0.id == e.id }) {
            items.append(e)
        }
        items = Array(items.prefix(5))
        if items.isEmpty { menu.addItem(NSMenuItem(title: "Nothing on the schedule", action: nil, keyEquivalent: "")) }
        for e in items {
            let when = store.isLive(e) ? "LIVE" : store.isEnded(e) ? "Ended" : store.whenText(e)
            let title = "\(e.emoji)  \(e.isMine ? "★ " : "")\(e.title) · \(when) · \(e.whereText)"
            if let tv = e.tvTarget {
                // Same choice as the island: Apple TV first, this Mac second.
                let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
                let sub = NSMenu()
                sub.addItem(ClosureItem("📺  Watch on Apple TV (\(tv.app))") { [weak self] in self?.store.watchOnTV(e) })
                sub.addItem(ClosureItem("💻  Open on this Mac") { [weak self] in self?.store.openOnMac(e) })
                item.submenu = sub
                menu.addItem(item)
            } else {
                menu.addItem(ClosureItem(title) { [weak self] in self?.store.openOnMac(e) })
            }
        }
        // Same choice as the island's switcher: which of the games on now the island shows.
        let active = store.active
        if active.count > 1 {
            menu.addItem(.separator())
            menu.addItem(NSMenuItem(title: "Show in island", action: nil, keyEquivalent: ""))
            let current = store.shown?.id
            for e in active {
                let item = ClosureItem("\(e.emoji)  \(e.matchup) · \(store.isLive(e) ? "LIVE" : store.whenText(e))",
                                       checked: e.id == current) { [weak self] in self?.store.select(e) }
                item.indentationLevel = 1
                menu.addItem(item)
            }
        }
        menu.addItem(.separator())
        menu.addItem(ClosureItem("Open Sport Brain") { NSWorkspace.shared.open(pageURL) })
        menu.addItem(ClosureItem(AppleTV.isReady ? "Re-pair Apple TV…" : "Set up Apple TV…") { AppleTV.openSetup() })
        menu.addItem(ClosureItem("Show island", checked: !islandHidden) { [weak self] in
            guard let self = self else { return }
            self.islandHidden.toggle()
            self.refreshStatus()
        })
        menu.addItem(ClosureItem("Always show island", checked: store.alwaysShow) { [weak self] in
            guard let self = self else { return }
            self.store.alwaysShow.toggle()
            self.refreshStatus()
        })
        let loginOn = SMAppService.mainApp.status == .enabled
        menu.addItem(ClosureItem("Open at login", checked: loginOn) {
            do { if loginOn { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() } }
            catch { NSLog("Login item change failed: \(error.localizedDescription)") }
        })
        menu.addItem(.separator())
        menu.addItem(ClosureItem("Quit") { NSApp.terminate(nil) })
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
