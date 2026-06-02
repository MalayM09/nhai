/**
 * MediaPipe FaceMesh landmark indices used by Gate 1 heuristics.
 *
 * FaceMesh produces 468 landmarks. We only need a small subset for EAR (eye
 * aspect ratio), MAR (mouth aspect ratio), and a simplified Yaw estimator.
 *
 * Reference: https://github.com/google/mediapipe/blob/master/mediapipe/python/solutions/face_mesh_connections.py
 *
 * Note on left/right naming: "LEFT" here means the SUBJECT'S left (camera's
 * right side). When the user turns their head to their left, the LEFT_EYE
 * landmarks move toward the nose.
 */

// Six-point EAR — Soukupová & Čech 2016
// Order: outer-corner, top-1, top-2, inner-corner, bottom-2, bottom-1
export const RIGHT_EYE_EAR_INDICES = [33, 160, 158, 133, 153, 144] as const; // camera-left side of the face
export const LEFT_EYE_EAR_INDICES  = [263, 387, 385, 362, 380, 373] as const; // camera-right side of the face

// Six-point MAR — analogous to EAR but on the mouth
// Order: outer corner, top-1, top-2, inner corner, bottom-2, bottom-1
export const MOUTH_MAR_INDICES = [61, 39, 0, 291, 17, 84] as const;

// Key landmarks for simplified Yaw estimation (no PnP / OpenCV needed)
export const NOSE_TIP_INDEX         = 4;
export const RIGHT_EYE_OUTER_INDEX  = 33;   // outer corner of subject's right eye (camera left)
export const LEFT_EYE_OUTER_INDEX   = 263;  // outer corner of subject's left eye  (camera right)

// Face bounding (rough) for normalizing distances
export const FOREHEAD_INDEX = 10;
export const CHIN_INDEX     = 152;

export type Point2D = { x: number; y: number };
export type Point3D = { x: number; y: number; z: number };

/**
 * FaceMesh's TFLite output is [1, 1, 1, 1404] in pixel space relative to its
 * 192x192 input. The mobile JSI processor must squeeze the unit dims and
 * reshape to (468, 3) before passing here. Rescale x and y back to the
 * original face-crop dimensions if you need pixel-accurate coordinates;
 * for our ratio-based heuristics (EAR/MAR) the relative coordinates suffice.
 */
export function reshapeFaceMeshOutput(flat: Float32Array): Point3D[] {
  if (flat.length !== 1404) {
    throw new Error(`FaceMesh output expected 1404 floats, got ${flat.length}`);
  }
  const landmarks: Point3D[] = new Array(468);
  for (let i = 0; i < 468; i++) {
    landmarks[i] = {
      x: flat[i * 3 + 0],
      y: flat[i * 3 + 1],
      z: flat[i * 3 + 2],
    };
  }
  return landmarks;
}

// ────────── landmark subset extractors (for direct callers / testing) ──────────

/**
 * Pull out the 6-point EAR landmark subset for one eye.
 * Caller decides which side — these are the SUBJECT's left or right.
 */
export function extractEyePoints(
  landmarks: Point3D[],
  side: "left" | "right",
): Point3D[] {
  const idxs = side === "left" ? LEFT_EYE_EAR_INDICES : RIGHT_EYE_EAR_INDICES;
  return idxs.map((i) => landmarks[i]);
}

/**
 * Pull out the 6-point MAR landmark subset (mouth contour).
 */
export function extractMouthPoints(landmarks: Point3D[]): Point3D[] {
  return MOUTH_MAR_INDICES.map((i) => landmarks[i]);
}

/**
 * Pull out the 3 key landmarks the simplified yaw estimator uses
 * (nose tip + both outer eye corners). Useful when you want to inspect or
 * log them without re-running the full yaw computation.
 */
export function extractYawAnchors(landmarks: Point3D[]): {
  noseTip: Point3D;
  rightEyeOuter: Point3D;
  leftEyeOuter: Point3D;
} {
  return {
    noseTip: landmarks[NOSE_TIP_INDEX],
    rightEyeOuter: landmarks[RIGHT_EYE_OUTER_INDEX],
    leftEyeOuter: landmarks[LEFT_EYE_OUTER_INDEX],
  };
}
