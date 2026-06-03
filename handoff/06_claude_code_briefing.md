# Briefing for Sahil's Claude Code

This file is for the Claude Code session running on Sahil's laptop. **Read this before doing anything.** The repo-root [CLAUDE.md](../CLAUDE.md) applies on top of this.

---

## You are picking up mid-project

This is hackathon day 4 of 5. The prototype must ship within ~30 hours. Speed matters, but the wrong kind of "speed" — skipping checks, refactoring while debugging, "improving" working code — will cost more than it saves.

The single most important behavior: **do exactly what's asked, no more.** If Sahil asks you to fix one TypeScript error, fix one TypeScript error. Don't reformat the file. Don't extract a helper. Don't add a comment explaining the fix. The submission deadline does not have time for taste.

---

## Hard rules

1. **Never edit, create, or delete files under [ml_pipeline/](../ml_pipeline/) or [ml_pipeline/evaluation/](../ml_pipeline/evaluation/).** The training artifacts are frozen, the threshold in [shared_contracts/thresholds.json](../shared_contracts/thresholds.json) is calibrated against them, and the tech doc cites specific numbers from those notebooks. Touching them silently breaks the citation chain.

2. **[shared_contracts/](../shared_contracts/) needs both owners' sign-off before any change.** If a task seems to require editing `thresholds.json` or the README there, stop and confirm with Sahil + (via him) Malay. The threshold 0.8616 in particular is sacrosanct — it's the EER point from a 10k-pair held-out test set.

3. **[communication/commit_log.md](../communication/commit_log.md) is append-only.** Add a new bullet line in the same commit that introduces your change, format already at the top of the file. Don't edit other people's lines. Don't reorder.

4. **Don't run `git push --force` to any branch.** Don't squash, don't rebase. We're on `main` directly because this is a 2-person hackathon — that means commit history matters more, not less.

5. **Never commit anything from [kaggle_downloads/](../kaggle_downloads/) (gitignored as of commit `760d94b`), or any `.pth`, `.pt`, `.h5`, `.ckpt`, `.onnx`, `.zip` file.** Only the final `.tflite` files in [mobile_app/assets/models/](../mobile_app/assets/models/) belong in git.

6. **Don't add new dependencies without asking.** `npm install <thing>` changes `package.json` and `package-lock.json`, may cascade into Android build issues, may pull a native module that needs autolinking. Cost is real. Ask first.

7. **Don't introduce iOS work.** We're submitting Android-only. iOS scaffold stays where it is.

---

## Working style

- **Sahil owns [mobile_app/](../mobile_app/) decisions.** When in doubt about a mobile-side choice (state shape, navigation flow, which library to use), ask him — don't pattern-match from elsewhere in the codebase.
- **Confirm before destructive actions:** `git reset --hard`, `rm -rf`, `adb uninstall`, dropping the SQLite db. These are recoverable but cost time.
- **Prefer the existing helpers over rolling your own.** [mobile_app/src/heuristics/math.ts](../mobile_app/src/heuristics/math.ts), [mobile_app/src/utils/composedEmbedding.ts](../mobile_app/src/utils/composedEmbedding.ts), [mobile_app/src/db/](../mobile_app/src/db/) — all already written, all tested, all wired against the calibrated thresholds.
- **The 25 heuristics tests in `mobile_app/__tests__/` are load-bearing.** If you change anything in [mobile_app/src/heuristics/](../mobile_app/src/heuristics/), run them. If they go red, the calibration in `shared_contracts/thresholds.json` is no longer valid.

---

## When to use what tool

- **`Read`** for known paths — don't `cat` via Bash.
- **`Edit`** for surgical changes — don't `Write` an existing file unless you're doing a full rewrite.
- **`Bash`** for `git`, `npm`, `adb`, `npx tsc`, `python tools/benchmark/benchmark.py`. Not for reading files.
- **`Agent` (Explore)** when you genuinely don't know where something lives. The codebase is small enough that direct `grep` via Bash usually beats spawning an agent — reserve agents for "I don't know what to look for."
- **`TodoWrite`** when the task has 3+ steps. The 30-hour clock makes progress-tracking valuable. Mark items done immediately, not in batches.

---

## What "done" means for a task

A task is **done** when:
1. The code change is in place.
2. `npx tsc --noEmit` is no worse than before.
3. If you touched [mobile_app/src/heuristics/](../mobile_app/src/heuristics/), tests are green.
4. The commit_log line is appended.
5. (If user asked) the commit is created.

A task is **NOT done** because the file is saved. The full chain matters.

---

## When you're blocked

Tell Sahil. Don't:
- Push through with `// TODO` placeholders that don't compile
- Mock around a real bug to "make it work for the demo"
- Disable tests to make CI green
- Delete a file because it's giving you errors you don't understand

These are all loss-of-trust moves and Malay will notice in review.

If you're blocked on something ML-related (model output, embedding shape, threshold interpretation, training intent), **Malay is in the room** — ask Sahil to ask him.

---

## Specific phrases to recognize

| If user says... | They mean... |
| --- | --- |
| "the wiring diff" | [communication/note_phase2_wiring.md](../communication/note_phase2_wiring.md) — the 15-LOC swap in `ScanScreen.tsx` |
| "the cascade" | Gate 0 (BlazeFace) → Gate 1 (FaceMesh + heuristics) → Gate 2 (ShuffleNet) → Gate 3 (MobileFaceNet + adapter) |
| "the threshold" | 0.8616 cosine distance, in `shared_contracts/thresholds.json` |
| "the adapter" | `mobilefacenet_adapter.tflite` — fine-tuned on Bollywood Faces, runs after the backbone |
| "milestone 1" | The phone bring-up checklist in [communication/note_milestone1_device_test.md](../communication/note_milestone1_device_test.md) |
| "the brief" | [rootfiles/hackathon_doc7.pdf](../rootfiles/hackathon_doc7.pdf) — NHAI problem statement |
| "Malay" | Sahil's teammate, ML lead, in the room. Authority on anything in [ml_pipeline/](../ml_pipeline/) and [shared_contracts/](../shared_contracts/). |
| "the mock backend" | [mock_backend/](../mock_backend/) — FastAPI sync stand-in running on the laptop |
| "the benchmark" | [tools/benchmark/benchmark.py](../tools/benchmark/benchmark.py) — Python + adb latency measurement |
| "the storyboard" | [docs/demo_video_storyboard.md](../docs/demo_video_storyboard.md) — Jun 4 filming plan |

---

## The single most important meta-instruction

**This whole project ships in 30 hours. Optimize for shipping, not for code that you'd be proud to show in a code review six months later.** The right call here is often the second-best technical option that you're confident will work in the next hour, not the best one that you'd need to debug for three.

If your instinct is to refactor while debugging — that's the wrong instinct this week. Get the demo working. Refactor in production.
