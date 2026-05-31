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

The rest are added as we author them — 03 (ShuffleNet liveness baseline on CelebA-Spoof), 04 (MobileFaceNet fine-tune on Bollywood Faces), 05 (EER calibration + INT8 PTQ).

## How to run one

Full runbook lives at [../../communication/kaggle_sync.md](../../communication/kaggle_sync.md). TL;DR:

1. New Kaggle notebook → File → Import notebook → upload the `.ipynb` from this folder (or paste the GitHub URL).
2. Attach the datasets the notebook needs (Add Data button in the right sidebar).
3. Pick the right accelerator (none / T4×2 / P100).
4. Run all.
5. Paste outputs back into chat.
