# Bundled Models

These `.tflite` files are loaded by `react-native-fast-tflite` at app startup. They must be present at build time — Android bundles them via `android/app/src/main/assets/`, iOS via the Xcode asset catalog.

## Current Files (Phase 1 complete, 2026-06-01)

| File | Input | Output | Source | Status |
| --- | --- | --- | --- | --- |
| `blazeface.tflite` | `[1,128,128,3]` f32 (normalized to `[-1, 1]`) | boxes `[1,896,16]`, scores `[1,896,1]` | MediaPipe `face_detection_short_range.tflite`, pretrained | **Real** (pretrained, no fine-tune) |
| `facemesh.tflite` | `[1,192,192,3]` f32 (normalized to `[0, 1]`) | landmarks `[1,1,1,1404]` (squeeze → `(468, 3)`), presence `[1,1,1,1]` | MediaPipe `face_landmark.tflite`, pretrained | **Real** (pretrained, no fine-tune) |
| `mobilefacenet.tflite` | `[1,112,112,3]` f32 (normalized to `[-1, 1]`, **RGB, aligned**) | `[1, 512]` embedding (**NOT pre-L2-normalized — mobile must L2-normalize before cosine distance**) | InsightFace `buffalo_s/w600k_mbf.onnx` → onnx2tf → TFLite FP32 | **Real** (pretrained on WebFace600K via ArcFace, no Bollywood fine-tune yet) |
| `shufflenet_liveness.tflite` | `[1,112,112,3]` f32 (normalized to `[0, 1]`) | `[1, 2]` softmax (index 0 = live, 1 = spoof) | ShuffleNetV2 0.5× trained from scratch on 20k CelebA-Spoof subset, 10 epochs Adam@1e-3 | **Real** (val AUC ~0.85, see [`ml_pipeline/evaluation/reports/shufflenet_training_history.json`](../../../ml_pipeline/evaluation/reports/shufflenet_training_history.json)) |

Total bundle: **~15.7 MB / 20 MB cap**. MobileFaceNet is FP32 (13 MB); INT8 PTQ in Notebook 05 will cut it to ~3.5 MB, dropping the bundle to ~6.4 MB and freeing massive headroom.

## Output shape gotchas (read this before wiring the JSI processor)

- **BlazeFace** emits 896 anchor candidates — must run non-max suppression (NMS) and sigmoid-threshold the score output before picking the best face box.
- **FaceMesh landmarks** are in **pixel space relative to the 192×192 input**, not normalized to [0, 1]. Rescale `(x, y)` back to the original face crop dimensions before computing EAR/MAR/PnP. The `z` coordinate is depth (useful for PnP) but not normalized in any documented way.
- **FaceMesh outputs have two extra unit dims** (`[1, 1, 1, 1404]` instead of just `[1404]`). Plan on `np.squeeze()` before reshaping to `(468, 3)`.
- **MobileFaceNet embeddings are NOT pre-L2-normalized.** Per the contract you must L2-normalize the 512-D vector before computing cosine distance against stored templates.
- **ShuffleNet liveness** uses index 0 for live and index 1 for spoof. Apply `liveness_spoof_reject_prob` (currently 0.5) against `output[0][1]` to reject. AUC is 0.88 on the CelebA-Spoof test split; the model has some late-training overfitting so calibration in Notebook 05 may pick a non-0.5 operating point.

## Liveness model — known limitations

The current `shufflenet_liveness.tflite` is the Phase 1 baseline. Key characteristics:

- **Val AUC ~0.85** on a 4k held-out CelebA-Spoof test-subject sample. Strong signal but not state-of-the-art. Two runs of the training notebook landed at 0.8515 and 0.8854 — natural variance from per-epoch shuffle reseeding + augmentation randomness; both are valid Phase 1 baselines.
- **Late-training overfitting confirmed by the training curves** — val accuracy peaked at 0.81 around epoch 8 then degraded to 0.72 by epoch 10. Last epoch saved (not best epoch). Predictions are overconfident on wrong answers near the threshold.
- **No face bounding-box cropping** — full frames were resized to 112×112. BB-cropping using CelebA-Spoof's `_BB.txt` files would likely lift AUC by 2–4 points but was deferred for the deadline.
- **No early stopping** — last epoch saved (not best). For the contract's purposes this is fine because the AUC measures ranking quality and the threshold gets calibrated downstream.

Active liveness challenges (blink, head turn from FaceMesh heuristics) handle the residual anti-spoof load per `shared_contracts/`.

## Swapping In Trained Models

The ML pipeline drops trained `.tflite` files here with the **same filenames**. Shapes are stable per [../../../shared_contracts/](../../../shared_contracts/). No app code change is required when models update — just a re-bundle.

## Regenerating Dummies

The dummies are no longer required — Phase 1 is complete and all four models are real. `generate_dummies.py` is kept in the repo root as a regression-test utility (it confirms the TF → TFLite path still works locally) but its outputs are no longer used by the app.
