# START HERE — Handoff to Sahil's laptop

**Written:** 2026-06-03 by Malay (on his laptop, switching over to working on Sahil's machine now).
**For:** Sahil + whatever Claude Code session he runs from his laptop.
**Goal:** ship a working prototype today. Demo clip + benchmark numbers tomorrow.

---

## Read this whole folder in order before touching code

| File | What it's for |
| --- | --- |
| [START_HERE.md](START_HERE.md) | This file. Read first. |
| [01_what_we_have.md](01_what_we_have.md) | Snapshot of everything that's already built. So you don't redo it. |
| [02_what_to_ship_today.md](02_what_to_ship_today.md) | Priority list for the next ~30 hours. This is the to-do. |
| [03_how_to_run.md](03_how_to_run.md) | Exact commands: install, run on phone, mock backend, benchmark. |
| [04_known_issues.md](04_known_issues.md) | TS errors, wiring diff status, runtime gotchas — read before debugging. |
| [05_demo_and_submission.md](05_demo_and_submission.md) | Jun 4 filming + benchmark + deck + tech doc + final ZIP plan. |
| [06_claude_code_briefing.md](06_claude_code_briefing.md) | Hard rules + conventions for the Claude Code session itself. |

Don't skim. Each file is short on purpose. The ordering matters — `02` won't make sense without `01`.

**Before you do anything else: read the 🚨 KNOWN BUG section at the top of [04_known_issues.md](04_known_issues.md).** There's a pixelFormat / frameUtils stride mismatch latent in `main` that will silently break every preprocessed tensor. Fix that before touching anything else, or you'll waste hours chasing ghosts.

---

## Ownership recap (same as repo-root [CLAUDE.md](../CLAUDE.md))

| Owner | Files |
| --- | --- |
| **Sahil** | [mobile_app/](../mobile_app/) |
| **Malay (ML)** | [ml_pipeline/](../ml_pipeline/), [ml_pipeline/notebooks/](../ml_pipeline/notebooks/), [ml_pipeline/evaluation/](../ml_pipeline/evaluation/) |
| **Both sign off** | [shared_contracts/](../shared_contracts/) |
| **Append-only** | [communication/commit_log.md](../communication/commit_log.md) |

For this push (Jun 3 → Jun 4) Malay is sitting next to Sahil at his laptop, so the line is softer in practice. **But the Claude Code session still must not touch [ml_pipeline/](../ml_pipeline/)** — those models are frozen, training artifacts are not in git, and any edit will silently break the citation chain in the tech doc.

---

## What "prototype ready today" means

Concretely:

1. [mobile_app/](../mobile_app/) builds and installs on Sahil's real Android phone.
2. The app boots, the camera opens, the 5 `.tflite` models load without crashing.
3. The Phase 2 wiring diff (in [communication/note_phase2_wiring.md](../communication/note_phase2_wiring.md)) is applied — Gate 1 processes real FaceMesh landmarks.
4. End-to-end happy path: enroll → scan → blink challenge → verified.
5. SQLite writes happen for both enrollment and attendance.
6. Mock backend at [mock_backend/](../mock_backend/) is running on the laptop, phone on the same WiFi can hit it, sync queue posts work.

The "stretch" items for tonight if happy path is green by ~21:00:
- SQLCipher swap (one `open()` line)
- Monotonic clock attendance timestamp
- NetInfo-driven sync flush

Jun 4 is **demo day**: film the storyboard, run the benchmark, fold numbers into deck + tech doc, build the submission ZIP.

---

## How Malay can help while you work

Malay is at the laptop next to you. If something on the ML side breaks (model load error, embedding shape mismatch, threshold confusion), ask him — don't try to fix [ml_pipeline/](../ml_pipeline/) yourself. He has the notebook history in his head.

If the question is mobile-side (vision-camera worklets, RN build, SQLite, navigation), Sahil owns it. Claude Code should treat Sahil as the final authority on [mobile_app/](../mobile_app/) decisions.
