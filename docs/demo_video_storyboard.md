# Attack-Rejection Demo Clip — Storyboard

**Target length:** 45–60 seconds total (Slide 4 of the deck embeds this).
**Format:** 1080p MP4, portrait or landscape — pick one and stay consistent across scenes.
**Filming date:** Jun 4 evening (after device build is green, after benchmark numbers are in).
**Phone for filming:** any second phone / DSLR / laptop webcam. **NOT the demo phone** — that one is running the app.

---

## What we need to communicate in under a minute

1. The app works for a real user (Scene 1 — green outcome).
2. The app refuses a printed photo (Scene 2 — Gate 1 / Gate 2 blocks it).
3. The app refuses a video replay shown on a second screen (Scene 3 — Gate 2 blocks it).
4. All three happen on the same phone, with **airplane mode on**.

That's the whole story. If a viewer can't repeat those four points after watching, the clip failed.

---

## Pre-shoot checklist

Tick before you press record. If any of these are missing the clip will look amateurish or — worse — be uncredible.

- [ ] Demo phone charged > 50%
- [ ] Demo phone in **airplane mode** — visible in the status bar
- [ ] App freshly installed (cold start on tap, not resumed from background)
- [ ] One enrolled identity already in the DB ("Demo User A" or whatever Sahil seeded)
- [ ] Print attack: A4 colour print of the same enrolled user's face, head-and-shoulders, roughly life-size. Matte paper if available (glossy reflects and looks staged).
- [ ] Screen replay attack: a **second phone** showing a ~10-second video of the enrolled user blinking on loop. Set the replay phone to max brightness.
- [ ] Lighting: indoor, even, no backlight. Don't film outdoors at noon — the harsh shadows will read as "they're hiding something."
- [ ] Background: plain wall. No teammates in shot, no cluttered desk.
- [ ] Audio: silent. Voice-over goes on in post — don't try to narrate live.
- [ ] Second camera framed so **both the demo phone screen and the user's face are visible**. The screen is the proof.

---

## Scene 1 — Legitimate user verifies (~15 seconds)

**What you see on the second-camera frame:**
- Left: enrolled user's face, calm, looking at the demo phone.
- Right: the demo phone, screen facing the second camera. App is on the Scan screen.

**Beats:**

| Time | On demo phone | What the user does | On-screen overlay (post) |
| --- | --- | --- | --- |
| 0.0s | App on Scan screen, prompt: *"Blink your eyes"* | Holds phone at arm's length, looks at it | "Airplane mode ✈ — fully offline" (top-right) |
| 1.5s | FaceMesh box appears on user's face | Blinks once, slowly | "Gate 0: face detected ✅" |
| 2.5s | Prompt changes: *"Hold still…"* | Still | "Gate 1: blink detected ✅" |
| 3.2s | Green tick + name pops up: *"Verified — Demo User A"* | Smiles | "Gate 2 + Gate 3 ✅ — 812 ms" (use actual p50 from benchmark) |
| 4.0s | — | Lowers phone | — |

**Voice-over script (~10 s):**
> *"Front camera. Airplane mode on. The user is prompted to blink — a randomized active-liveness challenge. Within under a second, all three cascade gates pass and the app verifies him by name."*

**Cut to Scene 2 with a hard cut. No fade.**

---

## Scene 2 — Print attack rejected (~15 seconds)

**What you see on the second-camera frame:**
- Left: a hand holding a **printed A4 photo** of the same enrolled user in front of the demo phone.
- Right: the demo phone, scan screen, same as Scene 1.

**Beats:**

| Time | On demo phone | What the attacker does | On-screen overlay (post) |
| --- | --- | --- | --- |
| 0.0s | Scan screen, prompt: *"Blink your eyes"* | Holds the printed photo in front of the demo phone's front camera | "Attack: printed photo" (top-left, red) |
| 1.5s | FaceMesh box appears on the printed face | Holds steady — paper can't blink | "Gate 0: face detected ✅" |
| 3.5s | — | Tries to wiggle the paper to simulate a blink | "Gate 1: no blink — timeout 🚫" *or* "Gate 2: print detected (spoof p=0.94) 🚫" — whichever fires first |
| 5.0s | Red banner: *"Attack detected — try again"* | Lowers paper | "❌ Rejected" |

**Voice-over script (~10 s):**
> *"Same phone, same camera. Now an attacker holds a printed photograph. Paper can't blink — Gate 1 times out. Even if it had, the passive liveness model catches the paper texture. Rejected."*

**Notes for the operator:**
- If Gate 1 (active blink) is what rejects it, fine — that's the cheap heuristic doing its job and you can say so.
- If Gate 2 (ShuffleNet) is what rejects it, even better — that's the neural-net catch and you should explicitly say "passive liveness."
- Don't fake it. If your first take has Gate 1 timeout but Gate 2 doesn't fire, that's still a valid rejection — narrate what you actually see.

