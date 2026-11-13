# Sport Brain widget for iPhone

A Home Screen and Lock Screen widget that shows the game that matters most right now: the live score, or what's next, when it starts (in your phone's time), and which of your services has it. Tap it to open that service.

It runs inside **Scriptable**, a free app. No Xcode or developer account needed.

## What you'll see

- **Small widget:** one game. If it's on, a red dot, the score and the clock. If not, the kick-off time, how long until it starts, and where to watch.
- **Medium widget:** the same game on the left, plus the next three things on the right. Each row opens its own service when tapped.
- **Lock Screen:** a rectangle with the matchup on one line and the score or start time on the next. There's also a one-line version for above the clock, and a small round one.
- **Arsenal men's games never show a score.** You'll see "LIVE" or "Final" and nothing else, so nothing is spoiled.
- Service names in green are ones you have. Amber with a "?" means probably, but not confirmed. "Not on your services" means none of yours carry it.
- If your phone is offline, the widget keeps showing the last thing it saw, with a small amber **⚠︎ Stale** note and the time of that data.

## An honest note about live scores

iOS, not the widget, decides when a widget refreshes. Usually that is every 5 to 15 minutes, sometimes longer, and less often when the battery is low or you rarely look at it. So a live score on the widget can be several minutes behind. The widget asks for a refresh every 5 minutes while a game is on, but iOS treats that as a request, not a promise. Tap the widget, or open the board, for the latest.

## Install it (about 5 minutes)

### 1. Get Scriptable

Open the App Store, search for **Scriptable** (by Simon B. Støvring), and install it. It's free.

### 2. Add the script

1. On your iPhone, open this link in Safari:
   `https://raw.githubusercontent.com/joebentham/sport-brain/main/widget/sport-brain-widget.js`
   You'll see a page of code.
2. Tap and hold on the text, choose **Select All**, then **Copy**.
3. Open **Scriptable** and tap the **+** in the top-right corner.
4. Tap in the empty page and choose **Paste**.
5. Tap the title at the top (it says "Untitled Script") and rename it to **Sport Brain**.
6. Tap **Done** in the top-left corner.

*Another way:* this project lives in your iCloud Drive. In the **Files** app, go to `iCloud Drive › Claude › Sport Brain › widget`, press and hold `sport-brain-widget.js`, choose **Copy**, then go to `iCloud Drive › Scriptable` and **Paste**. Rename it to `Sport Brain.js` if you like. It then shows up in Scriptable on its own.

### 3. Try it once

In Scriptable, tap the **Sport Brain** script. After a second or two you should see a preview of the medium widget. If you do, it works. Tap **Close**.

### 4. Add it to your Home Screen

1. Press and hold an empty spot on your Home Screen until the icons jiggle.
2. Tap **Edit** in the top-left corner, then **Add Widget**.
3. Search for **Scriptable** and tap it.
4. Swipe to pick the **small** or **medium** size, then tap **Add Widget**.
5. While the icons are still jiggling, tap the new (empty) widget. If they've stopped, press and hold the widget and choose **Edit Widget**.
6. Next to **Script**, choose **Sport Brain**.
7. Leave the other settings as they are. Tap outside the box to finish.

You can add both a small and a medium one; each just needs **Script** set to Sport Brain.

### 5. Add it to your Lock Screen

1. Lock your phone, then press and hold the Lock Screen until **Customize** appears. Tap it, then choose **Lock Screen**.
2. Tap the box of widgets under the clock (or the **Add Widgets** button).
3. Find **Scriptable** and tap the **wide rectangle** size.
4. Tap the new widget you just placed and set **Script** to **Sport Brain**.
5. Optional: tap the date line above the clock, choose **Scriptable**, and set it to Sport Brain too for a one-line version.
6. Tap **Done** in the top-right corner.

## Updating it later

When the script changes, repeat step 2: copy the new code, open the Sport Brain script in Scriptable, select everything, and paste over it. Your widgets pick up the change on their next refresh.

## If something looks wrong

- **The widget says "Select script in widget configurator":** step 4.6 or 5.4 was missed. Press and hold the widget, choose **Edit Widget**, and set **Script** to Sport Brain.
- **Tapping opens Scriptable instead of the streaming app:** press and hold the widget, choose **Edit Widget**, and check **When Interacting** is set to **Open URL** if that option is shown. Otherwise leave it on the default.
- **"⚠︎ Stale" won't go away:** the phone may be offline, or the board's hourly update has stopped. Open the board at https://joebentham.github.io/sport-brain/ to check.
- **The score seems old:** see the note about live scores above. Tapping the widget gets you the latest.

## For whoever maintains this

- The script reads `https://joebentham.github.io/sport-brain/data/today.json`. For games that are live or start within 10 minutes it also asks ESPN's public scoreboard (`site.api.espn.com/apis/site/v2/sports/<feed>/scoreboard`) and matches the game by the number in its `id`.
- Which game is shown follows the board's own rule: a live game of yours or a pick first, then the next game of yours or a pick, then anything else that is next, then any live game. Games with no confirmed time are skipped.
- Data is cached in Scriptable's local Documents folder (`sport-brain-widget-cache.json`). The widget is marked stale when the fetch fails, or when the data is more than three hours old.
- `test/run.mjs` exercises the logic under Node with a stub of Scriptable's objects: `TZ=America/New_York node widget/test/run.mjs`. It does not draw anything; how the widget actually looks can only be checked on a phone.
