/**
 * Gate 1 — Cascading heuristic checks.
 *
 * Architecture (from shared_contracts/README.md):
 *   Gate 1 (heuristics, this file) → Gate 2 (ShuffleNet liveness) → Gate 3 (MobileFaceNet identity)
 *
 * Neural nets only fire when cheap heuristics pass. Gate 1 is deterministic,
 * zero-memory, and runs entirely in JS/native without model inference.
 *
 * Thresholds come from src/constants/thresholds.ts (mirrored from
 * shared_contracts/thresholds.json). Never hardcode a numeric constant here.
 */

import {
  EAR_BLINK_MAX,
  EAR_BLINK_CONSECUTIVE_FRAMES,
  MAR_SMILE_MIN,
  PNP_YAW_TURN_DEGREES,
  LAPLACIAN_VARIANCE_MIN,
} from '../constants/thresholds';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 2D landmark point from FaceMesh output. */
export type Landmark2D = {x: number; y: number};

/** Subset of FaceMesh 468 landmarks we care about for Gate 1. */
export interface FaceLandmarks {
  /** Left eye: [p1..p6] in MediaPipe FaceMesh order */
  leftEye: Landmark2D[];
  /** Right eye: [p1..p6] in MediaPipe FaceMesh order */
  rightEye: Landmark2D[];
  /** Outer + inner lip contour points for MAR */
  mouth: Landmark2D[];
}

export type Challenge = 'blink' | 'smile' | 'look_left' | 'look_right';

export interface GateResult {
  passed: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Laplacian variance (IMPLEMENTED — this is the quality gate)
// ---------------------------------------------------------------------------

/**
 * Compute the variance of the Laplacian of a grayscale image.
 * A low value means the image is blurry — reject before embedding.
 *
 * In Phase 1 this runs in JS on a downsampled pixel array. In Phase 2,
 * move this into the C++ JSI frame processor (one OpenCV call) for speed.
 *
 * @param grayPixels  Flat Uint8 array of grayscale pixel values (row-major).
 * @param width       Image width in pixels.
 * @param height      Image height in pixels.
 * @returns           Laplacian variance (≥ LAPLACIAN_VARIANCE_MIN = 60 passes).
 */
export function laplacianVariance(
  grayPixels: Uint8Array,
  width: number,
  height: number,
): number {
  // 3×3 Laplacian kernel:  0  1  0 / 1 -4  1 / 0  1  0
  const lap: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const v =
        grayPixels[idx - width] +
        grayPixels[idx - 1] +
        -4 * grayPixels[idx] +
        grayPixels[idx + 1] +
        grayPixels[idx + width];
      lap.push(v);
    }
  }
  if (lap.length === 0) return 0;
  const mean = lap.reduce((s, v) => s + v, 0) / lap.length;
  const variance =
    lap.reduce((s, v) => s + (v - mean) ** 2, 0) / lap.length;
  return variance;
}

/**
 * Gate 1 quality check: reject blurry frames before they reach Gates 2/3.
 * Threshold from shared_contracts: LAPLACIAN_VARIANCE_MIN = 60.
 */
export function checkFrameQuality(
  grayPixels: Uint8Array,
  width: number,
  height: number,
): GateResult {
  const variance = laplacianVariance(grayPixels, width, height);
  if (variance < LAPLACIAN_VARIANCE_MIN) {
    return {passed: false, reason: `blurry (variance=${variance.toFixed(1)})`};
  }
  return {passed: true};
}

// ---------------------------------------------------------------------------
// EAR — Eye Aspect Ratio (blink detection)
// ---------------------------------------------------------------------------

/** Euclidean distance between two 2D landmarks. */
function dist(a: Landmark2D, b: Landmark2D): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Eye Aspect Ratio for one eye.
 * EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
 *
 * Landmark ordering follows MediaPipe FaceMesh (6-point eye contour).
 * Stub: returns 0.3 (open) — wire to real FaceMesh output in Phase 2.
 *
 * @param eye  6 landmarks: [outer, top-outer, top-inner, inner, bot-inner, bot-outer]
 */
export function eyeAspectRatio(eye: Landmark2D[]): number {
  if (eye.length < 6) {
    // TODO Phase 2: throw; for now return open-eye value
    return 0.3;
  }
  const vertical1 = dist(eye[1], eye[5]);
  const vertical2 = dist(eye[2], eye[4]);
  const horizontal = dist(eye[0], eye[3]);
  if (horizontal < 1e-6) return 0;
  return (vertical1 + vertical2) / (2 * horizontal);
}

/** State for EAR consecutive-frame blink detection. */
export interface EarState {
  consecutiveLowFrames: number;
}

/**
 * Update EAR state. Returns true when a valid blink is detected
 * (EAR below threshold for ≥ EAR_BLINK_CONSECUTIVE_FRAMES frames).
 */
