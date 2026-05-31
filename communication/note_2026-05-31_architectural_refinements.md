# Architectural refinements — 2026-05-31

After a critical review of the original blueprint in [../rootfiles/1.MD](../rootfiles/1.MD), several decisions were sharpened or overridden. **The contract files ([../shared_contracts/](../shared_contracts/)) are now authoritative — wherever they conflict with `1.MD`, the contract wins.** Read this entire note before writing code on either track.

## 1. Size budget — corrected framing (HIGH)

| | Before | After |
| --- | --- | --- |
| What the 20 MB cap covers | "Entire application bundle" | **Bundled `.tflite` models only** |
| Realistic projection | ~13–15 MB total app | ~6.75 MB of models; app bundle is separate |
| Implication | Tight, no slack | Significant slack — can spend on a stronger model or FaceMesh if eval demands |

**Why it matters:** the original brief implied app-binary pressure. The actual constraint is model-only, so we should not over-aggressively shrink the RN runtime. App-bundle size is still worth optimizing (selective TFLite ops, Hermes, Proguard) but it's a separate concern.

**Where it lives:** `model_size_budget` in [../shared_contracts/thresholds.json](../shared_contracts/thresholds.json); the table in [../shared_contracts/README.md](../shared_contracts/README.md).

## 2. Match threshold semantics — fixed (HIGH)

The original `1.MD` said "cosine distance < threshold = match" but the placeholder `0.8` was shaped like a cosine *similarity*. That mismatch would have produced a demo that accepts everyone or rejects everyone.

**Resolved:**
- **Metric:** `cosine_distance = 1 - (a · b) / (||a|| ||b||)`. For L2-normalized embeddings this simplifies to `1 - dot(a, b)` and lies in `[0, 2]`.
- **Decision rule:** match if `cosine_distance < match_threshold_value`. **Lower = more similar.**
- **Placeholder:** `0.40` (was `0.8`). Typical ArcFace operating range is `0.30 – 0.45`; real value comes from the ML pipeline's pair-verification ROC → EER.
- **Both tracks must use cosine distance, not similarity, anywhere distance is computed.**

**Where it lives:** "Match Threshold" section of [../shared_contracts/README.md](../shared_contracts/README.md), and `match_threshold_metric`/`match_threshold_value` in [../shared_contracts/thresholds.json](../shared_contracts/thresholds.json).

## 3. Frame-quality gate — added (MEDIUM)

Blurry frames poison enrollment templates and tank verification accuracy.

**Added:** Laplacian variance check at Gate 1. If `var(Laplacian(grayscale(face_crop))) < 60`, drop the frame *before* it reaches Gate 2 or 3. Computationally free (one OpenCV call); high leverage.

**Mobile responsibility:** implement in the JSI frame processor.  
**ML responsibility:** verify the threshold doesn't kill legitimate frames in the evaluation set's low-light samples.

**Where it lives:** `heuristics.laplacian_variance_min` in [../shared_contracts/thresholds.json](../shared_contracts/thresholds.json); Gate 1 table in [../mobile_app/README.md](../mobile_app/README.md).

## 4. Multi-shot enrollment — added (MEDIUM)

Single-shot enrollment is fragile across pose / lighting variation.

**Added:** enrollment captures 3–5 frames under varied pose, runs each through the full pipeline, L2-averages the embeddings, re-normalizes, and stores the centroid as the user's template. Each enrollment frame must pass Gate 1 (including Laplacian variance).

**Schema impact:** `users` table now carries `enrollment_shots` and `enrollment_quality` columns. Sync API returns these alongside the embedding.

**Where it lives:** "Enrollment policy" in [../shared_contracts/README.md](../shared_contracts/README.md); `enrollment` block in [../shared_contracts/thresholds.json](../shared_contracts/thresholds.json); "Enrollment flow (multi-shot)" in [../mobile_app/README.md](../mobile_app/README.md).

## 5. Adaptive frame throttling — replaces static skip (LOW)

The original "process every 3rd frame ~10 fps" approach can drop the single frame where the user actually blinks, sabotaging Gate 1's blink heuristic.

**Replaced with:** state-aware throttling. ~10 fps while idle, ~30 fps when an active challenge prompt is live. The frame processor flips its modulus based on the state machine.

**Where it lives:** `frame_pipeline.throttle_idle_fps` / `throttle_active_challenge_fps` in [../shared_contracts/thresholds.json](../shared_contracts/thresholds.json).

## 6. Model warmup on splash — added (LOW)

TFLite delegate (NNAPI / CoreML) initialization is lazy; the first inference is 2–3× steady-state latency. In a hackathon demo that first inference cannot be the user-facing one or the app will look broken.

**Added:** mobile must run one dummy forward pass per `.tflite` model during splash / first render. Contract flag is `frame_pipeline.warmup_on_splash = true`.

## 7. Validation strategy — split per model (LOW)

The original brief specified K-Fold CV for the face model. That's the wrong eval for face verification.

**Resolved:**
- **MobileFaceNet (face):** LFW-style **pair verification** — balanced pos/neg image pairs, ROC over cosine distances, EER picks the operating threshold.
- **ShuffleNet (liveness):** **K-Fold CV** is fine — it's a small binary classifier.

**Where it lives:** "Validation strategy (revised)" in [../ml_pipeline/README.md](../ml_pipeline/README.md).

## 8. Optional Phase 4 — moiré / FFT screen-replay heuristic

Single-frame passive liveness (ShuffleNet) catches print attacks but is weak against high-quality phone-screen replays. The active blink/yaw challenges carry most of the anti-spoof weight today.

**Optional add (Phase 4):** 2D FFT on the aligned face crop, measure energy in the high-frequency band. Phone screens leak periodic moiré patterns that real faces don't. Reject above an empirical baseline. Costs ~5 ms per frame and crushes the "hold a phone up to the camera" attack vector in the demo.

**Status:** not on the critical path. Ship if Phase 1–3 finish with time to spare.

---

## Open items / things this note does NOT decide

- The exact `match_threshold_value` — stays at `0.40` placeholder until ML produces the calibrated EER.
- The exact Laplacian threshold (`60`) — tunable; may shift after ML reviews low-light evaluation samples.
- Whether the moiré detector ships.
