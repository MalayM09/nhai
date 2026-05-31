# Shared Contracts — The Source of Truth

The frozen interface between [../ml_pipeline/](../ml_pipeline/) and [../mobile_app/](../mobile_app/). Both sides code against the shapes, ranges, and thresholds in this folder. **Change here first, then change code.**

## Size budget — clarified

The **20 MB cap applies to the bundled `.tflite` models**, not the entire application. The React Native runtime, libraries, and JS bundle are separate from this budget.

**Realistic projection** (INT8-quantized):

| Model | Estimated size |
| --- | --- |
| BlazeFace short-range (detection) | ~0.25 MB |
| FaceMesh (landmarks for EAR / MAR / PnP) | ~2.5 MB |
| ShuffleNetV2 0.5× (passive liveness) | ~1.5 MB |
| MobileFaceNet (identity, 512-D) | ~2.5 MB |
| **Total models** | **~6.75 MB** |

Plenty of headroom under 20 MB. Spend the slack on a larger MobileFaceNet variant or a stronger liveness model *only* if eval shows we need it — don't fill the budget for its own sake. App-bundle size is a separate engineering concern owned by the mobile track and tracked there.

## Model I/O Contracts

### BlazeFace (face detection)

| Field | Value |
| --- | --- |
| Input shape | `[1, 128, 128, 3]` |
| Input dtype | `float32`, normalized to `[-1, 1]` (`(pixel / 127.5) - 1`) |
| Output 0 — boxes | `[1, 896, 16]` (regressor anchors) |
| Output 1 — scores | `[1, 896, 1]` (sigmoid logits) |

### FaceMesh (landmarks for Gate 1 heuristics)

| Field | Value |
| --- | --- |
| Input shape | `[1, 192, 192, 3]` |
| Input dtype | `float32`, normalized to `[0, 1]` |
| Output | 468 × 3 landmarks (used for EAR, MAR, PnP — never fed to identity model) |

### ShuffleNetV2 (passive liveness, Gate 2)

| Field | Value |
| --- | --- |
| Input shape | `[1, 112, 112, 3]` |
| Input dtype | `float32`, normalized to `[0, 1]` |
| Input order | **RGB**, channels-last |
| Output | `[1, 2]` softmax — index `0 = live`, `1 = spoof` |
| Decision | reject if `spoof_prob > liveness_spoof_reject_prob` (see `thresholds.json`) |

### MobileFaceNet (identity embedding, Gate 3)

| Field | Value |
| --- | --- |
| Input shape | `[1, 112, 112, 3]` |
| Input dtype | `float32`, normalized to `[-1, 1]` |
| Input order | **RGB**, channels-last, aligned face (eyes horizontal) |
| Output | `[1, 512]` float embedding |
| Post-process | **L2-normalize** before any distance calculation |

## Match Threshold — convention is fixed: COSINE DISTANCE

This was a real ambiguity in the original brief and is now resolved:

```
cosine_distance(a, b) = 1 - (a · b) / (||a|| * ||b||)
```

For L2-normalized embeddings (which MobileFaceNet outputs after post-processing) this simplifies to `1 - dot(a, b)` and lies in `[0, 2]`.

**A pair matches if `cosine_distance(a, b) < threshold`.** Lower = more similar.

```
TARGET_MATCH_THRESHOLD = 0.40   # placeholder, cosine distance
```

- Typical operating range for ArcFace embeddings: **0.30 – 0.45**.
- Real value lands once [../ml_pipeline/evaluation/pair_verification.py](../ml_pipeline/) runs ROC over a balanced pos/neg pair set and reports EER.
- The previous placeholder of `0.8` was wrong — that's a cosine *similarity* magnitude. Both tracks must use **cosine distance**, not similarity, to avoid a demo that accepts everyone or rejects everyone.

## Local DB Schema (SQLite + SQLCipher)

```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    embedding BLOB NOT NULL,        -- 512 float32 little-endian = 2048 bytes
    enrollment_shots INTEGER NOT NULL DEFAULT 1,
    enrollment_quality REAL         -- mean Laplacian variance of source frames
);

CREATE TABLE attendance (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    timestamp_wall INTEGER NOT NULL,        -- ms since epoch
    timestamp_monotonic INTEGER NOT NULL,   -- device uptime, anti time-tamper
    synced INTEGER NOT NULL DEFAULT 0
);
```

The stored embedding is the **L2-normalized centroid** of multiple enrollment shots (see "Enrollment policy" below), not a single-shot embedding.

## Heuristic Thresholds (Gate 1)

| Heuristic | Threshold | Notes |
| --- | --- | --- |
| EAR | `< 0.2` for `≥ 3` consecutive frames | Blink detection |
| MAR | `> 0.5` | Open mouth / smile |
| Yaw (PnP) | `|Δ| > 25°` | Head turn challenge |
| **Laplacian variance** (frame quality) | `≥ 60` | Reject blurry frames *before* embedding. Free CV op, prevents poisoning the matched template. Tune on actual device camera. |
| **Moiré / screen-replay heuristic** (optional Phase 3+) | FFT high-freq energy in face crop above empirical baseline | Catches phone-screen replay attacks that pass single-frame passive liveness. |

## Adaptive frame throttling

| State | Target rate | Reason |
| --- | --- | --- |
| Idle (waiting for face) | ~10 fps | Battery / thermal headroom |
| Active challenge (e.g. "Look left", "Blink") | ~30 fps | Don't miss the transient blink frame |

The frame processor switches based on the state machine — not a static frame skip.

## Enrollment policy

A single enrollment shot is fragile. Enrollment must:

1. Capture **3–5 frames** under varied pose (neutral, slight left, slight right).
2. Run each through BlazeFace → align → MobileFaceNet → produce 3–5 embeddings.
3. **L2-average** the embeddings, re-normalize, store the centroid as the user's template.
4. Record the mean Laplacian variance into `enrollment_quality` so we can detect poor enrollments later.

The backend stores the centroid only — not the raw shots.

## Model warmup contract

The mobile app must run **one dummy forward pass per model on splash / startup** to amortize TFLite delegate initialization. First real inference must not be the user-facing one — cold first-inference is 2–3× steady-state latency and will look broken in the demo.

## Backend Sync Contract

- `POST /attendance` — body: `{ user_id, timestamp_wall, timestamp_monotonic, device_id }`
- `200 OK` → app issues `DELETE FROM attendance WHERE id = ?`.
- `GET /embeddings/region/:id` — returns `[{ id, name, embedding: [512 floats], enrollment_shots, enrollment_quality }]` for offline sync.

## How To Propose A Change

1. Open a PR that edits this README **and** `thresholds.json`.
2. Both ML and Mobile owners sign off.
3. Then update consumer code on each side.

Skipping this folder and just changing a tensor shape on one side is the fastest way to ship a black screen to the judges.
