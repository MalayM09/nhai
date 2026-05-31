# Bundled Models

These `.tflite` files are loaded by `react-native-fast-tflite` at app startup. They must be present at build time — Android bundles them via `android/app/src/main/assets/`, iOS via the Xcode asset catalog.

## Current Files (Phase 1 shipped, 2026-05-31)

| File | Input | Output | Source | Status |
| --- | --- | --- | --- | --- |
| `blazeface.tflite` | `[1,128,128,3]` f32 (normalized to `[-1, 1]`) | boxes `[1,896,16]`, scores `[1,896,1]` | MediaPipe `face_detection_short_range.tflite`, pretrained | **Real** (pretrained, no fine-tune) |
| `facemesh.tflite` | `[1,192,192,3]` f32 (normalized to `[0, 1]`) | landmarks `[1,1,1,1404]` (squeeze → `(468, 3)`), presence `[1,1,1,1]` | MediaPipe `face_landmark.tflite`, pretrained | **Real** (pretrained, no fine-tune) |
| `mobilefacenet.tflite` | `[1,112,112,3]` f32 (normalized to `[-1, 1]`, **RGB, aligned**) | `[1, 512]` embedding (**NOT pre-L2-normalized — mobile must L2-normalize before cosine distance**) | InsightFace `buffalo_s/w600k_mbf.onnx` → onnx2tf → TFLite FP32 | **Real** (pretrained on WebFace600K via ArcFace, no Bollywood fine-tune yet) |
| `shufflenet_dummy.tflite` | `[1,112,112,3]` f32 | `[1, 2]` softmax | random weights | **Dummy** (replaced by Notebook 03 with real CelebA-Spoof–trained model) |

Total bundle so far: **~14.4 MB** of the 20 MB model cap. MobileFaceNet is FP32 (13 MB); INT8 PTQ in Notebook 05 will cut it to ~3.5 MB.

## What's different from the original dummies

| | Then | Now |
| --- | --- | --- |
| BlazeFace | `blazeface_dummy.tflite`, random weights | `blazeface.tflite`, pretrained — actually detects faces |
| FaceMesh | did not exist | `facemesh.tflite`, pretrained — emits real 468-landmark mesh |
| MobileFaceNet | `mobilefacenet_dummy.tflite`, random weights | `mobilefacenet.tflite`, pretrained — produces consistent identity embeddings |
| ShuffleNet (liveness) | `shufflenet_dummy.tflite`, random weights | unchanged for now — Notebook 03 replaces it |

The two obsolete BlazeFace + MobileFaceNet dummies were deleted with Phase 1's ship. ShuffleNet's dummy stays until Notebook 03.

## Output shape gotchas (read this before wiring the JSI processor)

- **BlazeFace** emits 896 anchor candidates — must run non-max suppression (NMS) and sigmoid-threshold the score output before picking the best face box. There's reference code in MediaPipe's repo if you need it.
- **FaceMesh landmarks** are in **pixel space relative to the 192×192 input**, not normalized to [0, 1]. Rescale `(x, y)` back to the original face crop dimensions before computing EAR/MAR/PnP. The `z` coordinate is depth (useful for PnP) but not normalized in any documented way — treat it as relative.
- **FaceMesh outputs have two extra unit dims** (`[1, 1, 1, 1404]` instead of just `[1404]`). Plan on `np.squeeze()` (or its JSI equivalent) before reshaping.
- **MobileFaceNet embeddings are NOT pre-L2-normalized.** Per the contract you must L2-normalize the 512-D vector before computing cosine distance against stored templates. Stored centroid templates in SQLite are already L2-normalized; live embeddings must be normalized to match.

## Swapping In Trained Models

The ML pipeline drops trained `.tflite` files here with the **same filenames**. Shapes are stable per [../../../shared_contracts/](../../../shared_contracts/). No app code change is required when models update — just a re-bundle.

## Regenerating Dummies (only `shufflenet_dummy.tflite` matters now)

From repo root:

```bash
source venv/bin/activate
python generate_dummies.py
```

This still emits all three dummies into this folder. The BlazeFace and MobileFaceNet dummies will be re-created but should be deleted immediately — the real `.tflite` files (without `_dummy` suffix) are authoritative. We'll prune `generate_dummies.py` to emit only the ShuffleNet dummy in a later cleanup pass.
