# ML Pipeline — Owner: Malay

Everything required to take open-source pretrained weights → fine-tuned, INT8-quantized `.tflite` files that satisfy the contracts in [../shared_contracts/](../shared_contracts/).

## Responsibilities

1. Dataset ingestion & augmentation (IMFDB fine-tune + outdoor lighting augmentations).
2. Fine-tuning MobileFaceNet (ArcFace loss) and ShuffleNetV2 (binary spoof / live).
3. INT8 Post-Training Quantization (PTQ) targeting < 3 MB MobileFaceNet, < 1.5 MB ShuffleNet.
4. Evaluation: ROC curve, EER, FAR/FRR — outputs the **threshold** that ships in [../shared_contracts/](../shared_contracts/).
5. Publishing final `.tflite` files into [../mobile_app/assets/models/](../mobile_app/assets/models/).

## Planned Layout

```
ml_pipeline/
├── data/
│   ├── loaders/              # IMFDB, CASIA-WebFace, MS1MV3 PyTorch/TF loaders
│   └── augment/              # Gamma shift, synthetic shadows, Gaussian blur
├── models/
│   ├── mobilefacenet/        # Backbone + ArcFace head
│   └── shufflenetv2/         # 0.5x scale anti-spoof head
├── training/
│   ├── train_face.py         # MobileFaceNet + ArcFace fine-tune on IMFDB
│   └── train_liveness.py     # ShuffleNet binary classifier
├── quantization/
│   └── ptq_int8.py           # Representative dataset + INT8 PTQ
├── evaluation/
│   ├── roc_eer.py            # ROC + Equal Error Rate calculator
│   └── reports/              # Generated plots, threshold export
└── export/
    └── publish.py            # Copies final .tflite → mobile_app/assets/models/
```

## Pretraining & Fine-Tuning

- **Pretrained weights:** MS1MV3 or Glint360K (do not train from scratch).
- **Fine-tune:** IMFDB for Indian demographic coverage.
- **Augmentation:** aggressive gamma correction, synthetic shadows, Gaussian blur — simulates harsh outdoor highway sunlight.

## Loss & Validation

- Loss: **ArcFace (Additive Angular Margin Loss)** — projects embeddings onto a hypersphere with enforced angular margin.
- Validation: K-Fold CV on the fine-tune set.
- Operating point: pick the threshold at **EER** (FAR = FRR) on the ROC curve. That scalar is published to [../shared_contracts/thresholds.json](../shared_contracts/) and hardcoded in the mobile app.

## Quantization

- INT8 Post-Training Quantization with a representative dataset of ~200 aligned 112×112 face crops.
- Verify the per-tensor quantized model still hits EER within ~0.5 % of the FP32 baseline before publishing.

## Environment

Use the repo-root `venv/` (TF 2.21, numpy). Install extras as you go:

```bash
source ../venv/bin/activate
pip install scikit-learn matplotlib pillow tf-keras
```

## Handoff Rule

A `.tflite` file does **not** ship to [../mobile_app/assets/models/](../mobile_app/assets/models/) until:

1. Its input/output shapes match [../shared_contracts/](../shared_contracts/).
2. INT8 size is within budget.
3. EER & threshold are written to `evaluation/reports/`.
