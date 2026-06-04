# Known issues + how to handle them

Read this before debugging anything. Most of "weird behavior" on this project has a known cause.

---

## 🚨 KNOWN BUG: pixelFormat / frameUtils stride mismatch

**Read this before anything else.** This is latent in `main` as of `ed20a94` and **will silently make every preprocessed tensor garbage.** Symptom: app boots, camera shows live, gates never fire, "Positioning…" forever.

**The clash:**

- Commit `d404521` changed `pixelFormat="rgba"` → `"rgb"` in [mobile_app/src/screens/EnrollmentScreen.tsx:252](../mobile_app/src/screens/EnrollmentScreen.tsx#L252) and [mobile_app/src/screens/ScanScreen.tsx:461](../mobile_app/src/screens/ScanScreen.tsx#L461). The camera now outputs **3 bytes/pixel** (RGB).
- Sahil's [mobile_app/src/utils/frameUtils.ts](../mobile_app/src/utils/frameUtils.ts) — written for `91cf8dc` — has `resizeRgbaToModelInput()` that reads `src[srcIdx + 0/1/2]` with a **4-byte stride** (`srcIdx = (srcY * srcW + srcX) * 4`). Function header explicitly says *"Camera must have pixelFormat='rgba' set so the buffer is row-major RGBA."*
- Result: the helper reads R from byte 0, G from byte 1, B from byte 2 — **but advances 4 bytes per pixel through a 3-byte-per-pixel buffer.** Every pixel after the first reads from the wrong offset. Output tensor is structured noise. BlazeFace + FaceMesh + ShuffleNet + MobileFaceNet all see garbage.

**Why TS doesn't catch it:** the function takes an `ArrayBuffer | Uint8Array`. Both buffer formats type-check. The stride is a runtime assumption baked into the math, not the types.

**Fix (recommended — change frameUtils, not pixelFormat):**

In [mobile_app/src/utils/frameUtils.ts](../mobile_app/src/utils/frameUtils.ts):

```typescript
// OLD (4-byte stride):
const srcIdx = (srcY * srcW + srcX) * 4; // RGBA — 4 bytes/pixel

// NEW (3-byte stride):
const srcIdx = (srcY * srcW + srcX) * 3; // RGB — 3 bytes/pixel
```

Also rename the function `resizeRgbaToModelInput` → `resizeRgbToModelInput` and update the header comment + the two call sites in `ScanScreen.tsx` (~lines 163 and 182).

**Why this direction, not the reverse:**

Reverting `pixelFormat` back to `"rgba"` would re-introduce the original TS errors on `EnrollmentScreen.tsx:252` and `ScanScreen.tsx:461` — vision-camera 4.x dropped the `"rgba"` enum value. Keeping `"rgb"` matches the supported API; the helper just needs to read 3-byte stride.

**Verify after the fix:**

1. `npx tsc --noEmit` — no new errors
2. Install on phone — Gate 0 (BlazeFace) should fire a face box on a real face; gates should advance through challenge → verify
3. Sanity check: `adb logcat | grep -i "face\|gate"` — see real detection events, not just timeouts

If gates still don't fire after this fix, the next likely culprit is `frame.toArrayBuffer()` returning a YUV buffer instead of RGB — vision-camera's pixel format setting may not actually convert internally. In that case, the conversion has to happen explicitly via a vision-camera frame processor plugin.

---

## TypeScript errors

Last known state (Jun 2 evening): 4 errors → 2 after the pixelFormat fix.

| Location | Error | Status / fix |
| --- | --- | --- |
| `src/screens/EnrollmentScreen.tsx:252` | ~~`pixelFormat="rgba"` not assignable~~ | **Fixed** — changed to `"rgb"` in commit `d404521` |
| `src/screens/ScanScreen.tsx:461` | ~~Same pixelFormat error~~ | **Fixed** — commit `d404521` |
| `src/screens/ScanScreen.tsx:302` | `Frame` not assignable to `TypedArray` | **Open.** Likely needs `frame.toArrayBuffer()` or proper preprocessing before feeding to TFLite. Vision-camera 4.x changed the frame processor API. |
| `src/screens/ScanScreen.tsx:319` | Same as 302 | **Open.** Same fix. |

If the Phase 2 wiring diff in [communication/note_phase2_wiring.md](../communication/note_phase2_wiring.md) was applied properly, these may already be resolved — the new helpers expect `Float32Array` and the wiring should include the YUV→tensor conversion. Verify with `npx tsc --noEmit` before touching anything.

**Even if these 2 errors persist, the app may still build.** RN often runs through TS warnings. They're cleanliness blockers, not build blockers.

---

## The wiring diff may or may not be applied

Three independent checks (any "no" means it isn't applied):

1. `grep -n "unpackFaceMeshOutput" mobile_app/src/screens/ScanScreen.tsx` — should match
2. `grep -n "computeComposedEmbedding" mobile_app/src/screens/ScanScreen.tsx` — should match
3. `grep -n "gateRef.current.onFrame" mobile_app/src/screens/ScanScreen.tsx` — should match with non-stub args

If any are missing, apply the diff from [communication/note_phase2_wiring.md](../communication/note_phase2_wiring.md) before doing **any** device testing — the gate will fall back to stubs and Gate 1 will pass forever, which masks downstream bugs.

---

## Models loaded "on zero tensors" — the symptom to recognize

If the app boots and the camera shows live, but no challenges fire and the gate state never advances, the symptom is usually:

- BlazeFace + FaceMesh are being called with **a Frame, not a tensor**
- They return random / null output
- The gate sees `faceLikelihood < 0.5` every frame and bails
- The UI sits at "Positioning…" forever

Fix: the YUV → RGB → resize → normalize step in the frame processor. Vision-camera's frame processor docs cover this. If `unpackFaceMeshOutput` is in place but landmarks are still garbage, the upstream tensor conversion is the bug.

---

## ML side stuff that's "weird but correct"

- **`mobilefacenet_adapter.tflite` outputs adapted 512-D, not the raw backbone output.** The composed-embedding helper handles this — don't bypass it.
- **Cosine distance threshold is 0.8616, not similarity.** Match if `distance < threshold`. Embeddings MUST be L2-normalised first. The helper does it. Don't roll your own.
- **The threshold was calibrated on Bollywood Faces val split (5k pos + 5k neg pairs).** If matches don't work on you and Malay tonight, it's not necessarily the threshold — it's likely the preprocessing pipeline. Don't retune the threshold without Malay's sign-off; it's frozen in `shared_contracts/thresholds.json`.

---

## Kaggle downloads + model artifacts

[kaggle_downloads/](../kaggle_downloads/) is gitignored (as of commit `760d94b` — the inline-comment .gitignore bug). **Do not commit anything from there.** Don't even `git add` it; the kaggle outputs are ~70 MB of stuff that shouldn't be in main.

Similarly: `*.pth`, `*.pt`, `*.h5`, `*.ckpt`, `*.onnx` are gitignored. Only the final `.tflite` files in [mobile_app/assets/models/](../mobile_app/assets/models/) belong in git.

---

## Mock backend state

[mock_backend/state.json](../mock_backend/state.json) is gitignored. The backend creates it on first POST. If demo enrollments need to persist across a backend restart, use `mock_backend/sample_data.json` as a seed by copying it to `state.json` before starting uvicorn — there's a note in the mock_backend README.

`DELETE /_admin/wipe` is the safe way to start clean between demo runs.

---

## "It worked on my machine"

If the app behaves differently on Malay's old build vs Sahil's current build:

1. `git pull && git log --oneline -5` — confirm both on the same HEAD
2. `cd mobile_app && rm -rf node_modules && npm install` — node_modules drift is real
3. `cd mobile_app/android && ./gradlew clean && cd ..` — gradle caches survive too long
4. `adb uninstall com.nhaibiometric` — old install with old models can mix

If still divergent after those four steps, it's a real bug — log it and ask.

---

## What NOT to debug

Time sinks that don't move the demo score:

- iOS issues. We're submitting Android-only. The iOS scaffold is for show; pod install is a Jun 5+ concern.
- Native C++ ports. The JS impl of Laplacian / cosine / PnP is fast enough for the demo. See [note_phase2_wiring.md](../communication/note_phase2_wiring.md) tail for the "skipped on purpose" list.
- Re-training any model. The threshold is calibrated. If you think the model is bad, the answer is "fine-tune in production after a 6-month pilot" — that's literally the production-roadmap slide.
- 3D mask attacks. Not in scope, not in the threat model. Brief doesn't require them.
