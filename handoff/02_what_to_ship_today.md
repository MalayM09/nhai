# What to ship today

Ordered. Don't skip. Each step has a **DONE =** definition — don't move on until that's met.

The clock: **Jun 3 ~14:00 → Jun 4 ~20:00 submission**. That's roughly 30 hours. Sleep is in there. So is filming, which can't happen before the app is green.

---

## Step 1 — Sync the laptop (15 min)

```bash
cd ~/Desktop/nhai   # or wherever Sahil keeps the repo
git pull origin main
cd mobile_app && npm install --no-audit --no-fund
```

**DONE =** `npm install` exits 0; `git log --oneline -3` shows our handoff commit at HEAD.

---

## Step 2 — Type check + tests (10 min)

```bash
cd mobile_app
npx tsc --noEmit
npm test -- --testPathPattern=heuristics
```

**DONE =** `tsc` shows ≤ 2 errors and all are known (see [04_known_issues.md](04_known_issues.md)); tests are 25/25.

If `tsc` shows new errors, fix before moving on. If tests fail, **stop and ask Malay** — the math is shared with the calibration in `shared_contracts/thresholds.json` and silent regressions invalidate the threshold.

---

## Step 2.5 — Fix the pixelFormat / frameUtils stride bug (15 min)

**This is a real latent bug**, not a theoretical concern. See the 🚨 section at the top of [04_known_issues.md](04_known_issues.md) for the full diagnosis.

In one sentence: the camera was switched to `pixelFormat="rgb"` (3 bytes/pixel), but `frameUtils.resizeRgbaToModelInput` still reads with a 4-byte stride — so every preprocessed tensor is structured noise. The fix is the 1-character change `* 4` → `* 3` in [mobile_app/src/utils/frameUtils.ts](../mobile_app/src/utils/frameUtils.ts), plus renaming the function and updating the two call sites in `ScanScreen.tsx`.

**DONE =** the stride is 3, the function name is `resizeRgbToModelInput`, both call sites updated, `npx tsc --noEmit` no worse than before.

---

## Step 3 — Phase 2 wiring (mostly already done — verify only) (10 min)

Re-checked Jun 4: Sahil's `91cf8dc` already wired equivalents of the Phase 2 helpers, just via different names. Specifically [ScanScreen.tsx](../mobile_app/src/screens/ScanScreen.tsx) already:

- Reshapes FaceMesh output via `reshapeFaceMeshOutput(rawLandmarks.slice(0, 1404))` at line ~250 — functionally same as `unpackFaceMeshOutput`, just without the `faceLikelihood` early-bail
- Runs `gateRef.current.onFrame(landmarks, presenceLogit)` at line ~253 ✅
- Composes backbone → adapter → `l2Normalize` manually at lines ~190–196 — functionally identical to `computeComposedEmbedding`
- Calls `findBestMatch` with `MATCH_THRESHOLD_VALUE` (= 0.8616) ✅

**Do not swap to Malay's helpers** — it would be a pure refactor with no behavioural change, and refactoring working code on demo day is the wrong instinct.

**DONE =** `grep -n "reshapeFaceMeshOutput\|gateRef.current.onFrame\|findBestMatch" mobile_app/src/screens/ScanScreen.tsx` returns matches.

---

## Step 4 — Build APK and install on Sahil's phone (45 min)

Phone prep: USB debugging on, screen unlocked, USB cable in.

```bash
adb devices                                # confirm phone shows up
cd mobile_app
npx react-native run-android
```

First build takes 5–10 minutes. If anything fails, see [03_how_to_run.md](03_how_to_run.md) § "Android build troubleshooting".

**DONE =** the app icon appears in the launcher and tapping it shows HomeScreen.

---

## Step 5 — Run the Milestone 1 device checklist (45 min)

Follow [communication/note_milestone1_device_test.md](../communication/note_milestone1_device_test.md) **step by step**. Each step has a pass criterion. Don't skip ahead.

