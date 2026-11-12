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

final class Store: ObservableObject {
    @Published var events: [Event] = []
    @Published var now = Date()
    @Published var revealed: Set<String> = []
    @Published var pulse = false
    @Published var loaded = false
    private var lastLiveTop: String?
    private var timers: [Timer] = []

    func start() {
        load()
        timers.append(Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in self?.load() })
        timers.append(Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in self?.tick() })
    }

    func isLive(_ e: Event) -> Bool {
        if e.state == "in" { return true }
        guard e.state == "pre", e.timeTbc != true else { return false }
        let elapsed = now.timeIntervalSince(e.date)
        return elapsed >= 0 && elapsed < e.hours * 3600
    }
    var live: [Event] { events.filter(isLive).sorted { $0.rank < $1.rank } }
    var upcoming: [Event] {
        events.filter { !isLive($0) && $0.state != "post" && $0.timeTbc != true && $0.date > now }
    }
    /// The single answer to "what should I put on?": the best live game, else the next one worth knowing about.
    var top: Event? { live.first ?? upcoming.first { $0.rank < 2 } ?? upcoming.first }
    var later: [Event] {
        let t = top?.id
        return Array((live.dropFirst() + upcoming).filter { $0.id != t }.prefix(3))
    }
    func scoreHidden(_ e: Event) -> Bool { e.hideScore == true && !revealed.contains(e.id) }

    func whenText(_ e: Event) -> String {
        let mins = Int(e.date.timeIntervalSince(now) / 60)
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
                self?.events = p.events
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
        let hot = events.filter { $0.feed != nil && $0.state != "post" && (isLive($0) || abs($0.date.timeIntervalSince(now)) < 600) }
        for feed in Set(hot.compactMap { $0.feed }) { poll(feed) }
        if let t = live.first, t.id != lastLiveTop {
            if lastLiveTop != nil || loaded { announce() }
            lastLiveTop = t.id
        } else if live.isEmpty { lastLiveTop = nil }
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
            var updates: [String: (String?, String?, String?, String?)] = [:]
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
                updates[id] = (type["state"] as? String, (status["summary"] as? String) ?? (type["shortDetail"] as? String), home, away)
            }
            DispatchQueue.main.async {
                guard let self = self else { return }
                var changed = self.events
                for i in changed.indices where changed[i].feed == feed {
                    let espnId = changed[i].id.components(separatedBy: "-").dropFirst().joined(separator: "-")
                    guard let u = updates[espnId] else { continue }
                    if let st = u.0 { changed[i].state = st }
                    if let d = u.1 { changed[i].statusText = d }
                    if changed[i].state != "pre" { changed[i].score = Score(home: u.2, away: u.3) }
                }
                self.events = changed
            }
        }.resume()
    }
}

// MARK: - Island view

struct IslandView: View {
    @ObservedObject var store: Store
    let notchWidth: CGFloat
    let barHeight: CGFloat
    @State private var hover = false

    private var expanded: Bool { hover || store.pulse }
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
            .contentShape(Rectangle())
            .onHover { h in withAnimation(spring) { hover = h } }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .environment(\.colorScheme, .dark)
    }

    private var collapsedWidth: CGFloat { notchWidth > 0 ? notchWidth + 250 : 290 }

    private var collapsedRow: some View {
        let t = store.top
        let live = t.map(store.isLive) ?? false
        let left: String = {
            guard let t = t else { return store.loaded ? "Nothing on" : "Sport Brain" }
            if live && t.score != nil && !store.scoreHidden(t) { return t.scoreLine }
            return t.matchup
        }()
        let right: String = {
            guard let t = t else { return "" }
            if live { return store.scoreHidden(t) ? "LIVE" : String((t.statusText ?? "LIVE").prefix(16)) }
            return store.whenText(t)
        }()
        return HStack(spacing: 7) {
            Text(t?.emoji ?? "🏟️").font(.system(size: 12))
            if live { Circle().fill(Color.red).frame(width: 6, height: 6) }
            Text(left).font(.system(size: 12, weight: .semibold)).monospacedDigit().lineLimit(1)
            Spacer(minLength: notchWidth > 0 ? notchWidth : 8)
            Text(right).font(.system(size: 12, weight: .medium)).monospacedDigit().lineLimit(1)
                .foregroundStyle(live ? Color.red : Color.white.opacity(0.62))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
    }

    @ViewBuilder private var expandedBody: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let t = store.top {
                let live = store.isLive(t)
                Text(live ? "ON NOW" : "NEXT UP · \(store.whenText(t).uppercased())")
                    .font(.system(size: 11, weight: .bold)).kerning(0.5)
                    .foregroundStyle(live ? Color.red : Color.blue)
                Text((t.isMine ? "★ " : "") + t.title)
                    .font(.system(size: 18, weight: .bold)).padding(.top, 5).fixedSize(horizontal: false, vertical: true)
                Text([t.detail, t.league].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 12)).foregroundStyle(.white.opacity(0.6)).padding(.top, 2)
                if live, t.score != nil {
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
                    if let l = t.link, let s = l.url, let url = URL(string: s) {
                        Button("▶ Watch on \(t.whereText)") { NSWorkspace.shared.open(url) }
                            .buttonStyle(PillButton(fill: .blue))
                    } else {
                        Text(t.whereText).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.6))
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(Capsule().fill(Color.white.opacity(0.12)))
                    }
                    Button("Open board") { NSWorkspace.shared.open(pageURL) }
                        .buttonStyle(PillButton(fill: Color.white.opacity(0.14)))
                }
                .padding(.top, 12)
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
        store.start()
        layout()
        refreshStatus()
    }

    /// Pins the island to the top centre of the main screen. On a notched display it wraps the notch.
    func layout() {
        guard !islandHidden, let screen = NSScreen.main ?? NSScreen.screens.first else {
            panel?.orderOut(nil)
            return
        }
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
        p.contentView = NSHostingView(rootView: IslandView(store: store, notchWidth: notch, barHeight: bar))
        p.orderFrontRegardless()
    }

    /// With the island showing, the menu bar item is just an icon. With it hidden, the item carries the text.
    func refreshStatus() {
        guard let button = statusItem.button else { return }
        guard islandHidden, let t = store.top else {
            button.title = store.top?.emoji ?? "🏟️"
            return
        }
        let live = store.isLive(t)
        if live && t.score != nil && !store.scoreHidden(t) { button.title = "\(t.emoji) \(t.scoreLine)" }
        else { button.title = "\(t.emoji) \(t.matchup) · \(live ? "LIVE" : store.whenText(t))" }
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let items = (store.top.map { [$0] } ?? []) + store.later
        if items.isEmpty { menu.addItem(NSMenuItem(title: "Nothing on the schedule", action: nil, keyEquivalent: "")) }
        for e in items {
            let when = store.isLive(e) ? "LIVE" : store.whenText(e)
            let item = ClosureItem("\(e.emoji)  \(e.isMine ? "★ " : "")\(e.title) · \(when) · \(e.whereText)") {
                NSWorkspace.shared.open(e.link?.url.flatMap { URL(string: $0) } ?? pageURL)
            }
            menu.addItem(item)
        }
        menu.addItem(.separator())
        menu.addItem(ClosureItem("Open Sport Brain") { NSWorkspace.shared.open(pageURL) })
        menu.addItem(ClosureItem("Show island", checked: !islandHidden) { [weak self] in
            guard let self = self else { return }
            self.islandHidden.toggle()
            self.layout()
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
