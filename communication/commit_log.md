# Commit Log

Append-only ledger of every commit on `main`, split by owner. **Add your line in the same commit that introduces the change.** Format:

```
- <YYYY-MM-DD> · <short-sha> · <commit subject>
```

Keep entries to one line. If a commit needs explanation, add a `note_*.md` and reference it.

---

## Malay (ML / Infra)

- 2026-05-31 · 7129ead · chore: initialize dual-track architecture and dummy contracts
- 2026-05-31 · d41ccd3 · docs(communication): add coordination folder with teammate kickoff prompt
- 2026-05-31 · 0462d4b · docs(communication): seed commit ledger from initial setup
- 2026-05-31 · 2a0fb09 · docs: refine architecture (cosine distance, model-only 20MB, quality gate, multi-shot enrollment, adaptive throttle, warmup, pair verification)
- 2026-05-31 · _pending_ · ml(notebooks): notebook 01 bootstrap smoke test + kaggle_sync runbook

## Teammate (Mobile)

_(empty — first entry lands when Phase 1 scaffold begins)_

---

## How to read this file

- Newest entries go at the **bottom** of each section (chronological).
- Short SHA is whatever `git rev-parse --short HEAD` returns right after the commit.
- If you cherry-pick or rebase and SHAs change, fix them up retroactively — don't leave dead references.
