# Shared Contracts — The Source of Truth

The frozen interface between [../ml_pipeline/](../ml_pipeline/) and [../mobile_app/](../mobile_app/). Both sides code against the shapes, ranges, and thresholds in this folder. **Change here first, then change code.**

## Model I/O Contracts

### BlazeFace (face detection)

| Field | Value |
| --- | --- |
| Input shape | `[1, 128, 128, 3]` |
| Input dtype | `float32`, normalized to `[-1, 1]` (i.e. `(pixel / 127.5) - 1`) |
| Output 0 — boxes | `[1, 896, 16]` (regressor anchors) |
| Output 1 — scores | `[1, 896, 1]` (sigmoid logits) |

### ShuffleNetV2 (passive liveness, Gate 2)

| Field | Value |
| --- | --- |
| Input shape | `[1, 112, 112, 3]` |
| Input dtype | `float32`, normalized to `[0, 1]` |
| Input order | **RGB**, channels-last |
| Output | `[1, 2]` softmax — index `0 = live`, `1 = spoof` |
| Decision | reject if `spoof_prob > 0.5` (tunable in `thresholds.json`) |

### MobileFaceNet (identity embedding, Gate 3)

| Field | Value |
| --- | --- |
| Input shape | `[1, 112, 112, 3]` |
| Input dtype | `float32`, normalized to `[-1, 1]` |
| Input order | **RGB**, channels-last, aligned face (eyes horizontal) |
| Output | `[1, 512]` float embedding |
| Post-process | L2-normalize before cosine distance |

## Match Threshold (EER)

```
TARGET_EER_THRESHOLD = 0.8   # placeholder, cosine distance
```

This is a **placeholder until the ML pipeline produces the real ROC-derived value**. After the first ArcFace fine-tune + INT8 quantization round, [../ml_pipeline/evaluation/roc_eer.py](../ml_pipeline/) writes the actual EER threshold here, and the mobile app reads it at build time.

- A pair is considered the **same person** if `cosine_distance < threshold`.
- Lower threshold → fewer false accepts, more false rejects. EER is where they cross.

## Local DB Schema (SQLite + SQLCipher)

```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    embedding BLOB NOT NULL   -- 512 float32 little-endian = 2048 bytes
);

CREATE TABLE attendance (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    timestamp_wall INTEGER NOT NULL,    -- ms since epoch
    timestamp_monotonic INTEGER NOT NULL, -- device uptime, anti time-tamper
    synced INTEGER NOT NULL DEFAULT 0
);
```

## Heuristic Thresholds (Gate 1)

| Heuristic | Threshold | Notes |
| --- | --- | --- |
| EAR | `< 0.2` for `≥ 3` consecutive frames | Blink detection |
| MAR | `> 0.5` | Open mouth / smile |
| Yaw (PnP) | `|Δ| > 25°` | Head turn challenge |

## Backend Sync Contract

- `POST /attendance` — body: `{ user_id, timestamp_wall, timestamp_monotonic, device_id }`
- `200 OK` → app issues `DELETE FROM attendance WHERE id = ?`.
- `GET /embeddings/region/:id` — returns `[{ id, name, embedding: [512 floats] }]` for offline sync.

## How To Propose A Change

1. Open a PR that edits this README **and** `thresholds.json` (when it lands).
2. Both ML and Mobile owners sign off.
3. Then update consumer code on each side.

Skipping this folder and just changing a tensor shape on one side is the fastest way to ship a black screen to the judges.