export function updateEarState(
  state: EarState,
  leftEye: Landmark2D[],
  rightEye: Landmark2D[],
): boolean {
  const avgEar = (eyeAspectRatio(leftEye) + eyeAspectRatio(rightEye)) / 2;
  if (avgEar < EAR_BLINK_MAX) {
    state.consecutiveLowFrames++;
  } else {
    state.consecutiveLowFrames = 0;
  }
  return state.consecutiveLowFrames >= EAR_BLINK_CONSECUTIVE_FRAMES;
}

// ---------------------------------------------------------------------------
// MAR — Mouth Aspect Ratio (smile / open-mouth detection)
// ---------------------------------------------------------------------------

/**
 * Mouth Aspect Ratio: vertical lip opening / horizontal lip width.
 * Stub: returns 0.3 (closed) — wire to real FaceMesh landmarks in Phase 2.
 *
 * @param mouth  Lip landmarks: at minimum [left-corner, top, right-corner, bottom]
 */
export function mouthAspectRatio(mouth: Landmark2D[]): number {
  if (mouth.length < 4) {
    return 0.3; // TODO Phase 2: wire real landmarks
  }
  const horizontal = dist(mouth[0], mouth[2]);
  const vertical = dist(mouth[1], mouth[3]);
  if (horizontal < 1e-6) return 0;
  return vertical / horizontal;
}

export function checkMar(mouth: Landmark2D[]): GateResult {
  const mar = mouthAspectRatio(mouth);
  if (mar > MAR_SMILE_MIN) {
    return {passed: true};
  }
  return {passed: false, reason: `MAR too low (${mar.toFixed(2)} < ${MAR_SMILE_MIN})`};
}

// ---------------------------------------------------------------------------
// PnP Yaw — Head turn detection (Perspective-n-Point)
// ---------------------------------------------------------------------------

/**
 * Placeholder for PnP Euler-angle head-pose estimation.
 *
 * Real implementation: OpenCV solvePnP with the standard 6-point 3D face model
 * (nose tip, chin, eye corners, mouth corners) against their FaceMesh 2D
 * counterparts. Returns Yaw in degrees.
 *
 * TODO Phase 2: implement in C++ JSI frame processor plugin using OpenCV.
 * Returns 0 (facing forward) as a stub.
 */
export function computePnPYaw(
  _landmarks: FaceLandmarks,
  _frameWidth: number,
  _frameHeight: number,
): number {
  // Stub — replace with native solvePnP call in Phase 2
  return 0;
}

/**
 * Check whether the user's head has turned by ≥ PNP_YAW_TURN_DEGREES.
 * @param baselineYaw  Yaw captured when challenge started.
 * @param currentYaw   Yaw of current frame.
 */
export function checkYawTurn(baselineYaw: number, currentYaw: number): GateResult {
  const delta = Math.abs(currentYaw - baselineYaw);
  if (delta >= PNP_YAW_TURN_DEGREES) {
    return {passed: true};
  }
  return {
    passed: false,
    reason: `yaw delta ${delta.toFixed(1)}° < ${PNP_YAW_TURN_DEGREES}°`,
  };
}

// ---------------------------------------------------------------------------
// Challenge state machine
// ---------------------------------------------------------------------------

/**
 * Gate 1 orchestrator: given the active challenge, decide whether the
 * current frame passes Gate 1.
 *
 * Returns { passed: true } only when the challenge-specific condition is met
 * AND the frame is not blurry (Laplacian variance ≥ 60).
 *
 * @param challenge        Active liveness challenge.
 * @param earState         Mutable EAR state (updated in-place).
 * @param landmarks        FaceMesh landmarks for current frame.
 * @param yawBaseline      Yaw at challenge start (for head-turn challenges).
 * @param currentYaw       PnP yaw of current frame.
 * @param grayPixels       Grayscale face-crop pixels for Laplacian check.
 * @param cropW            Face-crop width.
 * @param cropH            Face-crop height.
 */
export function runGate1(
  challenge: Challenge,
  earState: EarState,
  landmarks: FaceLandmarks,
  yawBaseline: number,
  currentYaw: number,
  grayPixels: Uint8Array,
  cropW: number,
  cropH: number,
): GateResult {
  // Quality gate first — free, prevents blurry frames poisoning templates
  const quality = checkFrameQuality(grayPixels, cropW, cropH);
  if (!quality.passed) return quality;

  switch (challenge) {
    case 'blink': {
      const blinkDetected = updateEarState(
        earState,
        landmarks.leftEye,
        landmarks.rightEye,
      );
      return blinkDetected
        ? {passed: true}
        : {passed: false, reason: 'waiting for blink'};
    }
    case 'smile':
      return checkMar(landmarks.mouth);
    case 'look_left':
    case 'look_right': {
      const result = checkYawTurn(yawBaseline, currentYaw);
      if (challenge === 'look_right') {
        // For look_right we need negative yaw delta (turn right)
        const rawDelta = currentYaw - yawBaseline;
        return Math.abs(rawDelta) >= PNP_YAW_TURN_DEGREES
          ? {passed: true}
          : result;
      }
      return result;
    }
  }
}
