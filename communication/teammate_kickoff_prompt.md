# Teammate Kickoff Prompt

Copy everything inside the fenced block below into a fresh Claude Code session running in this repo. It briefs Claude on the project, your role, the frozen contract, and the first concrete task — scaffolding the React Native app inside [../mobile_app/](../mobile_app/).

Run it from the repo root: `~/Desktop/nhai/` (or wherever you cloned it).

> **Important:** the architecture has been refined since the original brief. Read [note_2026-05-31_architectural_refinements.md](note_2026-05-31_architectural_refinements.md) before starting — it lists every change Malay made and why.

---

```
# Context

We are building "Hackathon 7.0" — a fully offline, edge-AI facial recognition + passive liveness mobile app for the NHAI brief. The full architecture is documented in @rootfiles/1.MD and @rootfiles/hackathon_doc7.pdf. Read both before writing any code.

The repo is a dual-track monorepo. Malay (my teammate) owns the ML pipeline in /ml_pipeline; I own the React Native mobile app in /mobile_app. The frozen contract between the two tracks lives in /shared_contracts — model input/output shapes, EER threshold, DB schema. Treat that folder as the source of truth: if my code needs a shape change, edit /shared_contracts FIRST, then code.

Before doing anything, also read:
- @README.md (project overview, constraints — note: 20 MB cap is for MODELS, not the whole app)
- @mobile_app/README.md (my role, stack, gate logic, NEW requirements)
- @shared_contracts/README.md (the contract — match metric is cosine DISTANCE, threshold 0.40 placeholder)
- @shared_contracts/thresholds.json (numeric thresholds)
- @communication/README.md (how we coordinate)
- @communication/commit_log.md (what Malay has shipped so far)
- @communication/note_2026-05-31_architectural_refinements.md (recent contract changes — READ THIS, several things in the original brief have been overridden)

# Hard constraints (do not break these)

- Bundled .tflite models total ≤ 20 MB. The React Native binary is NOT in this budget.
- End-to-end inference < 1 second on 3 GB RAM Android 8 / iOS 12.
- Zero network at inference time — everything runs locally.
- All inference happens via C++ JSI frame processors. NEVER do tensor math in JavaScript.

# Stack (non-negotiable)

- react-native-vision-camera (JSI frame processors)
- react-native-fast-tflite (NNAPI on Android, CoreML on iOS)
- react-native-quick-sqlite (C++ SQLite wrapper for embedding BLOBs)
- @react-native-community/netinfo (drives the sync queue when connectivity returns)
- SQLCipher (encrypts the embeddings DB; key in Keychain / Android Keystore)

# Dummy models already in place

Malay has already generated structurally valid dummy .tflite files at /mobile_app/assets/models/ — blazeface_dummy.tflite, shufflenet_dummy.tflite, mobilefacenet_dummy.tflite. They have RANDOM weights but CORRECT shapes (verified against /shared_contracts/). Use them now to bring up the JSI bridge — they will be swapped for trained INT8 models in place, no app code change needed.

# Task — Phase 1: Scaffold the RN app

Do the following inside /mobile_app:

1. Initialize a React Native project (TypeScript template) IN PLACE inside /mobile_app/. Do not create a nested folder. Use a recent stable RN version.
2. Install the four mandatory libraries above (vision-camera, fast-tflite, quick-sqlite, netinfo). Add iOS Pod install and Android Gradle config as needed.
3. Wire camera permission flows for both platforms.
4. Build a single screen that:
   - Opens the front camera at 480p.
   - Runs a JSI frame processor that loads blazeface_dummy.tflite via react-native-fast-tflite.
   - Implements ADAPTIVE FRAME THROTTLING: ~10 fps idle, ~30 fps during active challenge (read throttle_idle_fps and throttle_active_challenge_fps from /shared_contracts/thresholds.json). Static frame skipping breaks blink detection — do NOT hardcode "every 3rd frame".
   - Displays a status card: "Ready to Scan" / "Detecting…" / "Verified" (state machine, even if just stubbed).
5. Implement MODEL WARMUP on the splash screen: run one dummy forward pass per .tflite model before the user can interact. Without this, the first user-facing scan is 2–3× slower and the demo looks broken.
6. Add a placeholder utility module for the Cascading Gate state machine (EAR, MAR, PnP Yaw, Laplacian variance thresholds from /shared_contracts/thresholds.json). Function stubs are fine for the deep heuristics — but the LAPLACIAN VARIANCE quality gate should actually compute (it's one OpenCV call) and reject frames with variance < 60 before they reach Gates 2/3. This is cheap and high-leverage.
7. Add a placeholder SQLite module that creates the `users` and `attendance` tables EXACTLY as documented in /shared_contracts/README.md (note: `users` now has `enrollment_shots` and `enrollment_quality` columns). SQLCipher integration can come in Phase 2 — leave a TODO with a clear note.
8. Use COSINE DISTANCE, not similarity, anywhere distance is computed. A pair matches if cosine_distance < match_threshold_value (0.40). Range [0, 2]. The placeholder 0.8 from the original brief was wrong and has been corrected.

# Constraints on you (Claude)

- Match the directory conventions and tone established in the existing READMEs.
- Do NOT modify /ml_pipeline, /shared_contracts, /communication, or /rootfiles unless I explicitly ask.
- If you need to change a tensor shape, normalization range, or threshold, STOP and ask me first — that's a contract change.
- Run incremental sanity checks (TypeScript compile, Metro bundles) before declaring a step done. You cannot actually run the simulator from here — if you can't verify a feature, say so explicitly instead of claiming success.
- Make small commits as you go (one per logical unit). For MILESTONE commits (merges to main, feature done, contract changes), append a one-line entry to /communication/commit_log.md under the "Teammate (Mobile)" section in the same commit. WIP / fixup commits don't need a ledger entry — keep the ledger scannable. Format: `- <date> · <short-sha> · <commit subject>`.
- When you're done with Phase 1, write a short status note to /communication/note_phase1_mobile.md describing what works, what's stubbed, and what blocks Phase 2.

Do not ask for confirmation on each sub-step; execute the full Phase 1 and report at the end.
```

---

## After Phase 1

Once the kickoff prompt above is finished, future tasks will be:

- **Phase 2** — Real liveness state machine (EAR/MAR/PnP wired to FaceMesh landmarks), randomized challenge UI, SQLCipher integration, **multi-shot enrollment flow** (3–5 frames → L2-averaged centroid).
- **Phase 3** — Embedding lookup against the in-memory `[N, 512]` matrix using cosine distance, attendance write + offline sync queue, monotonic clock anti-spoof.
- **Phase 4** — Fallbacks (low-light ring-light, sunglasses → head turn, NPU → CPU fallback), and the optional **moiré / FFT screen-replay heuristic** to harden against phone-screen replay attacks.

Drop those as new prompts here when each phase is unblocked.
