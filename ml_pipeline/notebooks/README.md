# Kaggle Notebooks

This folder holds the `.ipynb` files that run on Kaggle. **Code logic lives in `ml_pipeline/{training,quantization,evaluation,...}` modules** — the notebooks are thin wrappers that clone the repo, install deps, import a module, run it, and dump artifacts to `/kaggle/working/`.

Why this split: notebooks aren't a great place to keep real logic (terrible diffs, no imports, hard to test). Modules are. Use the notebook only for orchestration.

## Naming convention

```
NN_phaseN_short_description.ipynb
```

| | |
| --- | --- |
| `NN` | Two-digit sequence number (01, 02, 03 …) — order of authoring |
| `phaseN` | Project phase the notebook serves (`phase0` … `phase4`) |
| `short_description` | snake_case, ≤ 5 words |

## Current notebooks

| # | File | Phase | Purpose | GPU |
| --- | --- | --- | --- | --- |
| 01 | [01_bootstrap_smoke_test.ipynb](01_bootstrap_smoke_test.ipynb) | 0 | Validate the Kaggle ↔ GitHub loop works end-to-end | No |
| 02 | [02_phase1_pretrained_models.ipynb](02_phase1_pretrained_models.ipynb) | 1 | Download MediaPipe BlazeFace + FaceMesh and convert InsightFace MobileFaceNet ONNX → `.tflite`. Produces three real (pretrained) models to replace the dummies. | No |
| 03 | [03_phase1_shufflenet_liveness.ipynb](03_phase1_shufflenet_liveness.ipynb) | 1 | Trains ShuffleNetV2 0.5× as a binary live-vs-spoof classifier on a 20k-image CelebA-Spoof subset. Outputs `shufflenet_liveness.tflite`. | **Yes** (T4 ×2) |
| 04a | [04a_phase2_mobilefacenet_finetune.ipynb](04a_phase2_mobilefacenet_finetune.ipynb) | 2 | **Fine-tune branch.** Converts InsightFace `w600k_mbf.onnx` → trainable Keras model via `onnx2tf` (multi-strategy loader), adds ArcFace head, fine-tunes at low LR on Bollywood Faces. Outputs `mobilefacenet_bollywood_ft.tflite`. | **Yes** (T4 ×2) |
| 04b | [04b_phase2_mobilefacenet_scratch.ipynb](04b_phase2_mobilefacenet_scratch.ipynb) | 2 | **From-scratch branch.** Builds MobileFaceNet architecture inline (~100 LOC), trains end-to-end with ArcFace from random init. Outputs `mobilefacenet_bollywood_scratch.tflite`. Used as the fallback if 04a's ONNX→Keras conversion fails, and as the second leg of a parallel two-account run. | **Yes** (T4 ×2) |
| 05 | [05_phase3_eer_calibration_and_int8_ptq.ipynb](05_phase3_eer_calibration_and_int8_ptq.ipynb) | 3 | Pair-verification eval of all three MobileFaceNet candidates (baseline + 04a + 04b) on Bollywood held-out val set → ROC + AUC + EER. Picks the EER winner, applies INT8 PTQ, verifies INT8 EER stays within 0.5% of FP32. Also INT8-quantizes ShuffleNet liveness (if `.keras` attached). Emits `threshold_calibration.json` for the contract update. | No (CPU is fine) |

**Notebooks 04a and 04b are designed to run in parallel** on two Kaggle accounts. Notebook 05 evaluates both outputs against the InsightFace baseline via pair verification and ships the EER winner.

## How to run one

Full runbook lives at [../../communication/kaggle_sync.md](../../communication/kaggle_sync.md). TL;DR:

1. New Kaggle notebook → File → Import notebook → upload the `.ipynb` from this folder (or paste the GitHub URL).
2. Attach the datasets the notebook needs (Add Data button in the right sidebar).
3. Pick the right accelerator (none / T4×2 / P100).
4. Run all.
5. Paste outputs back into chat.
