# How to run everything

Quick reference. All paths assume CWD = repo root unless noted.

---

## Mobile app

```bash
# install deps (first time, or after a pull that touched package.json)
cd mobile_app
npm install --no-audit --no-fund

# type check
npx tsc --noEmit

# unit tests (heuristics math only — these matter, the rest aren't wired)
npm test -- --testPathPattern=heuristics

# lint (auto-fix)
npx eslint src/ --fix

# start Metro bundler (separate terminal)
npx react-native start

# build + install Android APK on connected phone
npx react-native run-android

# tail device logs
adb logcat | grep -iE "nhaibiometric|reactnative|tflite|\[BENCH\]"

# inspect the on-device SQLite db
adb shell run-as com.nhaibiometric sqlite3 databases/nhai.db ".tables"
adb shell run-as com.nhaibiometric sqlite3 databases/nhai.db "SELECT id, name FROM users;"
adb shell run-as com.nhaibiometric sqlite3 databases/nhai.db "SELECT * FROM attendance;"

# uninstall (when in doubt, nuke and reinstall)
adb uninstall com.nhaibiometric
```

### Android build troubleshooting

| Symptom | Try |
| --- | --- |
| `SDK location not found` | Set `ANDROID_HOME` env var, or create `mobile_app/android/local.properties` with `sdk.dir=/Users/<you>/Library/Android/sdk` |
| Gradle daemon hang | `cd mobile_app/android && ./gradlew --stop && cd ..` then rebuild |
| `Could not find <package>` after a `git pull` | `rm -rf node_modules && npm install` |
| Metro cache acting up | `npx react-native start --reset-cache` |
| `.tflite` files missing in APK | Verify `mobile_app/metro.config.js` has `assetExts` including `'tflite'` (already done — don't break it) |
| Worklet errors at runtime | Vision-camera worklet plugins must be registered; check `babel.config.js` includes `react-native-reanimated/plugin` LAST |
| App installs but crashes immediately | `adb logcat \*:E` and look for the first FATAL — usually a missing model or a native-module link issue |

---

## Mock sync backend

```bash
cd mock_backend

# first run only
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# every run
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

`--host 0.0.0.0` is **critical** — without it the phone on the same WiFi cannot reach the laptop.

```bash
# find the laptop's LAN IP — use this IP from the phone, NOT 127.0.0.1 or localhost
ifconfig | grep "inet " | grep -v 127.0.0.1
# example output: inet 192.168.1.42 netmask ...
# so the mobile app should hit http://192.168.1.42:8000/...
```

Quick endpoint tests from the laptop:

```bash
# health
curl http://localhost:8000/health

# list received attendance
curl http://localhost:8000/attendance | python -m json.tool

# list received enrollments
curl http://localhost:8000/enrollments | python -m json.tool

# wipe between demo runs
curl -X DELETE http://localhost:8000/_admin/wipe

# swagger UI in the browser
open http://localhost:8000/docs
```

---

## Benchmark script

Prereq: app installed on phone via `npx react-native run-android` (Step 4 of `02_what_to_ship_today.md`), `[BENCH]` markers present (Step 8).

```bash
# from repo root
python tools/benchmark/benchmark.py

# specific device
python tools/benchmark/benchmark.py --device emulator-5554

# more cold-start samples
python tools/benchmark/benchmark.py --runs 20

# skip cascade tail (just APK + cold start + memory)
python tools/benchmark/benchmark.py --skip-cascade

# longer logcat window (default 120 s) — give yourself time to actually run scans
python tools/benchmark/benchmark.py --logcat-seconds 300
```

Output goes to `docs/benchmarks/benchmark_<timestamp>.json` + `.md`. Commit the latest run — that's the one we cite in the deck.

---

## Filming the demo clip

See [docs/demo_video_storyboard.md](../docs/demo_video_storyboard.md). Pre-shoot checklist, 3-scene beat tables, voice-over scripts, fallback plan.

Quick reminders:

- Phone in **airplane mode** — visible in the status bar throughout the clip
- Use a **second phone or laptop webcam** to film. Don't try to use the demo phone's selfie video while it's running the app.
- For Scene 3 (screen replay) you need a second phone loop-playing a video of the enrolled user blinking. Max brightness on the replay phone.

---

## Submission ZIP

Final step on Jun 4 evening. See [05_demo_and_submission.md](05_demo_and_submission.md) § "Final ZIP" for the exact bundle.
