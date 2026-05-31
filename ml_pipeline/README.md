# ML Pipeline — Owner: Malay

Everything required to take open-source pretrained weights → fine-tuned, INT8-quantized `.tflite` files that satisfy the contracts in [../shared_contracts/](../shared_contracts/).

## Responsibilities

1. Dataset ingestion & augmentation (IMFDB fine-tune + outdoor lighting augmentations).
2. Fine-tuning MobileFaceNet (ArcFace loss) and ShuffleNetV2 (binary spoof / live).
3. INT8 Post-Training Quantization (PTQ) targeting < 3 MB MobileFaceNet, < 1.5 MB ShuffleNet.
4. Evaluation: **pair verification** + ROC curve + EER for face; **K-Fold** for the spoof classifier — outputs the **cosine-distance threshold** that ships in [../shared_contracts/](../shared_contracts/).
5. Publishing final `.tflite` files into [../mobile_app/assets/models/](../mobile_app/assets/models/).

## Planned Layout

```
ml_pipeline/
├── notebooks/                # Kaggle .ipynb runners (thin wrappers around modules)
├── data/
│   ├── loaders/              # Bollywood Faces, LFW, CelebA-Spoof loaders
│   └── augment/              # Gamma shift, synthetic shadows, Gaussian blur
├── models/
│   ├── mobilefacenet/        # Backbone + ArcFace head
│   └── shufflenetv2/         # 0.5x scale anti-spoof head
├── training/
│   ├── train_face.py         # MobileFaceNet + ArcFace fine-tune on Bollywood
│   └── train_liveness.py     # ShuffleNet binary classifier
├── quantization/
│   └── ptq_int8.py           # Representative dataset + INT8 PTQ
├── evaluation/
│   ├── pair_verification.py  # LFW-style pos/neg pairs -> ROC -> EER (face)
│   ├── liveness_kfold.py     # K-Fold CV for the spoof classifier
│   └── reports/              # Generated plots, threshold export
└── export/
    └── publish.py            # Copies final .tflite -> mobile_app/assets/models/
```

The notebooks in [notebooks/](notebooks/) are how this code actually runs — Kaggle is the runner, modules are the logic. See [../communication/kaggle_sync.md](../communication/kaggle_sync.md) for the Kaggle ↔ GitHub workflow.

## Pretraining & Fine-Tuning

- **Pretrained weights:** MS1MV3 or Glint360K (do not train from scratch).
- **Fine-tune:** IMFDB for Indian demographic coverage.
- **Augmentation:** aggressive gamma correction, synthetic shadows, Gaussian blur — simulates harsh outdoor highway sunlight.

## Loss

- **ArcFace (Additive Angular Margin Loss)** — projects embeddings onto a hypersphere with enforced angular margin.

## Validation strategy (revised)

The two models need different evaluation strategies:

- **Face identity (MobileFaceNet)** → **pair verification**, not K-Fold.
  - Build a balanced set of positive (same identity) and negative (different identity) image pairs from a held-out split of IMFDB + LFW.
  - For each pair, compute L2-normalized embeddings and cosine distance.
  - Sweep threshold, plot ROC, find **EER** (FAR = FRR).
  - Write `EER value (cosine distance)` to [../shared_contracts/thresholds.json](../shared_contracts/thresholds.json) as `match_threshold_value` and flip `match_threshold_status` to `calibrated`.
  - Typical operating range for ArcFace embeddings: **0.30 – 0.45** cosine distance.
- **Liveness classifier (ShuffleNet)** → **K-Fold** is fine here; it's a small binary classifier on a curated spoof dataset.

## Quantization

- INT8 Post-Training Quantization with a representative dataset of ~200 aligned 112×112 face crops.
- Verify the per-tensor quantized model still hits EER within ~0.5 % of the FP32 baseline before publishing.

## Quality gate output (informational)

The mobile app rejects blurry frames *before* embedding via a Laplacian variance check (threshold 60, in [../shared_contracts/thresholds.json](../shared_contracts/thresholds.json)). The ML side should:

- Run the same Laplacian filter over the evaluation set to confirm the threshold doesn't kill legitimate frames in low light.
- If too aggressive, raise the suggested threshold in `thresholds.json` (this is a contract change — coordinate via PR).

## Environment

Use the repo-root `venv/` (TF 2.21, numpy). Install extras as you go:

```bash
source ../venv/bin/activate
pip install scikit-learn matplotlib pillow tf-keras opencv-python
```

`opencv-python` is for the Laplacian variance sanity check.

## Handoff Rule

A `.tflite` file does **not** ship to [../mobile_app/assets/models/](../mobile_app/assets/models/) until:

1. Its input/output shapes match [../shared_contracts/](../shared_contracts/).
2. INT8 size is within budget (full model bundle ≤ 20 MB).
3. EER & cosine-distance threshold are written to `evaluation/reports/` AND propagated to [../shared_contracts/thresholds.json](../shared_contracts/thresholds.json).
