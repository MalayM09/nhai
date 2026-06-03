# Jun 4 — demo day + submission

Assumes Jun 3 night ended with the happy path green (Step 6 of `02_what_to_ship_today.md`). If it didn't, you're behind — drop the stretch goals (Step 9) and salvage what you can.

---

## Morning (08:00 → 12:00) — finalize the build

1. **08:00 — coffee, `git pull`, `npm install` if anything changed overnight.**
2. **08:30 — `npx tsc --noEmit && npm test`. Both green.** If not, fix before going further.
3. **09:00 — full happy-path sanity run on phone.** Enroll → scan → verified. Three times. Note any flakiness.
4. **09:30 — confirm `[BENCH]` markers are firing.** `adb logcat | grep "\[BENCH\]"` shows lines during scan.
5. **10:00 → 12:00 — close any open issues from yesterday.** Final SQLCipher swap if not done. Pre-seed demo enrollments via mock backend.

**Hard rule:** no new features after 12:00. Only fixes for things that are demonstrably broken.

---

## Lunch (12:00 → 13:00) — eat

You're going to be on camera. Don't be hangry.

---

## Afternoon (13:00 → 17:00) — benchmark + filming

### 13:00 — Latency benchmark

```bash
# phone plugged in, screen unlocked
python tools/benchmark/benchmark.py --runs 10 --logcat-seconds 180
```

During the 180-second logcat window:
- Open the app
- Enroll (once)
- Scan → verify (repeat 10–15 times to get enough samples for p50/p95)

Script will write `docs/benchmarks/benchmark_<timestamp>.json` and `.md`. Commit both.

**DONE =** the markdown has actual numbers in every row, not `n/a`. The p95 of `total_end_to_end` should be < 1000 ms. If it isn't, that's the headline number — we'll have to honestly report it.

### 14:00 — Decide: film, or fall back

Check the demo storyboard fallback section in [docs/demo_video_storyboard.md](../docs/demo_video_storyboard.md). If by 14:00:
- The build is green on phone AND
- The happy path verifies reliably AND
- You have time to print a photo, load a replay video on a second phone

→ **film.** Otherwise → use the still-screenshots fallback (see storyboard) and don't burn the afternoon trying.

### 14:30 → 17:00 — filming

Follow [docs/demo_video_storyboard.md](../docs/demo_video_storyboard.md) scene by scene. Three scenes:

1. Legit user verifies (~15 s)
2. Print attack rejected (~15 s)
3. Screen replay rejected (~20 s)

Scene 3 is the one that fails most often. Be patient — multiple takes are expected.

---

## Evening (17:00 → 20:00) — deck + tech doc + ZIP

### 17:00 — Fold benchmark numbers into the deck

Open [docs/pitch_slides_content.md](../docs/pitch_slides_content.md) — search for `TBD` placeholders, replace with actual numbers from the benchmark markdown.

Specifically:
- Slide 4: "Average inference time across 100 verifications: <p50> ms p50 / <p95> ms p95"
- Appendix A2: paste the full per-gate latency table

### 17:30 — Build the actual slide deck

We have `pitch_slides_content.md` as paste-ready text and `architecture_diagram.png` for slide 2. Build slides in Google Slides or Keynote:

- Title slide
- 5 content slides per `docs/pitch_outline.md`
- 5 appendix slides (skip in talk, in deck for Q&A)
- Embed the demo video on Slide 4 (or stills if filming fell back)

Export to PDF. Filename: `NHAI_pitch_deck.pdf`.

### 18:00 — Tech doc

Open [docs/tech_doc_outline.md](../docs/tech_doc_outline.md). It has 6 sections, 4 of which were drafted Jun 2. Fill the two that needed benchmark numbers:

- Section 4 (benchmarks) — paste the benchmark markdown directly, add 2-3 paragraphs of interpretation
- Section 6 (limitations) — already drafted in spirit; tighten based on what actually shipped

Write the doc in markdown or Google Docs, export to PDF. Filename: `NHAI_technical_doc.pdf`.

### 19:00 — Final ZIP

```
NHAI_submission_<team>/
├── source_code/
│   ├── mobile_app/                  # full RN project
│   ├── ml_pipeline/notebooks/       # the 5 Kaggle notebooks
│   ├── shared_contracts/
│   ├── mock_backend/
│   ├── tools/benchmark/
│   ├── docs/
│   ├── README.md
│   └── CLAUDE.md
├── NHAI_pitch_deck.pdf
├── NHAI_technical_doc.pdf
├── demo_video.mp4                   # the filming output, master cut
├── benchmark_results.md             # the latest from docs/benchmarks/
└── README_submission.txt            # one paragraph: what each file is + how to run the app
```

Things to exclude before zipping:
- `node_modules/` (huge, regenerable)
- `.git/` (git history isn't part of the brief)
- `kaggle_downloads/` (already gitignored, but double-check)
- `mock_backend/.venv/`, `mock_backend/state.json`
- `mobile_app/android/build/`, `mobile_app/android/.gradle/`
- Anything in `*.log`, `tmp/`

```bash
# from repo root, build the source bundle excluding the big stuff
rsync -a --exclude='node_modules' --exclude='.git' --exclude='kaggle_downloads' \
  --exclude='*.venv' --exclude='build' --exclude='.gradle' --exclude='state.json' \
  --exclude='*.log' --exclude='tmp' \
  ./ /tmp/NHAI_submission/source_code/
```

Then zip the whole `NHAI_submission/` folder.

### 20:00 — Submit, breathe

Upload the ZIP, paste the GitHub URL in the form, hit submit. Done.

---

## Live demo (whenever judging happens)

The brief invites live demos. Have the phone + laptop + mock backend ready at the judging table:

- Phone fully charged, app cold-started, on HomeScreen
- Laptop next to phone, mock backend running, swagger UI open in browser
- Printed photo + second phone with replay video, in a folder ready to pull out
- Deck open on a second laptop or projector input

Order:
1. 30 s slide walk-through (skip to Slide 4)
2. Show the live demo: enroll Sahil, verify Sahil, try the print attack, try the screen replay
3. Show the laptop screen — sync queue posts the events to the mock backend in real time
4. Q&A — refer to appendix slides for anything they push on

If the live demo fails on stage, the recorded video on Slide 4 is the backup. That's why we film.