Steps to clear:
1. APK boots and reaches HomeScreen ✅ (from Step 4)
2. Camera permission flow
3. Model warmup completes
4. EnrollmentScreen renders
5. Capture button responds
6. ScanScreen pipeline at least starts
7. SQLite writes happen

**DONE =** all 7 steps pass. If a step fails, the checklist tells you where to look.

---

## Step 6 — Happy path end-to-end (30 min)

Manually:

1. Enroll a worker (use Sahil's face, name = "Sahil"). Capture 3 shots.
2. Go to ScanScreen. Tap "Start Scan".
3. Blink when prompted.
4. Verify: green tick + "Sahil" appears within ~1 second.

If verification fails (no match) — most likely the embedding extraction is on a non-normalized or wrongly-preprocessed face. Check that the face crop fed to the backbone is 112×112×3, normalised to `[-1, 1]`, and L2-normalised before cosine. The composed-embedding helper does the L2 step itself.

**DONE =** at least one enroll → scan → verified cycle succeeds. Record the actual latency you see (eyeball it via timestamps in logcat — formal benchmark comes Jun 4).

---

## Step 7 — Wire the mock backend (90 min)

Start the backend on the laptop:

```bash
cd mock_backend
source .venv/bin/activate || (python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt)
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Find the laptop's LAN IP (`ifconfig | grep "inet "` → look for `192.168.x.x` or `10.x.x.x`).

In the mobile app, add (or verify) a sync module that:
- Hits `POST http://<laptop-ip>:8000/attendance` for each row from `getUnsyncedAttendance()`
- On 200 OK, calls `purgeAttendance(id)`
- Hits `POST http://<laptop-ip>:8000/enrollment` for each unsynced enrollment

Don't bother with NetInfo for now — just a manual "Sync now" button on HomeScreen, or a `setInterval` polling every 10 s. Brief grades the **mechanism**, not the trigger sophistication.

**DONE =** enroll on phone → manual sync → row appears in `GET http://localhost:8000/enrollments` on laptop. Attendance: scan→verify on phone → sync → row appears in `GET /attendance` AND the local SQLite row is gone (verify via `adb shell run-as com.nhaibiometric sqlite3 databases/nhai.db "SELECT * FROM attendance;"` returns empty).

---

## Step 8 — Add `[BENCH]` markers for the benchmark script (45 min)

The benchmark script ([tools/benchmark/README.md](../tools/benchmark/README.md)) expects logcat lines like:

```
[BENCH] gate0_blazeface_ms=8.2
[BENCH] gate1_facemesh_ms=12.4
[BENCH] gate2_shufflenet_ms=6.5
[BENCH] gate3_backbone_ms=38.2
[BENCH] gate3_adapter_ms=1.8
[BENCH] gate3_match_ms=0.4
[BENCH] total_end_to_end_ms=75.6
```

The README has copy-paste code blocks showing exactly where to add the `console.log` calls inside the frame processor and `runDetectionOnFrame`. ~10 LOC total.

**DONE =** `adb logcat | grep "\[BENCH\]"` shows these lines firing while the app runs.

---

## Step 9 — Stretch goals if Step 8 done before 21:00 Jun 3

In priority order, only do what you have time for:

| Stretch | Effort | Value |
| --- | --- | --- |
| SQLCipher swap on the SQLite `open()` call | 30 min | Marked in the brief's "data security" rubric |
| Monotonic clock timestamp on attendance rows | 30 min | Anti-tamper, mentioned in brief |
| NetInfo-driven sync (vs the manual button) | 60 min | Nice to have, not critical |
| Pre-seed 2-3 demo enrollments via mock backend | 15 min | Makes the demo smoother |

**Skip:** any C++ native ports (see Malay's reasoning in [note_phase2_wiring.md](../communication/note_phase2_wiring.md) tail).

---

## Step 10 — Hard stop, sleep (22:30 Jun 3)

You will not write good code at 02:00. The Jun 4 plan in [05_demo_and_submission.md](05_demo_and_submission.md) needs you alert. Stop, charge phone + laptop, sleep.
