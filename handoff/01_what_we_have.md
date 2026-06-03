# What we already have

Everything in this list is **done and in git** as of `a756dba` (or the head when you pull). Don't redo any of it.

---

## ML side (frozen, do not touch)

- **5 production `.tflite` models** in [mobile_app/assets/models/](../mobile_app/assets/models/), total **17.79 MB** (cap 20):
  - `blazeface.tflite` — 0.22 MB — face detection (Gate 0)
  - `facemesh.tflite` — 1.18 MB — landmarks (Gate 1)
  - `shufflenet_liveness.tflite` — 1.35 MB — passive liveness (Gate 2), CelebA-Spoof val AUC **0.8854**
  - `mobilefacenet.tflite` — 13.0 MB — identity backbone (Gate 3, step 1)
  - `mobilefacenet_adapter.tflite` — 2.01 MB — Indian-demographic residual adapter (Gate 3, step 2)
- **Calibrated cosine-distance threshold:** `0.8616` from adapter_04c AUC 0.9499 / EER 0.1101. Lives in [shared_contracts/thresholds.json](../shared_contracts/thresholds.json).
- ROC curves + training history PNGs in [ml_pipeline/evaluation/reports/](../ml_pipeline/evaluation/reports/) — used in the deck.

---

## Mobile side (Sahil's, partially done)

In [mobile_app/src/](../mobile_app/src/):

| Folder | Status |
| --- | --- |
| `constants/` | Done — thresholds mirror `shared_contracts/thresholds.json` |
| `db/` | Done — SQLite schema, enroll/attendance writes, `getUnsynced*`, `purge*` |
| `heuristics/` | Done — `math.ts` (EAR, MAR, Yaw, Laplacian variance), `landmarks.ts`, `faceMeshIO.ts`, `gates.ts` state machine. 25/25 jest tests passing. |
| `liveness/` | Done — challenge picker + state machine |
| `screens/` | **Wired but unverified on device.** `EnrollmentScreen.tsx`, `ScanScreen.tsx`, `HomeScreen.tsx`. Phase 2 wiring diff in [note_phase2_wiring.md](../communication/note_phase2_wiring.md) may or may not be applied — verify before assuming. |
| `utils/composedEmbedding.ts` | Done — runs backbone + adapter and L2-normalises |

**TypeScript status:** `tsc --noEmit` was 4 errors → 2 after Jun 2 fixes (the pixelFormat ones). The remaining 2 are Frame→TypedArray in `ScanScreen.tsx`:302/319. Status as of last laptop session: **unknown** — may have been fixed during the wiring diff application. Run `tsc --noEmit` first thing.

**Tests:** `npm test -- --testPathPattern=heuristics` was 25/25 green. Run again to confirm.

**ESLint:** 161 → 3 warnings (all non-blocking).

---

## Mock backend

[mock_backend/](../mock_backend/) — FastAPI, single file, JSON persistence. **Tested end-to-end with curl, all 6 endpoints working.**

- `POST /attendance` — sync queue target for attendance events
- `POST /enrollment` — sync queue target for new enrollments
- `GET /embeddings/region/{region_id}` — refresh path for the mobile DB
- `GET /attendance`, `GET /enrollments`, `DELETE /_admin/wipe` — debug helpers
- Swagger UI at `http://localhost:8000/docs`

Sample seed data in [mock_backend/sample_data.json](../mock_backend/sample_data.json). Runtime state at `mock_backend/state.json` (gitignored).

**Not yet wired into the mobile app** — that's a Jun 3 evening task (see [02_what_to_ship_today.md](02_what_to_ship_today.md)).

---

## Benchmark tooling

[tools/benchmark/benchmark.py](../tools/benchmark/benchmark.py) + [tools/benchmark/README.md](../tools/benchmark/README.md) — Python script that drives `adb` to measure:

1. Bundle size on device (≤ 20 MB cap)
2. Cold start latency (5 forced-restart cycles)
3. Process memory after launch
4. Per-gate latency, parsed from `[BENCH] <metric>_ms=<float>` logcat lines (the app emits these — see the README for what to add)

Writes timestamped JSON + paste-ready markdown to `docs/benchmarks/`. Idempotent, runs many times.

---

## Deck + tech doc + storyboard

- [docs/pitch_outline.md](../docs/pitch_outline.md) — 5 slides + appendix, full speaker notes. Slide 4 needs the demo video and the p50/p95 numbers from the benchmark.
- [docs/tech_doc_outline.md](../docs/tech_doc_outline.md) — 6 sections, ~10–12 pages. Sections 4 (benchmarks) and 6 (limitations) wait for Jun 4 numbers.
- [docs/architecture_diagram.png](../docs/architecture_diagram.png) — clean Mermaid export. Ready to drop into slide 2.
- [docs/pitch_slides_content.md](../docs/pitch_slides_content.md) — paste-ready slide text.
- [docs/demo_video_storyboard.md](../docs/demo_video_storyboard.md) — 3-scene shooting plan for Jun 4 filming.

---

## Coordination notes worth reading

These are dense, but they capture decisions you'd otherwise relitigate:

- [communication/note_phase1_complete.md](../communication/note_phase1_complete.md) — what Phase 1 actually shipped
- [communication/note_phase2_wiring.md](../communication/note_phase2_wiring.md) — the 15-LOC swap in `ScanScreen.tsx`
- [communication/note_milestone1_device_test.md](../communication/note_milestone1_device_test.md) — step-by-step phone bring-up checklist
- [communication/note_jun3_priorities.md](../communication/note_jun3_priorities.md) — Malay's plan, useful context but priorities have moved
- [communication/commit_log.md](../communication/commit_log.md) — append-only ledger; **add a line in the same commit that introduces the change** (format in the file)
