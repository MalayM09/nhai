#!/usr/bin/env python3
"""
Latency + footprint benchmark for the NHAI biometric Android app.

Runs against any connected Android device via `adb`. Measures:

  1. Cold start time         (am start -W → "TotalTime")
  2. APK on-device size      (pm path → ls -l on the APK file)
  3. Process memory usage    (dumpsys meminfo)
  4. Cascade per-gate timing (logcat parser — expects [BENCH] markers from the
                              app; if Sahil adds them, this script aggregates)

Usage:

    # plug phone in, enable USB debugging, accept the trust prompt
    adb devices                              # confirm device shows up
    python tools/benchmark/benchmark.py

    # specific device, more runs
    python tools/benchmark/benchmark.py --device emulator-5554 --runs 50

Outputs:
  docs/benchmarks/benchmark_<timestamp>.json    machine-readable
  docs/benchmarks/benchmark_<timestamp>.md      paste-ready table for the tech doc

To get cascade per-gate timings the app needs to emit lines that look like:
  [BENCH] gate0_blazeface_ms=12.3
  [BENCH] gate1_facemesh_ms=14.7
  [BENCH] gate2_shufflenet_ms=8.1
  [BENCH] gate3_backbone_ms=42.5
  [BENCH] gate3_adapter_ms=2.1
  [BENCH] gate3_match_ms=0.6
  [BENCH] total_end_to_end_ms=80.3

If the app doesn't emit those, the cascade section of the report is skipped
and we still get cold-start + APK + memory which are the brief's < 1 second
+ ≤ 20 MB compliance evidence anyway.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import statistics
import subprocess
import sys
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
REPORT_DIR = REPO_ROOT / "docs" / "benchmarks"
APP_PACKAGE = "com.nhaibiometric"
APP_ACTIVITY = f"{APP_PACKAGE}/.MainActivity"


# ────────────────────── adb helpers ──────────────────────


def ensure_adb() -> str:
    """Return the path to `adb` or exit with a helpful message."""
    adb = shutil.which("adb")
    if adb is None:
        sys.exit(
            "ERROR: `adb` not found on PATH.\n"
            "Install with:\n"
            "  macOS:    brew install --cask android-platform-tools\n"
            "  Linux:    apt install android-tools-adb\n"
            "  Windows:  https://developer.android.com/tools/releases/platform-tools"
        )
    return adb


def adb_run(args: List[str], device: Optional[str], **kw) -> subprocess.CompletedProcess:
    cmd = ["adb"]
    if device:
        cmd += ["-s", device]
    cmd += args
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def list_devices() -> List[str]:
    out = adb_run(["devices"], device=None).stdout
    devices = []
    for line in out.splitlines()[1:]:
        line = line.strip()
        if line and not line.startswith("*") and "\tdevice" in line:
            devices.append(line.split("\t")[0])
    return devices


# ────────────────────── individual measurements ──────────────────────


def device_info(device: Optional[str]) -> Dict[str, str]:
    """Pull model, manufacturer, OS version, RAM."""

    def getprop(prop: str) -> str:
        return adb_run(["shell", "getprop", prop], device).stdout.strip()

    meminfo = adb_run(["shell", "cat", "/proc/meminfo"], device).stdout
    ram_kb_match = re.search(r"MemTotal:\s+(\d+)\s*kB", meminfo)
    ram_gb = round(int(ram_kb_match.group(1)) / 1024 / 1024, 2) if ram_kb_match else None

    return {
        "manufacturer": getprop("ro.product.manufacturer"),
        "model": getprop("ro.product.model"),
        "android_version": getprop("ro.build.version.release"),
        "sdk_int": getprop("ro.build.version.sdk"),
        "ram_gb": str(ram_gb) if ram_gb else "unknown",
        "abi": getprop("ro.product.cpu.abi"),
    }


def app_installed(device: Optional[str]) -> bool:
    out = adb_run(["shell", "pm", "list", "packages", APP_PACKAGE], device).stdout
    return APP_PACKAGE in out


def apk_size_mb(device: Optional[str]) -> Optional[float]:
    """Read the APK file size from the device — definitive shipped binary size."""
    path_out = adb_run(["shell", "pm", "path", APP_PACKAGE], device).stdout.strip()
    if not path_out.startswith("package:"):
        return None
    apk_path = path_out.split(":", 1)[1].strip()
    size_out = adb_run(["shell", "stat", "-c", "%s", apk_path], device).stdout.strip()
    try:
        bytes_ = int(size_out)
        return round(bytes_ / 1024 / 1024, 2)
    except ValueError:
        return None


def cold_start_ms(device: Optional[str], runs: int = 5) -> Dict[str, float]:
    """Measure cold-start latency from launcher tap to first-frame render.

    Uses `am start -W` which returns TotalTime in its output. Force-stop
    between runs so each measurement is a true cold start.
    """
    samples: List[int] = []
    for i in range(runs):
        adb_run(["shell", "am", "force-stop", APP_PACKAGE], device)
        time.sleep(0.5)
        out = adb_run(["shell", "am", "start", "-W", APP_ACTIVITY], device).stdout
        m = re.search(r"TotalTime:\s+(\d+)", out)
        if m:
            samples.append(int(m.group(1)))
        time.sleep(0.5)
    return summarize(samples)


def memory_snapshot_mb(device: Optional[str]) -> Optional[Dict[str, int]]:
    """Read process memory after the app has been launched."""
    adb_run(["shell", "am", "start", APP_ACTIVITY], device)
    time.sleep(3)
    out = adb_run(["shell", "dumpsys", "meminfo", APP_PACKAGE], device).stdout
    result: Dict[str, int] = {}
    # Lines look like: "                  Native Heap    12345    ..."
    for label_re, key in [
        (r"^\s*TOTAL PSS:\s+(\d+)", "total_pss_kb"),
        (r"^\s*Native Heap\s+(\d+)", "native_heap_kb"),
        (r"^\s*Dalvik Heap\s+(\d+)", "dalvik_heap_kb"),
        (r"^\s*Graphics\s+(\d+)", "graphics_kb"),
    ]:
        m = re.search(label_re, out, re.MULTILINE)
        if m:
            result[key] = int(m.group(1))
    if not result:
        return None
    return {k: round(v / 1024, 2) for k, v in result.items()}  # KB → MB


# ────────────────────── cascade logcat parser ──────────────────────


BENCH_LINE_RE = re.compile(r"\[BENCH\]\s+([a-z0-9_]+)_ms=([\d.]+)")


def tail_logcat_for_bench(device: Optional[str], duration_s: int) -> Dict[str, List[float]]:
    """Tail logcat for `duration_s` seconds, collect [BENCH] markers.

    Returns dict keyed by metric name → list of float ms samples.
    """
    print(
        f"\nTailing logcat for {duration_s}s — run the app NOW and exercise the cascade.\n"
        f"Each cycle of: open scan → blink → see verified → write attendance\n"
        f"contributes one set of samples.\n"
    )
    adb_run(["logcat", "-c"], device)
    proc = subprocess.Popen(
        ["adb"] + (["-s", device] if device else []) + ["logcat", "-v", "raw"],
        stdout=subprocess.PIPE,
        text=True,
    )
    samples: Dict[str, List[float]] = defaultdict(list)
    end = time.time() + duration_s
    try:
        while time.time() < end:
            line = proc.stdout.readline()
            if not line:
                break
            for m in BENCH_LINE_RE.finditer(line):
                samples[m.group(1)].append(float(m.group(2)))
    finally:
        proc.terminate()
    return dict(samples)


# ────────────────────── stats + report formatting ──────────────────────


def summarize(samples: List[float]) -> Dict[str, float]:
    if not samples:
        return {"n": 0, "p50": 0, "p95": 0, "mean": 0, "max": 0}
    samples_sorted = sorted(samples)
    return {
        "n": len(samples),
        "p50": round(statistics.median(samples), 1),
        "p95": round(samples_sorted[max(0, int(len(samples) * 0.95) - 1)], 1),
        "mean": round(statistics.mean(samples), 1),
        "max": round(max(samples), 1),
    }


def write_markdown_report(report: dict, path: Path) -> None:
    lines: List[str] = []
    lines.append("# Latency + Footprint Benchmark")
    lines.append("")
    lines.append(f"_Measured: {report['measured_at']}_")
    lines.append("")
    lines.append("## Device")
    lines.append("")
    info = report["device"]
    lines.append(f"- **Model:** {info['manufacturer']} {info['model']}")
    lines.append(f"- **Android:** {info['android_version']} (SDK {info['sdk_int']})")
    lines.append(f"- **RAM:** {info['ram_gb']} GB")
    lines.append(f"- **ABI:** {info['abi']}")
    lines.append("")

    apk = report.get("apk_size_mb")
    if apk is not None:
        cap = 20.0
        lines.append("## APK size")
        lines.append("")
        lines.append(f"- On-device APK: **{apk:.2f} MB**")
        lines.append(f"- Brief's bundle cap (models): {cap} MB")
        lines.append("")

    cs = report.get("cold_start_ms", {})
    if cs.get("n"):
        lines.append("## Cold-start latency (launcher tap → first frame)")
        lines.append("")
        lines.append("| Metric | Value |")
        lines.append("| --- | --- |")
        lines.append(f"| p50 | {cs['p50']} ms |")
        lines.append(f"| p95 | {cs['p95']} ms |")
        lines.append(f"| mean | {cs['mean']} ms |")
        lines.append(f"| max | {cs['max']} ms |")
        lines.append(f"| samples | {cs['n']} |")
        lines.append("")

    mem = report.get("memory_mb")
    if mem:
        lines.append("## Process memory (right after launch)")
        lines.append("")
        lines.append("| Region | MB |")
        lines.append("| --- | --- |")
        for k, v in mem.items():
            lines.append(f"| {k.replace('_kb','').replace('_',' ')} | {v} |")
        lines.append("")

    cascade = report.get("cascade", {})
    if cascade:
        lines.append("## Cascade per-gate latency (from app [BENCH] markers)")
        lines.append("")
        lines.append("| Stage | n | p50 ms | p95 ms | mean ms | max ms |")
        lines.append("| --- | ---: | ---: | ---: | ---: | ---: |")
        # Sort by suggested stage order
        order = [
            "gate0_blazeface", "gate1_facemesh",
            "gate2_shufflenet",
            "gate3_backbone", "gate3_adapter", "gate3_match",
            "total_end_to_end",
        ]
        seen = set()
        for key in order + sorted(cascade.keys()):
            if key in seen or key not in cascade:
                continue
            seen.add(key)
            s = cascade[key]
            lines.append(
                f"| {key} | {s['n']} | {s['p50']} | {s['p95']} | {s['mean']} | {s['max']} |"
            )
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## Briefly compliance check")
    lines.append("")
    apk_ok = (apk is not None and apk <= 20)
    total = cascade.get("total_end_to_end", {}) if cascade else {}
    sub_1s = total.get("p95", 999) < 1000 if total else None
    lines.append(f"- Bundle ≤ 20 MB: {'✅' if apk_ok else '⚠️ check'}")
    if sub_1s is None:
        lines.append("- Total inference < 1 s: ⚠️ no [BENCH] markers received — instrument the app to emit them")
    else:
        lines.append(f"- Total inference < 1 s (p95): {'✅' if sub_1s else '❌'}")
    lines.append("")
    path.write_text("\n".join(lines))


# ────────────────────── main ──────────────────────


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--device", help="adb device serial (omit if only one connected)")
    p.add_argument("--runs", type=int, default=5, help="cold-start launches (default 5)")
    p.add_argument(
        "--logcat-seconds",
        type=int,
        default=120,
        help="how long to tail logcat for [BENCH] markers (default 120)",
    )
    p.add_argument(
        "--skip-cascade",
        action="store_true",
        help="don't tail logcat; only do cold-start + APK + memory",
    )
    args = p.parse_args()

    ensure_adb()

    devices = list_devices()
    if not devices:
        sys.exit("ERROR: no adb devices. Plug a phone in and enable USB debugging.")

    if args.device and args.device not in devices:
        sys.exit(f"ERROR: device {args.device} not in {devices}")

    device = args.device or devices[0]
    print(f"Using device: {device}")

    if not app_installed(device):
        sys.exit(
            f"ERROR: app {APP_PACKAGE} not installed on {device}.\n"
            "Run `npx react-native run-android` first, or manually `adb install path/to/app-debug.apk`."
        )

    print("Reading device info...")
    info = device_info(device)

    print("Measuring APK size...")
    apk = apk_size_mb(device)

    print(f"Measuring cold start ({args.runs} runs)...")
    cold = cold_start_ms(device, runs=args.runs)

    print("Snapshotting memory...")
    mem = memory_snapshot_mb(device)

    cascade: Dict[str, Dict[str, float]] = {}
    if not args.skip_cascade:
        raw_samples = tail_logcat_for_bench(device, duration_s=args.logcat_seconds)
        cascade = {k: summarize(v) for k, v in raw_samples.items()}
        if not raw_samples:
            print(
                "\nNo [BENCH] markers received. Either:\n"
                "  • the app doesn't emit them yet (Sahil: add `console.log('[BENCH] ...')` lines)\n"
                "  • the app wasn't exercised during the logcat window\n"
                "Skipping the cascade section of the report."
            )

    report = {
        "measured_at": datetime.now().isoformat(),
        "device": info,
        "apk_size_mb": apk,
        "cold_start_ms": cold,
        "memory_mb": mem,
        "cascade": cascade,
    }

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = REPORT_DIR / f"benchmark_{ts}.json"
    md_path = REPORT_DIR / f"benchmark_{ts}.md"
    json_path.write_text(json.dumps(report, indent=2))
    write_markdown_report(report, md_path)

    print(f"\nWrote:\n  {json_path}\n  {md_path}\n")
    print("--- Quick summary ---")
    print(f"  Device:     {info['manufacturer']} {info['model']} ({info['ram_gb']} GB)")
    if apk is not None:
        print(f"  APK size:   {apk:.2f} MB")
    if cold.get("n"):
        print(f"  Cold start: p50 {cold['p50']} ms, p95 {cold['p95']} ms")
    if cascade.get("total_end_to_end"):
        t = cascade["total_end_to_end"]
        print(f"  E2E total:  p50 {t['p50']} ms, p95 {t['p95']} ms ({t['n']} samples)")


if __name__ == "__main__":
    main()