**Cut to Scene 3 with a hard cut.**

---

## Scene 3 — Screen replay rejected (~20 seconds)

**This is the hardest attack to reject and the most important scene.** A printed photo failing is unsurprising. A video replay failing is the punchline.

**What you see on the second-camera frame:**
- Left: a hand holding a **second phone** screen-up, the screen playing a looped video of the enrolled user blinking.
- Right: the demo phone, scan screen.

**Beats:**

| Time | On demo phone | What the attacker does | On-screen overlay (post) |
| --- | --- | --- | --- |
| 0.0s | Scan screen, prompt: *"Blink your eyes"* | Holds the replay phone in front of the demo phone's front camera | "Attack: video replay" (top-left, red) |
| 1.5s | FaceMesh box appears on the replayed face | Aligns so the demo phone's camera sees the replay clearly | "Gate 0: face detected ✅" |
| 3.0s | — | Replayed video shows the enrolled user blinking | "Gate 1: blink detected ✅ — *active heuristic fooled*" (yellow, **not red yet**) |
| 4.5s | — | Holds steady | "Gate 2: screen detected (spoof p=0.87) 🚫" |
| 6.0s | Red banner: *"Attack detected — try again"* | Lowers replay phone | "❌ Rejected" |

**Voice-over script (~15 s):**
> *"The hardest attack: a video of the user blinking, played back on a second screen. The active heuristic is fooled — there's a real blink visible. But the passive liveness model sees the screen — the moiré, the bezel, the reflection — and rejects. This is why we run the gates in cascade rather than relying on just one."*

**Operator notes:**
- The yellow "Gate 1 fooled" overlay is critical. It earns honesty points: we're admitting our active heuristic was beaten, then showing the next gate saved us. Judges reward that more than pretending Gate 1 also caught it.
- If Gate 2's spoof probability is below 0.5 on the first take — i.e. ShuffleNet **doesn't** reject the replay — stop, don't fake it. Tilt the replay phone to expose more bezel, increase replay-phone brightness, or move closer. We need a real rejection on camera, not a staged one.

---

## Closing card (~5 seconds)

Static frame, no motion. White background, dark text.

```
NHAI Biometric Authentication
3 attempts · 1 phone · 0 network
Bundle: 17.79 MB   ·   p50: <fill from benchmark> ms

Code: github.com/<repo>
```

(If we don't have a public repo URL by Jun 4, drop the last line.)

---

## Post-production checklist

- [ ] Trim each scene to its target length — don't let dead air run
- [ ] Add the on-screen overlays per the beat tables above (lower-third style, sans-serif, white text on a subtle dark pill)
- [ ] Record voice-over after the cut is locked, not before
- [ ] Music: **none** — silence reads as serious; royalty-free electronica reads as student project
- [ ] Export 1080p, H.264, < 25 MB so it embeds in the PPTX without a separate file
- [ ] Save the master + the compressed version both. The master goes to `docs/demo_master.mp4`, the embed-ready version to `docs/demo_embed.mp4`. Neither is committed to git — they go to the submission ZIP only.

---

## If filming gets blocked

Fallback plan, in priority order:

1. **Three still screenshots side-by-side** (verified / print rejected / screen rejected) on Slide 4. Loses the dynamism but preserves the proof. Caption: "Demo video unavailable due to device shipment delay — submitted alongside source code under `docs/demo_master.mp4`."
2. **Animated GIF of just Scene 1** (the verification path). The hardest scenes to fake are the rejections; the verification is easy to capture.
3. **Live demo only** — drop the video, do all three attacks at the judges' table. Riskier (gear can fail, lighting can be wrong) but the brief explicitly invites live demos.

Decide by **Jun 4 14:00**. If filming hasn't started by then, switch to fallback #1 and don't burn the evening trying.

---

## Filming day timeline (Jun 4)

| Time | Block |
| --- | --- |
| 14:00 | Demo phone build is green (gated on Sahil's milestone 1) |
| 14:30 | Print the A4 photo, load the replay video on the second phone |
| 15:00 | Test light + framing in the chosen room |
| 15:30 | Shoot Scene 1 — 3 takes |
| 16:00 | Shoot Scene 2 — 3 takes |
| 16:30 | Shoot Scene 3 — 5 takes (this is the one that fails most often; bring patience) |
| 17:30 | Pick best takes, cut, voice-over, overlays |
| 19:00 | Export, embed in slide, commit storyboard with final numbers filled in |

If we're behind by 17:00, drop voice-over and overlay polish — a raw cut with no narration is still better than no clip.
