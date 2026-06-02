# Commit Log

Append-only ledger of every commit on `main`, split by owner. **Add your line in the same commit that introduces the change.** Format:

```
- <YYYY-MM-DD> · <short-sha> · <commit subject>
```

Keep entries to one line. If a commit needs explanation, add a `note_*.md` and reference it.

---

## Malay (ML / Infra)

- 2026-05-31 · 7129ead · chore: initialize dual-track architecture and dummy contracts
- 2026-05-31 · d41ccd3 · docs(communication): add coordination folder with teammate kickoff prompt
- 2026-05-31 · 0462d4b · docs(communication): seed commit ledger from initial setup
- 2026-05-31 · 2a0fb09 · docs: refine architecture (cosine distance, model-only 20MB, quality gate, multi-shot enrollment, adaptive throttle, warmup, pair verification)
- 2026-05-31 · e973378 · ml(notebooks): notebook 01 bootstrap smoke test + kaggle_sync runbook
- 2026-05-31 · 38d7731 · ml(notebooks): notebook 02 phase 1 pretrained models (BlazeFace, FaceMesh, MobileFaceNet via insightface ONNX)
- 2026-05-31 · 4ba4a08 · ml(phase1): ship real BlazeFace + FaceMesh + MobileFaceNet .tflite; drop obsolete dummies; document FaceMesh actual output shape
- 2026-05-31 · 5565772 · ml(notebooks): notebook 03 ShuffleNetV2 0.5× liveness baseline on CelebA-Spoof
- 2026-06-01 · 15e8946 · fix(notebooks/03): use keras.ops.* instead of raw tf.* on KerasTensors (Keras 3 functional API)
- 2026-06-01 · 3d3cca6 · fix(notebooks/03): drop tf.keras.metrics.AUC (broken under T4×2 MirroredStrategy); compute AUC post-hoc via sklearn
- 2026-06-01 · 2c18458 · fix(notebooks/03): pre-shuffle (files, labels) before tf.data cache — broke class-block batching that produced 50% val acc
- 2026-06-01 · 72d3e06 · docs: mark Phase 1 complete in models README + add note_phase1_complete (val AUC 0.88, bundle 15.7 MB)
- 2026-06-01 · 6f0709a · ml(phase1): ship real ShuffleNetV2 0.5× liveness .tflite (CelebA-Spoof, val AUC 0.8854, 1.35 MB FP32); drop last dummy
- 2026-06-01 · ccc494a · ml(reports): add shufflenet training history + curves to eval reports; calibrate docs to JSON-verified val AUC ~0.85
- 2026-06-01 · 644754f · ml(notebooks): notebooks 04a (MobileFaceNet fine-tune) + 04b (from-scratch) for parallel two-account run on Bollywood Faces
- 2026-06-01 · bcbcf9a · fix(notebooks/04a+04b): drop mediapipe (numpy ABI + API namespace issues on Kaggle), use OpenCV Haar cascade for face cropping instead
- 2026-06-01 · b8b4177 · ml(notebooks): notebook 05 — pair verification + EER calibration + INT8 PTQ framework (ready to plug 04a/04b artifacts in)
- 2026-06-01 · 00bf261 · fix(notebooks/04a): pre-import tf + scipy before onnx2tf install to avoid post-install numpy ABI corruption
- 2026-06-01 · 0b13646 · ml(reports): notebook 04b training history + curves (val_acc 99.8% at best epoch 11 of 14, early-stopped; instability flagged)
- 2026-06-02 · 92f2f31 · fix(notebooks/04a): add onnx2tf -okv3 -osd flags so it actually emits a trainable Keras model (default was tflite-only)
- 2026-06-02 · 8834cfc · ml(notebooks): notebook 04c — adapter fine-tune (frozen backbone TFLite + small Keras adapter on precomputed embeddings)
- 2026-06-02 · 14503b9 · fix(notebooks/04c): drop crop threads 8 -> 2, thread-local cascades (cv2 isn't thread-safe), chunk + gc.collect to avoid kernel OOM
- 2026-06-02 · b5148d6 · ml(reports + notebooks/05): adapter training curves + Notebook 05 updated to handle composed (backbone+adapter) candidate type
- 2026-06-02 · f1f6929 · fix(notebooks/05): handle flat candidate dataset structure (files at dataset root, not in 04a/04b/04c subfolders)

## Teammate (Mobile)

_(empty — first entry lands when Phase 1 scaffold begins)_

---

## How to read this file

- Newest entries go at the **bottom** of each section (chronological).
- Short SHA is whatever `git rev-parse --short HEAD` returns right after the commit.
- If you cherry-pick or rebase and SHAs change, fix them up retroactively — don't leave dead references.
