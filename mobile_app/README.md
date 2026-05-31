# Mobile App — Owner: Teammate

React Native app that runs the full biometric pipeline **on-device, offline**, using bundled `.tflite` models from [assets/models/](assets/models/).

## Stack (non-negotiable for the < 1 s budget)

| Concern | Library | Why |
| --- | --- | --- |
| Camera + frame processors | `react-native-vision-camera` | 60 fps JSI frame processors, the only viable RN camera for this workload |
| Inference | `react-native-fast-tflite` | NNAPI on Android, CoreML on iOS — runs `.tflite` natively, no JS bridge serialization |
| Local DB | `react-native-quick-sqlite` | C++ SQLite wrapper, fast BLOB reads for embedding matrices |
| Network detect | `@react-native-community/netinfo` | Drives the sync queue when connectivity returns |
| Encryption | SQLCipher integration | Required — encrypts the embeddings DB with a key in Keychain / Keystore |

**Do not** run inference in JavaScript. All tensor math happens in the C++ JSI frame processor.

> **Size note:** the 20 MB budget is for **bundled `.tflite` models**, not the app binary. Models project to ~6.75 MB so there's slack. App-bundle size is still worth optimizing (selective TFLite ops, Hermes, Proguard) but it isn't gated by the hackathon's 20 MB number.

## Cascading Gate Logic (Gate 1 — Heuristics)

The state machine prompts a randomized challenge and only progresses if Gate 1 passes, then captures one frame for Gates 2 + 3.

| Heuristic | Formula | Threshold | Purpose |
| --- | --- | --- | --- |
| EAR (Eye Aspect Ratio) | vertical eye distance / horizontal eye distance | `< 0.2` for 3 consecutive frames | Detects a blink |
| MAR (Mouth Aspect Ratio) | vertical lip opening | `> 0.5` | Detects open mouth / smile |
| PnP Yaw (Euler angle) | solvePnP against generic 3D face model | `±25°` shift | Detects head turn |
| **Laplacian variance** (frame quality) | `var(Laplacian(grayscale(face_crop)))` | `≥ 60` | **Reject blurry frames before they reach the embedding model.** Free, prevents poisoning the matched template. |

Landmarks come from **MediaPipe BlazeFace + FaceMesh** (TFLite). Heuristics are **zero-memory, deterministic** — no training data needed, only calibration.

If Gate 1 fails → drop the frame. Saves battery and prevents the NN from firing on every frame.

## Cascading Gate Logic (Gates 2 + 3 — Neural)

Only on a Gate-1-passing frame:

1. Crop face from BlazeFace box.
2. **Affine align** using eye landmarks (rotate face horizontal). Cameras emit 90°/270°-rotated buffers — use gyro/orientation sensor before tensor feed or the model returns garbage.
3. Gate 2 — `shufflenet_dummy.tflite` → `[live, spoof]` softmax. Reject if `spoof > liveness_spoof_reject_prob` (0.5 in thresholds.json).
4. Gate 3 — `mobilefacenet_dummy.tflite` → 512-D embedding → **L2-normalize**.
5. **Cosine distance** against the in-memory `[N, 512]` matrix from SQLite. Match if `cosine_distance < match_threshold_value` (0.40 placeholder).

> **Match semantics are fixed: cosine *distance*, not similarity.** Lower = more similar. Range `[0, 2]`. See [../shared_contracts/README.md](../shared_contracts/README.md).

## Optional Phase 3+: Moiré / screen-replay heuristic

Single-frame passive liveness (ShuffleNet) catches print attacks but is weak against high-quality phone-screen replays. Cheap counter:

- Run a 2D FFT on the aligned face crop.
- Measure energy in the high-frequency band (≥ 60 Hz spatial cycles).
- Phone screens leak periodic moiré patterns; real faces do not.
- Reject if FFT high-freq energy exceeds an empirical baseline (calibrate against your own devices).

Stretch goal — costs ~5 ms per frame and dramatically hardens the demo against a "hold a phone up to the camera" attack.

## Adaptive Frame Throttling

Static frame skipping breaks blink detection — at 10 fps you might drop the one frame where the eyes are closed. Use state-aware throttling instead:

| State | Target rate | Source field |
| --- | --- | --- |
| Idle (no face, or waiting for prompt) | ~10 fps | `throttle_idle_fps` |
| Active challenge (prompt is live, e.g. "Blink", "Look left") | ~30 fps | `throttle_active_challenge_fps` |

The frame processor flips its internal modulus based on the state machine.

## Model warmup on splash

Run one **dummy forward pass per `.tflite` model** during splash / first render. TFLite delegate (NNAPI / CoreML) initialization is lazy — the first real inference is 2–3× steady-state. The user-facing scan must never be the cold one. `warmup_on_splash` in thresholds.json is the contract flag.

## Memory

- Camera resolution: **480p** (75 % memory cut vs 1080p; mathematically sufficient for 112×112 model input).
- Explicitly free YUV buffers in C++ after each inference — leaked buffers crash the app within ~30 s.

## Storage & Sync

- **Schema:** see [../shared_contracts/README.md](../shared_contracts/README.md). The stored embedding is the **L2-normalized centroid** of multiple enrollment shots, not a single-shot embedding.
- **Attendance log:** local SQLite with `synced = 0` flag.
- When NetInfo detects connectivity, a background job POSTs unsynced rows to the FastAPI backend.
- On `200 OK`, `DELETE FROM attendance WHERE id = ?` purges the local record.

## Enrollment flow (multi-shot)

A single enrollment shot is fragile. The enrollment screen must:

1. Capture **3–5 frames** while prompting the user to slightly vary pose ("Look straight" → "Slightly left" → "Slightly right").
2. Each frame must independently pass Gate 1 (incl. Laplacian variance ≥ 60).
3. Run each through BlazeFace → align → MobileFaceNet → 3–5 raw embeddings.
4. **L2-average** and re-normalize → store the centroid as the user's template.
5. Persist `enrollment_shots` and `enrollment_quality` (mean Laplacian variance) into the `users` row.

Doubles real-world accuracy vs single-shot enrollment with zero model change.

## Fallbacks (must ship)

- **Low light:** screen brightness → 100 %, paint UI white as a ring light.
- **Sunglasses / no blink:** state machine times out and switches prompt to "Turn your head left."
- **NPU init failure:** catch and fall back to CPU execution with reduced thread count (avoid thermal throttling).

## Anti-Spoof Extras

- SQLCipher encryption of the embeddings DB (key in Keychain / Keystore).
- Monotonic clock check — track `uptime`, not wall-clock, to detect OS time tampering offline.

## UI Aesthetic

Corporate, minimal. Clean typography, muted palette, ample whitespace. No heavy animations. Status cards: "Ready to Scan" → "Look Left" → "Verified".

## Models In This Folder

The `.tflite` files in [assets/models/](assets/models/) right now are **structurally valid dummies** with random weights — they exist so the JSI bridge and tensor plumbing can be built today. Shapes are frozen and match [../shared_contracts/](../shared_contracts/). The ML team swaps them for trained versions in place — no app code changes needed.
