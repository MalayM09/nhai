# Phase 1 real models shipped — 2026-05-31

Three of the four bundled `.tflite` models are now **real pretrained weights** (not random dummies). The mobile JSI bridge should start producing meaningful outputs immediately. Read this before wiring the loader.

## What landed

| Filename | What it is | Replaces |
| --- | --- | --- |
| `mobile_app/assets/models/blazeface.tflite` | MediaPipe BlazeFace short-range, pretrained | `blazeface_dummy.tflite` (deleted) |
| `mobile_app/assets/models/facemesh.tflite` | MediaPipe FaceMesh (468 landmarks), pretrained | NEW — there was no FaceMesh dummy |
| `mobile_app/assets/models/mobilefacenet.tflite` | InsightFace `w600k_mbf` (MobileFaceNet pretrained on WebFace600K with ArcFace) | `mobilefacenet_dummy.tflite` (deleted) |
| `mobile_app/assets/models/shufflenet_dummy.tflite` | **Still a dummy** — random weights | (unchanged; Notebook 03 ships the real one tomorrow) |

## What the mobile loader must change

Point your model loader at the new filenames:

```diff
- loadModel('blazeface_dummy.tflite')
+ loadModel('blazeface.tflite')

+ loadModel('facemesh.tflite')   // new — wasn't loaded before

- loadModel('mobilefacenet_dummy.tflite')
+ loadModel('mobilefacenet.tflite')

  loadModel('shufflenet_dummy.tflite')   // unchanged for now
```

Filenames are stable from here on. When the ML pipeline ships INT8 versions (Notebook 05), the *same filenames* get overwritten in place — no further loader change.

## Output shape gotchas you'll hit

### FaceMesh (the one that will bite you if you don't read this)

The contract was updated to match what MediaPipe actually emits:

| Output | Real shape | What to do with it |
| --- | --- | --- |
| Landmarks | `[1, 1, 1, 1404]` | Squeeze unit dims → reshape `(468, 3)`. Each row is `(x, y, z)` **in pixel space relative to the 192×192 input** — rescale `x, y` back to the original face crop. `z` is depth (use it for PnP, ignore for EAR/MAR). |
| Face presence score | `[1, 1, 1, 1]` | Sigmoid logit. Gate Gate 1 on this above ~0.5 before trusting the landmarks. |

### MobileFaceNet

- Output `[1, 512]` is **NOT pre-L2-normalized**. The contract requires you to L2-normalize the live vector before computing cosine distance. Stored centroid templates in SQLite must also be L2-normalized at write time.
- Embedding norm on raw output is typically ~9–10. After L2-normalize, it's exactly 1.0.
- Preprocessing: RGB, channels-last, **face must be aligned** (eye landmarks horizontal), normalized to `[-1, 1]` via `(pixel - 127.5) / 127.5`.

### BlazeFace

- 896 anchor candidates. Run sigmoid on scores, threshold (e.g. > 0.6), then NMS to pick the best face box. MediaPipe's reference code (in C++) is the canonical implementation; there are JS/TS ports.

## Why MobileFaceNet is currently 13 MB

It's FP32. The 20 MB contract budget is for **all models combined**:

| | FP32 (now) | INT8 (Notebook 05) |
| --- | --- | --- |
| BlazeFace | 0.22 MB | 0.22 MB (unchanged) |
| FaceMesh | 1.18 MB | 1.18 MB (unchanged) |
| MobileFaceNet | 13.0 MB | ~3.5 MB |
| ShuffleNet | ~0.04 MB (dummy) | ~1.5 MB (trained INT8) |
| **Total** | **14.4 MB** (within cap) | **~6.4 MB** (massive headroom) |

So we're fine for now. Don't change the JSI side because of size — Notebook 05 will fix it on the ML side without touching the mobile code.

## Sanity check the ML side ran

In Notebook 02 we ran two slightly-perturbed images through MobileFaceNet:

- Pre-L2 embedding norms: 9.722 vs 9.748 (consistent, non-degenerate)
- Cosine distance between the two: **0.0072**

That's exactly what real ArcFace weights produce. Random weights would have given ~1.0 distance. The model is genuinely loaded.

## What's still open

- ShuffleNet liveness is still a random-weight dummy. Mobile code can wire the call, but liveness decisions will be 50/50 noise until Notebook 03 ships (~today/tomorrow).
- Match threshold remains `0.40` placeholder in `shared_contracts/thresholds.json`. The calibrated EER from Notebook 05's pair-verification eval replaces it.
- INT8 PTQ has not happened yet. MobileFaceNet at 13 MB is FP32; first-inference latency may be slow until Notebook 05's INT8 version lands.
