/**
 * Pure-math Gate 1 heuristics. All functions are deterministic, side-effect-free,
 * and take landmarks in / numbers out. The state machine in ../liveness/gate.ts
 * is what consumes these to decide "challenge passed" or not.
 *
 * Thresholds are defined in `shared_contracts/thresholds.json` — keep this file
 * in sync with that contract.
 */

import {
  Point2D,
  Point3D,
  RIGHT_EYE_EAR_INDICES,
  LEFT_EYE_EAR_INDICES,
  MOUTH_MAR_INDICES,
  NOSE_TIP_INDEX,
  RIGHT_EYE_OUTER_INDEX,
  LEFT_EYE_OUTER_INDEX,
} from "./landmarks";

// ────────── distance helpers ──────────

function dist2D(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ────────── EAR (Eye Aspect Ratio) — blink detection ──────────

/**
 * EAR = (||p2 - p6|| + ||p3 - p5||) / (2 * ||p1 - p4||)
 *
 * Typical values:
 *   open eye  : ~0.30
 *   half open : ~0.22
 *   closed eye: ~0.12
 *
 * Threshold (per contract): EAR < 0.20 for >= 3 consecutive frames = blink.
 *
 * Pass a single eye's six points in [outer, top1, top2, inner, bot1, bot2] order.
 */
function earForEye(points: Point2D[]): number {
  if (points.length !== 6) {
    throw new Error(`earForEye expects 6 points, got ${points.length}`);
  }
  const [p1, p2, p3, p4, p5, p6] = points;
  const vertical = dist2D(p2, p6) + dist2D(p3, p5);
  const horizontal = dist2D(p1, p4);
  return vertical / (2 * horizontal + 1e-6);
}

/**
 * Compute the average EAR across both eyes. Cleaner signal than either eye alone.
 * Returns NaN if landmarks are degenerate (caller should reject the frame).
 */
export function computeEAR(landmarks: Point3D[]): number {
  const rightEye = RIGHT_EYE_EAR_INDICES.map((i) => landmarks[i]);
  const leftEye  = LEFT_EYE_EAR_INDICES.map((i) => landmarks[i]);
  const earRight = earForEye(rightEye);
  const earLeft  = earForEye(leftEye);
  return (earRight + earLeft) / 2;
}

// ────────── MAR (Mouth Aspect Ratio) — smile / open mouth ──────────

/**
 * Same shape as EAR but for the mouth.
 *
 * Typical values:
 *   neutral mouth : ~0.20
 *   slight smile  : ~0.35
 *   open mouth    : ~0.55+
 *
 * Threshold (per contract): MAR > 0.50 = smile / open mouth.
 */
export function computeMAR(landmarks: Point3D[]): number {
  const pts = MOUTH_MAR_INDICES.map((i) => landmarks[i]);
  const [p1, p2, p3, p4, p5, p6] = pts;
  const vertical = dist2D(p2, p6) + dist2D(p3, p5);
  const horizontal = dist2D(p1, p4);
  return vertical / (2 * horizontal + 1e-6);
}

// ────────── Simplified Yaw — head turn detection ──────────

/**
 * Estimate head yaw in degrees from 2D landmarks. This is a SIMPLIFIED estimator
 * that uses the asymmetry between left-eye-to-nose and right-eye-to-nose distances.
 * It's not as accurate as solvePnP but requires no OpenCV dependency.
 *
 * Sign convention:
 *   yaw > 0  : user turned head to their LEFT (camera sees more of right cheek)
 *   yaw < 0  : user turned head to their RIGHT
 *   yaw ≈ 0  : facing camera straight on
 *
 * Threshold (per contract): |yaw| > 25° = head-turn challenge passed.
 */
export function computeYawDegrees(landmarks: Point3D[]): number {
  const nose = landmarks[NOSE_TIP_INDEX];
  const rightEye = landmarks[RIGHT_EYE_OUTER_INDEX]; // camera-left side
  const leftEye  = landmarks[LEFT_EYE_OUTER_INDEX];  // camera-right side

  const dRight = dist2D(nose, rightEye);
  const dLeft  = dist2D(nose, leftEye);

  // Ratio: 1.0 = facing camera, > 1 = turned subject-left, < 1 = turned subject-right
  const ratio = dLeft / (dRight + 1e-6);

  // Empirical mapping from ratio to degrees. Calibrated on FaceMesh outputs at
  // ±25° head turn; refine on your devices if needed.
  const yawDegrees = Math.log2(ratio) * 30;
  return yawDegrees;
}

// ────────── Face presence sanity ──────────

/**
 * FaceMesh's second output is a sigmoid logit for "face present".
 * Convert to probability and compare against the threshold from the contract
 * (defaults to 0.5). Reject the frame entirely if no face is detected — none
 * of the other heuristics are meaningful.
 */
export function faceIsPresent(presenceLogit: number, threshold = 0.5): boolean {
  const prob = 1 / (1 + Math.exp(-presenceLogit));
  return prob > threshold;
}
