# Milestone 1 — Device Smoke Test Checklist

**Purpose:** when Sahil's first APK lands on a real Android phone, this is the exact list of things to verify in order. Each item is binary pass/fail; don't move forward until the current item is green.

**Hardware:** Android 8.0+ phone with ≥ 3 GB RAM (matches the brief's floor), USB cable for `adb`, the phone unlocked, USB debugging enabled in Developer Options.

**Pre-flight from the laptop (already done, summarized):**
- ✅ `npm install` (961 packages, exit 0)
- ✅ `tsc --noEmit` — 4 → 2 errors (remaining are Frame→TypedArray, the real bug)
- ✅ `npm test -- --testPathPattern=heuristics` — 25/25 pass (math is correct)
- ✅ `npx eslint src/ --fix` — 161 → 3 (all 3 are non-blocking warnings)
- ✅ pixelFormat="rgba" → "rgb" in both screens

---

## Sequence (in order — do not skip)

### Step 1 — APK boots and reaches HomeScreen
| Check | Pass criterion |
| --- | --- |
| App icon visible in launcher | The launcher icon (debug version) appears with name "NHAIBiometric" |
| Tap to launch | App opens without crashing |
| First screen shown | HomeScreen renders ("Enroll worker" + "Start Scan" buttons visible) |

**If FAILS:**
- "App not installed" → ABI mismatch or signature collision. `adb uninstall com.nhaibiometric`, reinstall.
- "App keeps stopping" → check `adb logcat | grep -i "nhaibiometric\|fatal\|crash"` for the stack trace, send to me.

### Step 2 — Camera permission flow
| Check | Pass criterion |
| --- | --- |
| Tap "Start Scan" | Camera permission dialog appears the first time |
| Grant permission | App returns to scan screen, camera preview appears |
| Camera shows live front-camera feed | Live preview visible, no black or frozen image |

**If FAILS:**
- No dialog → check `AndroidManifest.xml` has `<uses-permission android:name="android.permission.CAMERA" />` (already verified locally).
- Permission granted but preview black → vision-camera native module not linked. Try `cd android && ./gradlew clean && cd .. && npm run android` to force a clean rebuild.

### Step 3 — Model warmup completes
| Check | Pass criterion |
| --- | --- |
| Open App.tsx → splash screen visible briefly | "Loading models…" or similar visible for 1–3 seconds |
| App auto-advances to HomeScreen | After splash, HomeScreen appears |
| No model-load errors in logcat | `adb logcat | grep -i "tflite\|model"` shows no exceptions |

**If FAILS:**
- "Model not found" → `.tflite` files weren't bundled by Metro. Verify `metro.config.js` has `assetExts: [...defaultConfig.resolver.assetExts, 'tflite']` (already verified). Run `npx react-native start --reset-cache` before rebuilding.
- "Crash during warmup" → check `mobile_app/assets/models/` has all 5 files (we verified locally: 224 KB blazeface, 1.2 MB facemesh, 13 MB mobilefacenet, 2 MB adapter, 1.35 MB shufflenet).

### Step 4 — Enrollment screen renders
| Check | Pass criterion |
| --- | --- |
| Tap "Enroll worker" from HomeScreen | EnrollmentScreen renders |
| Camera preview visible | Front camera live, same as scan screen |
| "Capture frame" button visible | Tappable button on bottom of screen |
| Name input visible | TextInput for worker name |

**If FAILS:** screen-level navigation issue. Likely an import mismatch. Check `HomeScreen.tsx` correctly routes to `EnrollmentScreen`.

### Step 5 — Capture button responds (even if model output is garbage)
| Check | Pass criterion |
| --- | --- |
| Enter a name, tap "Capture" | Flash animation triggers (white flash overlay) |
| Repeat 3× | Counter shows 1/3 → 2/3 → 3/3 |
| Tap "Save" | Either navigates to success screen OR shows "Capture failed" |

**Note:** at this stage with the Frame→TypedArray bug present, the captured embedding will be garbage. **That's OK for Milestone 1.** Verify the UI flow works — the embedding quality fix is Sahil's Phase 2 work after the milestone.

**If FAILS:**
- Capture button does nothing → check `captureRequested.value = true` is firing. `adb logcat | grep -i "capture"` to see.
- "Model still loading" → wait 5 seconds longer, try again. If persistent, model warmup never completed (back to Step 3).

### Step 6 — Scan screen pipeline at least starts
| Check | Pass criterion |
| --- | --- |
| Back to HomeScreen, tap "Start Scan" | ScanScreen renders, camera preview live |
| Status card shows "Ready to Scan" | UI status correct |
| Tap "Start Scan" button | Status changes to "Positioning…" or similar |
| Stand in front of camera | Status changes to "Blink your eyes" or another challenge |

**Note:** with the Frame→TypedArray bug, the challenge prompt will appear but won't actually detect blinks (because BlazeFace + FaceMesh return garbage). **Verify the gate state machine transitions** — `IDLE → CHALLENGED` triggers regardless of model output if it's wired correctly.

**If FAILS:**
- No state transition → `gateRef.current.onFrame(...)` isn't being called from the worklet, or `landmarks` is always null. Check `onFrameUpdate` is being invoked: `adb logcat | grep -i "onFrame\|gate\|landmark"`.
- App freezes at "Positioning…" → likely the worklet itself is broken. Check the vision-camera `useFrameProcessor` is registered (look for "Frame Processor created" or similar in logcat).

### Step 7 — SQLite writes happen
| Check | Pass criterion |
| --- | --- |
| After a successful enrollment in Step 5 | A row appears in the users table |
| Verify via adb: `adb shell run-as com.nhaibiometric ls databases/` | `nhai.db` exists |
| `adb shell run-as com.nhaibiometric sqlite3 databases/nhai.db "SELECT id, name FROM users;"` | The enrolled user is listed |

**If FAILS:** SQLite isn't initialized. Check `App.tsx` calls the DB init on launch. Most likely Sahil's `database.ts` has a path issue or the schema migration didn't run.

---

## Milestone 1 PASSED criteria

Mark Milestone 1 complete when ALL of these are true:

- [x] APK installs and boots without crashing
- [x] Camera permission flow completes
- [x] HomeScreen → EnrollmentScreen → ScanScreen navigation all work
- [x] Camera preview shows on both screens
- [x] Model warmup completes (no model-load errors in logcat)
- [x] Capture button triggers flash + counter increment
- [x] Scan starts and shows a challenge prompt (even if it doesn't detect the response)
- [x] SQLite DB file exists, schema correct, can insert a row

If all 8 boxes are checked, we have Milestone 1 ✅. The remaining work (Frame→TypedArray fix for real model outputs, SQLCipher encryption, monotonic clock, sync queue) is Phase 2 — Sahil and you tackle them after this.

---

## Logcat commands you'll want

```bash
# All app logs:
adb logcat | grep -E "nhaibiometric|tflite|VisionCamera|Reanimated"

# Crashes only:
adb logcat *:E | grep -i "nhaibiometric\|fatal\|crash"

# Model loading:
adb logcat | grep -i "tflite\|model\|tensor"

# Camera:
adb logcat | grep -i "camera\|visioncamera"

# Frame processor:
adb logcat | grep -i "worklet\|frameprocessor\|reanimated"
```

If a check fails, grab the relevant logcat output and paste it to me — I'll diagnose.

---

## What we know is broken going into Milestone 1

Documented honestly so you know what to expect:

| Bug | Effect | Owner | When fixed |
| --- | --- | --- | --- |
| `Frame` passed to `runSync` instead of `TypedArray` (ScanScreen.tsx:336, 353) | Models run on zero/garbage tensors. Verification always fails. | Sahil | After Milestone 1 — Phase 2 morning of Jun 3 |
| 1 unused variable warning in ScanScreen.tsx:79 | None — cosmetic | Anyone | Jun 4 polish |
| `activeChallenge` value assigned but not displayed in UI | Probably should drive a separate UI element | Sahil | Jun 4 polish |
| SQLCipher not yet wired | Embeddings DB unencrypted | Sahil | Jun 3 afternoon |
| Monotonic clock uses `Date.now()` | Time-tamper not actually defended | Sahil | Jun 3 evening |
| Sync queue not wired | Attendance rows accumulate, never POST | Sahil | Jun 3 evening |

**Milestone 1 does NOT require any of these to be fixed.** It just requires the app to boot and the cascade structure to be wired. Real model outputs are the next milestone.
