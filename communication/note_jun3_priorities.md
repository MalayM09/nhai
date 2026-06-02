# Jun 3 morning priorities + tonight's status dump

**Time written:** Jun 2 late evening.  
**Audience:** me (Malay) tomorrow morning when I'm groggy, and Sahil when he reads it.

---

## Done tonight (Jun 2 evening — T+0 → +4 hrs)

| | Output |
| --- | --- |
| Sent message to Sahil with wiring-diff link + 8 AM sync ask | (sent via texts) |
| `git pull` — already on latest | `d58de32` |
| `cd mobile_app && npm install --no-audit --no-fund` | 961 packages, 46 s, exit 0 |
| `npx tsc --noEmit` | **4 errors** (see below) |
| Drafted `docs/pitch_outline.md` | 5 slides + appendix, full speaker notes |
| Drafted `docs/tech_doc_outline.md` | 6 sections, ~10–12 pages target |
| Brain-dumped this file | you are reading it |

---

## TypeScript errors that need fixing tomorrow

`mobile_app/` cleanly type-checked except for 4 errors. They're all in Sahil's files. Not runtime blockers — the app probably builds and runs — but they should be cleaned up before submission.

| Location | Error | Likely fix |
| --- | --- | --- |
| `src/screens/EnrollmentScreen.tsx:252` | `Type '"rgba"' is not assignable to type '"yuv" \| "rgb" \| undefined'` | Change `pixelFormat="rgba"` → `pixelFormat="rgb"` — the vision-camera 4.x API dropped `rgba` |
| `src/screens/ScanScreen.tsx:302` | `Type 'Frame' is not assignable to type 'TypedArray'` | A `Frame` is being passed where a TypedArray is wanted. Likely needs `frame.toArrayBuffer()` or a cast; check vision-camera 4.x frame processor API |
| `src/screens/ScanScreen.tsx:319` | Same as 302 | Same fix |
| `src/screens/ScanScreen.tsx:461` | `Type '"rgba"' is not assignable to type '"yuv" \| "rgb" \| undefined'` | Same as 252 — change to `"rgb"` |

**For the morning sync:** ask Sahil whether his local build / `react-native run-android` succeeds despite these TS errors. If yes, the fixes are cosmetic. If no, line 302/319's Frame→TypedArray issue may be why the worklet doesn't actually feed pixels into FaceMesh ("runs on zero tensors" from his Phase 1 note).

---

## Priorities for 8 AM standup

In order. Don't deviate without good reason.

1. **Did Sahil pull + apply the wiring diff?**  
   He has [`communication/note_phase2_wiring.md`](note_phase2_wiring.md) and [`mobile_app/src/heuristics/faceMeshIO.ts`](../mobile_app/src/heuristics/faceMeshIO.ts) + [`mobile_app/src/utils/composedEmbedding.ts`](../mobile_app/src/utils/composedEmbedding.ts). If he applied the diff, Gate 1 should now process real FaceMesh landmarks instead of stubs.

2. **Does the app boot on a real Android phone?**  
   The Milestone 1 of the 36-hour schedule. Nothing else matters until this is green.

3. **Are the 4 TS errors blocking the build, or just cosmetic?**  
   If blocking → fix together this morning. If cosmetic → defer to evening polish.

4. **Status on SQLCipher.**  
   He has the SQLite layer; SQLCipher is a swap of one `open()` call. Asked about it in the Jun 3 1pm block.

5. **Latency benchmark plan.**  
   Which phones, what script, who runs it. We measure Jun 3 evening.

---

## My (Malay's) Jun 3 commitments

| Block | Task |
| --- | --- |
| Morning | Designed pitch deck slides 1–3 in Slides/Keynote based on the outline. Architecture diagram clean export. |
| Afternoon | Technical doc draft v1 (sections 1, 2, 3, 5). Sections 4 (benchmarks) and 6 (limitations) wait for Jun 4 numbers. |
| Evening | Latency benchmark script (Python that drives `adb shell am instrument` or similar) + run on whatever device is online. |

---

## Risks I'm watching

| Risk | Mitigation |
| --- | --- |
| Sahil unreachable past 8 AM | Take ownership of the wiring diff myself; ship Android only |
| `react-native run-android` build fails due to the Frame→TypedArray TS error | Pair with him on it at 8:30 AM; if not resolved by 10 AM, downgrade vision-camera or pin a known-working version |
| iOS pod install can't happen on either machine | Drop iOS scope, submit Android-only with explicit "iOS scaffold ready, pod install at site of deployment" in tech doc |
| Phone unavailable for testing | Borrow / rent / emulate. Submission lives or dies on the demo video. |
| TS errors prevent build entirely | Fix in morning; revert his bad files and re-wire if needed |

---

## What's NOT a priority tomorrow

Don't get drawn into these — they cost time and don't move the score:

- Native C++ ports of any kind
- Optimization beyond what the brief requires
- Adding a new heuristic (we have enough)
- Re-training any model
- Switching datasets
- Reading more documentation than necessary

---

## Files referenced by the morning sync

- This note: [`communication/note_jun3_priorities.md`](note_jun3_priorities.md)
- Schedule: pitch / tech doc / wiring note above
- TS errors are in `src/screens/EnrollmentScreen.tsx` + `src/screens/ScanScreen.tsx`
- Sahil's status: [`communication/note_phase1_mobile.md`](note_phase1_mobile.md)
- Wiring diff: [`communication/note_phase2_wiring.md`](note_phase2_wiring.md)
- Pitch outline: [`docs/pitch_outline.md`](../docs/pitch_outline.md)
- Tech doc outline: [`docs/tech_doc_outline.md`](../docs/tech_doc_outline.md)
