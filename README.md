# Hackathon 7.0 — Edge-AI Offline Biometric Authentication

A field-deployable, **fully offline** facial recognition + passive liveness system for the NHAI / Hackathon 7.0 brief. Targets low-end Android 8 / iOS 12 devices in zero-network environments (highway construction sites, rural inspections).

## Hard Constraints

| Constraint | Budget |
| --- | --- |
| Total application bundle size | **≤ 20 MB** |
| End-to-end inference latency | **< 1 second** (target 300–450 ms on 3 GB RAM) |
| Network requirement at inference time | **Zero** (sync only at base camp) |
| Min accuracy on diverse Indian demographics | **> 95 %** |

## System Pillars

1. **Cascading Gating Architecture** — Heuristics (Gate 1) → ShuffleNet liveness (Gate 2) → MobileFaceNet identity (Gate 3). Neural nets only fire when cheap heuristics pass.
2. **Edge-only embeddings** — 512-D vectors stored in encrypted SQLite (SQLCipher); raw images never leave the device.
3. **Monotonic clock anti-spoof** — Detects OS time tampering for offline attendance fraud.

## Split-Team Workflow

This repository is a **dual-track monorepo**. Two contributors work in parallel against a frozen contract:

| Track | Owner | Path | Deliverable |
| --- | --- | --- | --- |
| ML Pipeline | Malay (me) | [ml_pipeline/](ml_pipeline/) | Trained, quantized `.tflite` models + eval reports |
| Mobile App | Teammate | [mobile_app/](mobile_app/) | React Native binary consuming the `.tflite` files |
| Contracts | Both | [shared_contracts/](shared_contracts/) | Tensor shapes, thresholds, schema — the source of truth |

The contracts in [shared_contracts/](shared_contracts/) are the API between the two tracks. **Neither side may change a tensor shape, normalization range, or threshold without updating that folder first.**

## Repo Layout

```
.
├── ml_pipeline/              # Training, quantization, evaluation (Python)
├── mobile_app/               # React Native app (TS + native C++ JSI)
│   └── assets/models/        # Bundled .tflite files (loaded by frontend)
├── shared_contracts/         # Tensor shapes, thresholds, DB schema
├── communication/            # Async coordination between the two tracks (markdown only)
├── rootfiles/                # Source brief & architecture notes (read-only)
├── venv/                     # Python virtual env (gitignored)
└── generate_dummies.py       # One-shot dummy .tflite generator (see below)
```

For team coordination, see [communication/](communication/) — it contains the kickoff prompt for the mobile-side Claude Code session and the shared commit log.

## Bootstrap

ML side (this repo's `venv/` already has TF 2.21 + numpy):

```bash
source venv/bin/activate
python generate_dummies.py        # regenerates the 3 dummy .tflite files
```

Mobile side: see [mobile_app/README.md](mobile_app/README.md).

## Why Dummy Models Exist

Teammate needs **structurally valid** `.tflite` files immediately to wire up `react-native-fast-tflite` and validate the JSI bridge. Empty placeholder files segfault the interpreter on load. The dummies in [mobile_app/assets/models/](mobile_app/assets/models/) have the correct input/output shapes but random weights — swap them out as the real trained models land from the ML pipeline.
