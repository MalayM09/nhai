# communication/

Async coordination channel between **Malay (ML pipeline)** and **Teammate (mobile app)**. Markdown only — no code, no binaries, no design files.

The point of this folder is so that **either contributor (or their Claude Code session) can catch up on what the other side did without reading the entire diff**. If your branch lands a thing that the other side needs to know about, add a line to [commit_log.md](commit_log.md) and, if it's a non-trivial change, drop a short note in a new `note_*.md` file.

## What lives here

| File | Purpose |
| --- | --- |
| [teammate_kickoff_prompt.md](teammate_kickoff_prompt.md) | Paste-into-Claude-Code prompt that bootstraps the teammate's mobile side. Read this first if you're picking up the mobile track. |
| [kaggle_sync.md](kaggle_sync.md) | How the ML pipeline executes: Kaggle is the runner, GitHub is the source of truth. Read this before touching any `.ipynb`. |
| [commit_log.md](commit_log.md) | Append-only running log of commits from both sides. Keeps history scannable. |
| `note_*.md` | Optional ad-hoc notes (e.g. `note_jsi_bridge_quirk.md`) — anything the other side should know about. Keep them short. |

## Conventions

- **One commit → one line in `commit_log.md`.** Add the line in the same commit that introduces the change.
- **Frontmatter not required.** Plain markdown is fine — these files are read by humans and Claude, not parsed.
- **Decisions that affect the contract go in [../shared_contracts/](../shared_contracts/), not here.** This folder is for status, not for binding agreements.
- **Don't delete past notes.** Mark them `> Resolved YYYY-MM-DD` if they're no longer relevant — the history is the point.
