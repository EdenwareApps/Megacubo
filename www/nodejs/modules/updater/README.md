# Auto-update

How Megacubo updates itself on each platform.

| Platform | Mechanism | Code |
| --- | --- | --- |
| Windows / Linux / macOS | `electron-builder` auto-updater (downloads and applies the new build) | `www/nodejs/main.mjs` (`updatePrompt`) |
| Android | In-app APK download + verification + `PackageInstaller` intent | `android/app/src/main/java/tv/megacubo/app/AppUpdaterPlugin.java` + this folder |
| Web | Not applicable — always the latest version | — |

## Android flow

1. `renderer.js` waits for `main-ready`, then calls the native `AppUpdater.check()`
   plugin method (skipped when the `hide-updates` config is set).
2. The plugin compares the installed `versionCode` against two sources and keeps
   the newest candidate:
   - the remote manifest (`https://stats.megacubo.net/data/configure.json`, `android` object);
   - the latest GitHub release of `EdenwareApps/Megacubo` (cached for 6h, stale cache
     reused when the network fails, APK asset picked by score: `universal` > neutral > ABI-specific).
3. If a newer version exists, the renderer emits `android-update-available` to the
   Node.js main process, which shows the `NEW_VERSION_AVAILABLE` dialog
   (`WHATS_NEW` shows the release notes).
4. On accept, `downloadAndInstall()` streams the APK to
   `<externalFilesDir>/Download/megacubo-update.apk` (`progress` events are forwarded
   to the `app-update` OSD), then renames `.part` → `.apk`.
5. The APK is validated before installing: package name, SHA-256 (when published by
   the manifest), signing certificate intersection with the installed app, and a
   strictly newer `versionCode`.
6. Installation launches `ACTION_VIEW` on the `FileProvider` URI. When the
   "install unknown apps" permission is missing, `installPending()` returns
   `status: "permission"`, the user is guided to the system settings, and the
   install is retried when the app comes back to the foreground.

## Manifest schema

The `android` object of `configure.json`:

```json
{
  "android": {
    "versionName": "17.8.0",
    "url": "https://example.com/megacubo-17.8.0-universal.apk",
    "sha256": "9f2c...",
    "size": 51200000,
    "notes": "Fixes and improvements"
  }
}
```

Accepted aliases: `version` for `versionName`, `apk`/`download` for `url`,
`changelog` for `notes`. `sha256` and `size` are optional — publishing the digest
is strongly recommended, as it is the only integrity check that does not depend on
the signing certificate.

The `versionCode` is derived from the version name with the same scheme used by
`android/app/build.gradle` (`major * 10000 + minor * 100 + patch`), so both must
stay in sync.

## Testing

Install an older build, then watch the flow with:

```bash
npm run logcat
```

Useful native tags: `AppUpdater`. To force a re-check, clear the plugin data
(`adb shell pm clear tv.megacubo.app`) or wait for the 6h GitHub cache to expire.
