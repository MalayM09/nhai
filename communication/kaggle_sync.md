# Kaggle ↔ GitHub runbook

How we execute the ML pipeline without polluting the laptop or the repo. **Code lives in GitHub. Kaggle is a runner.**

```
┌──────────────────┐    git clone           ┌──────────────────┐
│  GitHub (truth)  │ ─────────────────────▶ │ Kaggle Notebook  │
│  /ml_pipeline    │                        │  (GPU session)   │
└──────────────────┘                        └────────┬─────────┘
        ▲                                            │ saves to
        │   git push  (Malay, locally)               │ /kaggle/working/
        │                                            ▼
        │                                   ┌──────────────────┐
        └────────── kaggle CLI / download ──│  Kaggle Output   │
                  artifacts                 │  .tflite, .json  │
                                            └──────────────────┘
```

## Operating contract between Malay and Claude

| Step | Who | What |
| --- | --- | --- |
| 1 | Claude | Authors a `.ipynb` under [../ml_pipeline/notebooks/](../ml_pipeline/notebooks/), commits, pushes |
| 2 | Malay | Pulls, opens the notebook on Kaggle, attaches datasets, picks accelerator, runs |
| 3 | Malay | Pastes the **full text output of the cells Claude asked for** into chat |
| 4 | Claude | Analyzes, identifies issues, authors the next notebook (or a fix) |
| 5 | Malay | Downloads artifacts (`.tflite`, metrics `.json`) to laptop, commits, pushes |

Rule of thumb for output reporting:

- Paste the **literal cell output**, not a summary.
- If a cell fails, paste the **full traceback** — don't trim it.
- Prefer text over screenshots; screenshots only when something is visual (an ROC curve image).

## Starting a new Kaggle notebook

Three options, fastest first:

1. **Import from the repo's notebooks folder** (recommended): Kaggle → New Notebook → File → Import Notebook → upload the `.ipynb` file from your laptop after `git pull`. Or paste the raw GitHub URL.
2. **Fresh notebook + paste Cell 1**: copy the first cell of any existing notebook (the clone block) — that one cell is enough to bootstrap from scratch.
3. **From a Kaggle Dataset**: not used currently. If we ever want to skip the GitHub clone for any reason, we'd publish the repo as a private Kaggle Dataset and mount it.

### Accelerator choice

| Need | Pick |
| --- | --- |
| Smoke tests, ONNX/TFLite conversion, small inference | None (CPU) |
| ShuffleNet liveness training on CelebA-Spoof | T4 ×2 or P100 |
| MobileFaceNet fine-tune on Bollywood Faces | T4 ×2 |
| INT8 PTQ representative-dataset calibration | None (CPU) |

Don't burn GPU quota on CPU-bound work.

## Attaching datasets

In the notebook's right sidebar → Add Data → search Kaggle for the dataset slug → Add. Datasets land at `/kaggle/input/<dataset-name>/`.

Datasets we expect to use:

| Phase | Dataset | Search term | Mount path |
| --- | --- | --- | --- |
| 2 | Bollywood Celebrity Faces | "bollywood celebrity faces" | `/kaggle/input/bollywood-celeb-localized-face-dataset/` (varies by mirror) |
| 3 | LFW (for eval pairs) | "lfw-dataset jessicali9530" | `/kaggle/input/lfw-dataset/` |
| 3 | CelebA-Spoof | "celeba-spoof face anti-spoofing" | `/kaggle/input/celeba-spoof-for-face-antispoofing/` (varies) |

When mounting, copy the exact mount path Kaggle gives you into the notebook — slugs differ between mirrors. We'll edit the notebook to match.

## Saving artifacts (the right way)

- Write everything to `/kaggle/working/` (the only writable dir that persists for the session).
- For multi-session artifacts (e.g. a half-trained checkpoint you'll resume from), promote `/kaggle/working/checkpoint.h5` to a **private Kaggle Dataset** at the end of the session. Then mount it next session — no retraining.
- Hit **Save Version → Quick Save** when a run is worth preserving. **Don't** Save Version for smoke tests.

## Downloading artifacts back to the repo

Two options:

### Option A — Kaggle CLI (preferred)

```bash
# from your laptop, repo root
kaggle kernels output MalayM09/01-bootstrap-smoke-test -p /tmp/kaggle_out
# then move the relevant .tflite or .json into the repo
mv /tmp/kaggle_out/mobilefacenet.tflite mobile_app/assets/models/
git add mobile_app/assets/models/mobilefacenet.tflite
git commit -m "ml: ship phase-1 mobilefacenet (FP32, untrained-on-IMFDB)"
```

The kernel slug is the URL slug, e.g. `MalayM09/01-bootstrap-smoke-test`.

### Option B — Notebook Output panel

On the notebook page, right sidebar → Output → click the file → Download. Same result, more clicks. Use when the CLI isn't handy.

## Notebook naming convention

```
NN_phaseN_short_description.ipynb
```

| Field | Example |
| --- | --- |
| `NN` | `01`, `02`, `03` … |
| `phaseN` | `phase0`, `phase1`, `phase2` |
| `short_description` | `bootstrap_smoke_test`, `mobilefacenet_to_tflite` |

Notebooks live in [../ml_pipeline/notebooks/](../ml_pipeline/notebooks/). Their README has the running index.

## What gets committed vs ignored

| Thing | Commit it? |
| --- | --- |
| `.ipynb` notebook source (cleared outputs) | **Yes** — it's the source code |
| Notebook outputs (large embedded images, weights baked into JSON) | No — clear with `jupyter nbconvert --clear-output` before committing |
| Trained `.tflite` files | **Yes**, into `mobile_app/assets/models/` |
| Trained `.h5` / `SavedModel` (large, intermediate) | No — leave in a private Kaggle Dataset |
| Evaluation reports (`.json`, ROC PNGs) | **Yes**, into `ml_pipeline/evaluation/reports/` |
| Raw datasets | No — they live on Kaggle |

## Common pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| `/kaggle/working/` gone | Kaggle wiped between sessions | Re-clone in cell 1; promote durable artifacts to a Kaggle Dataset |
| Notebook hangs at "Allocating GPU" | Quota exhausted (30 h/week T4, 9 h/week P100) | Switch to T4×2 or CPU; check Account → Usage |
| `tf.lite.TFLiteConverter` produces wrong shapes | TF version drift between local venv and Kaggle | Run cell 4 of Notebook 01 — that prints the TF version |
| Session dies at 12 h | Kaggle hard cap | Checkpoint every epoch; resume from Kaggle Dataset |
| Repo has uncommitted local changes when re-cloning | Cell 1 does `git pull` which fails on conflict | The smoke test does `git clone` fresh each time — this only bites if you edit inside Kaggle (don't) |

## Reminder

Editing code inside the Kaggle cell editor is a trap — those edits don't sync back to GitHub. **Always edit on your laptop, commit, push, then re-run on Kaggle.**
