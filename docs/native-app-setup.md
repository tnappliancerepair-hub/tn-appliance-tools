# 🐜 Ant Field — Native App (iOS + Android) Setup

The scaffold lives in **`mobile/`**. It's a **Capacitor** wrapper that loads the
live tech web app (`tnapplianceexchange.net/tech.html`) inside a real native
shell — so the app content still updates instantly (no store resubmission for
content changes), but you get a real installable app + **native push
notifications** (the real fix for "techs ignore texts").

## Why this approach
- **Keep 100% of the web work.** The app *is* the live site; edits to the
  dashboards ship the moment they merge to main. No rebuild needed for content.
- **Real app + icon**, no "Add to Home Screen" dance.
- **Native push** — a lock-screen notification with a badge that persists until
  tapped. Far more engaging than SMS, and free.

## What YOU need (one-time)
- **Apple Developer account** — $99/yr (required for any iOS app, even TestFlight).
- **Google Play Developer account** — $25 one-time (only if you want Play Store;
  Android can also be a direct-download APK with no account).
- A **Mac with Xcode** (your Mac Mini works) for iOS builds.
- **Android Studio** for Android builds (any OS).

## Build steps (on the Mac)
```bash
cd ~/tn-appliance-tools/mobile
npm install
npx cap add ios          # creates mobile/ios/ (Xcode project)
npx cap add android      # creates mobile/android/ (Android Studio project)
npx cap sync             # applies capacitor.config.json
```
Then:
- **iOS:** `npx cap open ios` → in Xcode set your Team (Apple Developer), bump
  the version, then **Product ▸ Archive** → distribute to **TestFlight** (invite
  the techs by email — up to 100, no public App Store review needed).
- **Android:** `npx cap open android` → in Android Studio **Build ▸ Generate
  Signed Bundle/APK** → share the APK link, or upload the AAB to Play Console.

## App identity (already set in `capacitor.config.json`)
- **appId:** `com.tnappliance.antfield`  (change before first publish if desired)
- **appName:** `Ant Field`
- **server.url:** `https://tnapplianceexchange.net/tech.html` (loads live app)

## Push notifications (phase 2 — the engagement win)
Push needs a bit more wiring; do it after the basic app installs cleanly:
1. **Android (FCM):** create a Firebase project → add an Android app with
   `com.tnappliance.antfield` → download `google-services.json` into
   `mobile/android/app/`. Capacitor's `@capacitor/push-notifications` handles the
   rest.
2. **iOS (APNs):** in the Apple Developer portal enable **Push Notifications** on
   the App ID + create an **APNs Auth Key (.p8)**. Add the **Push Notifications**
   capability in Xcode.
3. **Register the device token:** ✅ BUILT — `ant-push.js` (loaded on the tech
   pages) registers on app launch and POSTs the token to `register-push-token.js`
   (stored per-tech in event_log). No-op in a normal browser.
4. **Send a push:** ✅ BUILT — `send-push.js` sends via **FCM** (Android) or
   **APNs** (iOS, HTTP/2 + ES256 JWT). Dormant until keys exist (returns
   `configured:false`). The colony loop already calls it from `sms.toTech` —
   every tech notification fires a push alongside the in-app inbox — gated by
   `PUSH_ENABLED=true` in `colony-loop/.env`.

### Push keys → the vault (admin-secrets.html), then flip it on
- **Android (FCM v1):** `FCM_SERVICE_ACCOUNT` = the full service-account JSON
  (Firebase → Project settings → Service accounts → Generate new private key).
- **iOS (APNs):** `APNS_KEY_P8` (full `.p8` contents), `APNS_KEY_ID`,
  `APNS_TEAM_ID`, `APNS_BUNDLE_ID` (defaults `com.tnappliance.antfield`).
- Then on the Mac: `echo 'PUSH_ENABLED=true' >> colony-loop/.env` + loop
  kickstart. From then on, Ant's tech notifications arrive as real lock-screen
  pushes — the free, can't-ignore replacement for SMS.

## Sequence recommendation
1. ✅ In-app Messages inbox (DONE — the app's content).
2. Build the basic wrapper above → install on the techs' phones (TestFlight / APK).
3. Add push (phase 2) → reroute Ant's tech notices to push + the in-app inbox.
4. Retire the tech-direction SMS firehose.
