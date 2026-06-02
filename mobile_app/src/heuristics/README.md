# Gate 1 — Heuristics

Pure-TypeScript math + state machine for the active liveness challenge layer of the cascading gates. **No native code, no `.tflite`, no training.** Just math on landmarks that FaceMesh already produces.

## Files

| File | Purpose |
| --- | --- |
| [`landmarks.ts`](landmarks.ts) | MediaPipe FaceMesh landmark indices (EAR, MAR, key reference points) + a helper to reshape FaceMesh's `[1,1,1,1404]` output into `(468, 3)` |
| [`math.ts`](math.ts) | Stateless functions: `computeEAR`, `computeMAR`, `computeYawDegrees`, `faceIsPresent`, `computeLaplacianVariance`, `frameIsSharp` |
| [`../liveness/gate.ts`](../liveness/gate.ts) | The `LivenessGate` state machine that wraps the math + handles challenges + timeouts |

## How it plugs into the camera pipeline

The mobile JSI frame processor runs this per frame (or per N-th frame depending on the throttle in `shared_contracts/thresholds.json`):

```typescript
import { useFrameProcessor } from "react-native-vision-camera";
import { useTensorflowModel } from "react-native-fast-tflite";
import { reshapeFaceMeshOutput } from "./heuristics/landmarks";
import { LivenessGate } from "./liveness/gate";

const facemesh = useTensorflowModel(require("./assets/models/facemesh.tflite"));
const gate = useRef(new LivenessGate()).current;

const onFrameProcessor = useFrameProcessor((frame) => {
  "worklet";
  // 1. Detect + crop face with BlazeFace (separate model, omitted for brevity)
  const faceCrop = cropFromBlazeFace(frame);

  // 2. Run FaceMesh on the 192x192 face crop
  const output = facemesh.runSync(faceCrop);
  const landmarksFlat = output[0];     // [1,1,1,1404] — squeeze and reshape
  const presenceLogit = output[1][0];  // [1,1,1,1] — squeeze to scalar

  const landmarks = reshapeFaceMeshOutput(landmarksFlat);

  // 3. Run the gate
  const result = gate.onFrame(landmarks, presenceLogit);

  // 4. Bridge result to the JS UI thread (use runOnJS or VisionCamera's shared values)
  runOnJS(updateUI)(result);
}, []);
```

The `result.state` will be `"IDLE"` → `"CHALLENGED"` → `"GATE_1_PASSED"` (or `"FAILED"` on timeout). Render `result.prompt` in the UI to tell the user what to do ("Blink your eyes", "Smile", etc.).

## State machine

```
                         ┌──────────────────┐
                         │   IDLE           │ ← no face detected
                         └────────┬─────────┘
                                  │ face appears (presence > 0.5)
                                  ▼
                         ┌──────────────────┐
                         │   CHALLENGED     │ ← random prompt active
                         └────────┬─────────┘
                                  │ user completes challenge
                                  │ (blink ≥ 3 frames OR smile OR yaw ±25°)
                                  ▼
                         ┌──────────────────┐
                         │   GATE_1_PASSED  │ → run Gate 2 (ShuffleNet liveness)
                         └──────────────────┘
                                  │ timeout (default 8 s)
                                  ▼
                         ┌──────────────────┐
                         │   FAILED         │ → show retry UI
                         └──────────────────┘
```

## Thresholds (from `shared_contracts/thresholds.json`)

| Metric | Threshold | Notes |
| --- | --- | --- |
| EAR | `< 0.2` for `≥ 3` consecutive frames | Blink |
| MAR | `> 0.5` | Smile / open mouth |
| Yaw | `\|degrees\| > 25` | Head turn |
| Face presence | sigmoid logit prob `> 0.5` | Reject frames where no face is detected |
| Challenge timeout | 8 seconds | If user doesn't complete in time → `FAILED` |

These defaults are baked into `gate.ts` but the constructor takes a `GateThresholds` object so you can override at runtime from `shared_contracts/thresholds.json`.

## Why this design

- **No native code:** the math is light enough that pure TS in a VisionCamera worklet runs comfortably at 30 fps on a 3-year-old mid-range Android.
- **No OpenCV dependency:** we use a simplified `Math.log2(ratio) * 30` yaw estimator instead of `cv2.solvePnP`. Less accurate but accuracy-vs-effort is the right trade for the hackathon timeline. The brief allows ±25° tolerance — this estimator hits it.
- **Stateless math, stateful gate:** keeps the math functions unit-testable (give them 6 points, get a number back) while the state machine handles per-session logic.

## Fallback behaviour

- **Sunglasses (or any case where EAR is unreliable):** call `gate.excludeBlinkChallenge()` once. The gate stops issuing blink prompts and picks from `SMILE` / `TURN_LEFT` / `TURN_RIGHT` only.
- **Low light:** before running FaceMesh, the JSI processor should detect low ambient brightness (e.g. mean grayscale < 30) and crank the screen brightness to 100% + paint UI white as a ring light. The gate doesn't need to know.
- **NPU failure:** unrelated to Gate 1 — the TFLite loader falls back to CPU and the gate keeps working.

## What's still your responsibility

This is the gate logic only. You still need:

1. **BlazeFace face detection + face crop extraction** before FaceMesh runs (separate TFLite, separate logic).
2. **The JSI processor itself** wired to `react-native-vision-camera`'s `useFrameProcessor`.
3. **The UI** that renders `result.prompt` to the user.
4. **The downstream gates** — once `GATE_1_PASSED`, run ShuffleNet liveness (Gate 2), then MobileFaceNet identity (Gate 3 via composed pipeline: mobilefacenet.tflite → mobilefacenet_adapter.tflite → L2-normalize → cosine distance vs SQLite-stored template).
