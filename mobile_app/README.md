# Mobile App — Owner: Teammate

React Native app that runs the full biometric pipeline **on-device, offline**, using bundled `.tflite` models from [assets/models/](assets/models/).

## Stack (non-negotiable for the 20 MB / < 1 s budget)

| Concern | Library | Why |
| --- | --- | --- |
| Camera + frame processors | `react-native-vision-camera` | 60 fps JSI frame processors, the only viable RN camera for this workload |
| Inference | `react-native-fast-tflite` | NNAPI on Android, CoreML on iOS — runs `.tflite` natively, no JS bridge serialization |
| Local DB | `react-native-quick-sqlite` | C++ SQLite wrapper, fast BLOB reads for embedding matrices |
| Network detect | `@react-native-community/netinfo` | Drives the sync queue when connectivity returns |
| Encryption | SQLCipher integration | Required — encrypts the embeddings DB with a key in Keychain / Keystore |

**Do not** run inference in JavaScript. All tensor math happens in the C++ JSI frame processor.

## Cascading Gate Logic (Gate 1 — Heuristics)

The state machine prompts a randomized challenge and only progresses if Gate 1 passes, then captures one frame for Gates 2 + 3.

| Heuristic | Formula | Threshold | Purpose |
| --- | --- | --- | --- |
| EAR (Eye Aspect Ratio) | vertical eye distance / horizontal eye distance | `< 0.2` for 3 consecutive frames | Detects a blink |
| MAR (Mouth Aspect Ratio) | vertical lip opening | `> 0.5` | Detects open mouth / smile |
| PnP Yaw (Euler angle) | solvePnP against generic 3D face model | `±25°` shift | Detects head turn |

Landmarks come from **MediaPipe BlazeFace + FaceMesh** (TFLite). Heuristics are **zero-memory, deterministic** — no training data needed, only calibration.

If Gate 1 fails → drop the frame. Saves battery and prevents the NN from firing on every frame.

## Cascading Gate Logic (Gates 2 + 3 — Neural)

Only on a Gate-1-passing frame:

1. Crop face from BlazeFace box.
2. **Affine align** using eye landmarks (rotate face horizontal). Cameras emit 90°/270°-rotated buffers — use gyro/orientation sensor before tensor feed or the model returns garbage.
3. Gate 2 — `shufflenet_dummy.tflite` → `[live, spoof]` softmax. Reject if spoof > threshold.
4. Gate 3 — `mobilefacenet_dummy.tflite` → 512-D embedding.
5. Cosine distance against in-memory `[N, 512]` matrix from SQLite → matched user.

## Frame Throttling & Memory

- Camera resolution: **480p** (75 % memory cut vs 1080p; mathematically sufficient for 112×112 model input).
- Process every 3rd–4th frame (~10 fps).
- Explicitly free YUV buffers in C++ after each inference — leaked buffers crash the app within ~30 s.

## Storage & Sync

- **Schema:** `CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, embedding BLOB);` — embeddings serialized as a binary BLOB.
- **Attendance log:** local SQLite with `synced = 0` flag.
- When NetInfo detects connectivity, a background job POSTs unsynced rows to the FastAPI backend.
- On `200 OK`, `DELETE FROM attendance WHERE id = ?` purges the local record.

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
