# Phase 1 Mobile Scaffold — Status Note

**Date:** 2026-05-31  
**Author:** Teammate (Mobile)

---

## What Works (Fully Implemented)

### Project Scaffold
- React Native 0.74.5 TypeScript project initialised inside `mobile_app/`.
- All native directories (`android/`, `ios/`) present with correct package name `com.nhaibiometric`.
- All four mandatory libraries added to `package.json` and installed:
  - `react-native-vision-camera ^4.5.1`
  - `react-native-fast-tflite ^1.1.0`
  - `react-native-quick-sqlite ^8.0.5`
  - `@react-native-community/netinfo ^11.3.1`
  - `react-native-reanimated ^3.10.1` (required peer dep for vision-camera worklets)

### Permissions
- **Android:** `CAMERA` permission + `uses-feature` in `AndroidManifest.xml`.
- **iOS:** `NSCameraUsageDescription` in `Info.plist`.

### Thresholds (`src/constants/thresholds.ts`)
All values mirrored from `shared_contracts/thresholds.json`. Single source of truth enforced — never hardcoded in component code.

### Embedding Utilities (`src/utils/embeddingUtils.ts`)
- `l2Normalize(embedding)` — in-place.
- `cosineDistance(a, b)` — uses **distance**, not similarity. Range [0, 2]. Match if `< 0.40`. The old 0.8 placeholder is gone.
- `l2AverageEmbeddings(embeddings[])` — centroid for multi-shot enrollment.
- `findBestMatch(liveEmbedding, storedEmbeddings, threshold)` — scans all stored users.

### Gate Heuristics (`src/utils/gateHeuristics.ts`)
- **Laplacian variance quality gate** — fully implemented in JS (3×3 kernel, row-major pixel array). Rejects frames with `var(Laplacian) < 60` before they reach Gates 2/3.
- **EAR (eye blink)** — formula implemented with `EarState` consecutive-frame tracker. Stub: landmarks default to 0.3 (open) until FaceMesh wired in Phase 2.
- **MAR (mouth/smile)** — formula implemented. Stub: defaults to 0.3 until FaceMesh wired.
- **PnP Yaw** — stub returns 0 with clear TODO. Real `solvePnP` goes in C++ JSI plugin in Phase 2.
- **`runGate1()`** — orchestrator that runs quality check first, then challenge-specific check.

### SQLite Database (`src/db/database.ts`)
- Schema **exactly** matches `shared_contracts/README.md`:
  - `users(id, name, embedding BLOB, enrollment_shots, enrollment_quality)` — new columns present.
  - `attendance(id, user_id, timestamp_wall, timestamp_monotonic, synced)` — dual timestamps for anti-tamper.
- CRUD: `upsertUser`, `loadAllUsers`, `logAttendance`, `getUnsyncedAttendance`, `markSynced`, `purgeAttendance`.
- **SQLCipher TODO clearly marked** — Phase 2 replaces `open({ name })` with encrypted open using Keychain/Keystore key.

### App Root (`App.tsx`)
- **Model warmup on splash** — loads all three `.tflite` models via `useTensorflowModel`, waits for `state === 'loaded'` on all three, then fires one dummy forward pass per model (correct input shapes). Only after warmup completes does `ScanScreen` render.
- DB initialised on launch (idempotent `CREATE TABLE IF NOT EXISTS`).

### ScanScreen (`src/screens/ScanScreen.tsx`)
- Front camera at 480p (correct resolution per contract).
- **Adaptive frame throttling** — timestamp-based, not frame-count-based:
  - `~10 fps` idle → `~30 fps` when `challengeActive` shared value is true.
  - Shared value crosses the JS/worklet boundary via Reanimated.
  - No static frame skipping — blink frames won't be dropped.
- Cascading gate pipeline wired: Gate 0 (BlazeFace) → Gate 1 (heuristics) → Gate 2 (ShuffleNet) → Gate 3 (MobileFaceNet) → cosine distance matching.
- State machine: `ready → challenge → detecting → verified / failed`.
- Status card UI: corporate minimal, muted palette, no heavy animations.
- Camera permission flow with Settings deep-link fallback.
- Low-light fallback (TODO in Phase 2 — screen brightness + white background).

### Metro / Babel / Android/iOS Config
- `metro.config.js` — `.tflite` added to `assetExts`.
- `babel.config.js` — `react-native-reanimated/plugin` added (required last).
- Android `minSdk` raised to 26 (Android 8.0, our stated floor).
- iOS deployment target set to 12.0 in Podfile `post_install`.
- `.tflite` dummy files copied to `android/app/src/main/assets/`.

### TypeScript
`tsc --noEmit` passes with **zero errors**.

---

## What Is Stubbed / Deferred

| Item | Status | Phase |
| --- | --- | --- |
| Real FaceMesh landmark extraction | Stub — EAR/MAR return open/closed defaults | 2 |
| PnP solvePnP (head pose) | Stub — always returns 0 yaw | 2 |
| YUV→tensor conversion in C++ JSI | Stub — model runs on zero tensors | 2 |
| Laplacian variance in C++ (speed) | JS impl works but is slow; move to native | 2 |
| Cosine matching in C++ | JS impl correct; move to native for speed | 2 |
| SQLCipher encryption | Unencrypted in Phase 1; clear TODO in code | 2 |
| Monotonic clock for attendance | Uses `Date.now()` as placeholder | 2 |
| NetInfo sync queue to FastAPI backend | Not wired — `getUnsyncedAttendance()` exists | 2 |
| Moiré / FFT screen-replay heuristic | Optional Phase 3+ (not on critical path) | 3+ |
| Multi-shot enrollment screen | DB layer ready; UI not built | 2 |

---

## What Blocks Phase 2

1. **Pod install must run** (`cd ios && bundle exec pod install`) before the iOS build works. This machine doesn't have CocoaPods available via the sandbox.
2. **Android build** — standard Gradle build should work once a connected device/emulator is available. NNAPI delegate wiring for `react-native-fast-tflite` needs testing on a real device.
3. **Real FaceMesh landmarks** — needed to make EAR/MAR/PnP pass real values. This unblocks Gate 1 producing actual gating behaviour (currently Gate 1 always fails the stub frame).
4. **Trained `.tflite` models from ML pipeline** — drop in place of the `_dummy` files with the same filenames. No app code changes needed.

---

## Contract Compliance

- Cosine **distance** used throughout (not similarity). Match if `< 0.40`. ✓
- Model I/O shapes match `shared_contracts/README.md` in all inference calls. ✓
- `users` table has `enrollment_shots` and `enrollment_quality` columns. ✓
- `attendance` table has both `timestamp_wall` and `timestamp_monotonic`. ✓
- No tensor shapes or thresholds modified without going through shared_contracts. ✓
