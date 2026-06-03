# Latency + Footprint Benchmark

Single Python script that drives `adb` to measure the four things the brief grades us on:

1. **Bundle size on device** (≤ 20 MB cap)
2. **Cold start** (launcher tap → first frame)
3. **Process memory** (right after launch)
4. **Cascade per-gate latency** (< 1 s end-to-end)

## Prerequisites

- Android phone with USB debugging enabled, plugged in via USB
- `adb` on PATH (`brew install --cask android-platform-tools` on macOS)
- App installed (`npx react-native run-android` from `mobile_app/`)
- (Optional) the app emits `[BENCH] <metric>_ms=<float>` lines to logcat — without these the cascade section of the report is skipped but cold-start + APK + memory are still measured

## Run

```bash
# from repo root
python tools/benchmark/benchmark.py
```

Common flags:

```bash
# specific device when multiple are connected
python tools/benchmark/benchmark.py --device emulator-5554

# more cold-start samples
python tools/benchmark/benchmark.py --runs 20

# skip the cascade tail (just APK + cold start + memory)
python tools/benchmark/benchmark.py --skip-cascade

# longer logcat window if you need time to actually run the demo
python tools/benchmark/benchmark.py --logcat-seconds 300
```

## What the script writes

- `docs/benchmarks/benchmark_<timestamp>.json` — machine-readable, full data
- `docs/benchmarks/benchmark_<timestamp>.md` — paste-ready markdown table for the technical doc

Both timestamped so you can run on multiple devices and keep the reports side by side.

## Adding the `[BENCH]` markers in the app (Sahil — this is for you)

The cascade latency section depends on the app emitting structured logcat lines. Drop these `console.log` calls into the frame processor and `runDetectionOnFrame` paths:

```typescript
// In the frame processor worklet, around the BlazeFace call:
const t0 = performance.now();
const bfOut = blazeface.model.runSync([preprocessedTensor]);
console.log(`[BENCH] gate0_blazeface_ms=${(performance.now() - t0).toFixed(2)}`);

// Around FaceMesh:
const t1 = performance.now();
const fmOut = facemesh.model.runSync([preprocessedTensor]);
console.log(`[BENCH] gate1_facemesh_ms=${(performance.now() - t1).toFixed(2)}`);

// In runDetectionOnFrame, around ShuffleNet:
const t2 = performance.now();
const livenessOut = shufflenet.model.runSync([livenessInput]);
console.log(`[BENCH] gate2_shufflenet_ms=${(performance.now() - t2).toFixed(2)}`);

// Around backbone + adapter + match:
const t3 = performance.now();
// ... backbone runSync ...
console.log(`[BENCH] gate3_backbone_ms=${(performance.now() - t3).toFixed(2)}`);

const t4 = performance.now();
// ... adapter runSync ...
console.log(`[BENCH] gate3_adapter_ms=${(performance.now() - t4).toFixed(2)}`);

const t5 = performance.now();
// ... findBestMatch ...
console.log(`[BENCH] gate3_match_ms=${(performance.now() - t5).toFixed(2)}`);

// End to end (from Gate 0 → match decision):
console.log(`[BENCH] total_end_to_end_ms=${(performance.now() - t0).toFixed(2)}`);
```

The script parses these lines via a single regex (`\[BENCH\] ([a-z0-9_]+)_ms=([\d.]+)`) and aggregates p50, p95, mean, max per metric over the logcat window.

You can ship these markers in release builds too — they're just stdlib `console.log` calls. If you want to gate them on a debug build, wrap in `if (__DEV__) { ... }`.

## Manual flow during benchmark

1. Plug phone in. Verify `adb devices` shows it.
2. From repo root: `python tools/benchmark/benchmark.py`
3. Script measures cold start automatically (5 forced-restart cycles).
4. After cold start finishes, you have **120 seconds** of logcat tailing.
5. During those 120 seconds: open the app, enroll once, then run scan → blink → verify, several times.
6. Each cycle of scan→verified emits one set of `[BENCH]` markers.
7. Script writes the report when the window closes.

## Sample interpretation

```markdown
| Stage | n | p50 ms | p95 ms | mean ms | max ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| gate0_blazeface | 87 | 8.2 | 11.5 | 8.9 | 14.1 |
| gate1_facemesh | 87 | 12.4 | 15.8 | 12.7 | 18.0 |
| gate2_shufflenet | 12 | 6.5 | 8.1 | 6.7 | 8.5 |
| gate3_backbone | 12 | 38.2 | 45.0 | 39.1 | 47.3 |
| gate3_adapter | 12 | 1.8 | 2.4 | 1.9 | 2.7 |
| gate3_match | 12 | 0.4 | 0.6 | 0.4 | 0.7 |
| total_end_to_end | 12 | 75.6 | 89.0 | 78.2 | 95.1 |
```

Notes:
- Gate 0 + Gate 1 fire MANY times (one per processed camera frame, ~10–30 fps throttled)
- Gates 2 + 3 fire ONCE per cascade pass (only on the frame that passed Gate 1)
- Total end-to-end (p95) is the headline number for the brief's "< 1 second" requirement

## Re-running

The script is idempotent. Run it as many times as you want; each run gets a new timestamped file in `docs/benchmarks/`. The last one you commit is the one we cite in the pitch deck and technical doc.
