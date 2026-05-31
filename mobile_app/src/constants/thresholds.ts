/**
 * Frozen thresholds mirrored from shared_contracts/thresholds.json.
 *
 * DO NOT EDIT VALUES HERE. Change shared_contracts/thresholds.json first,
 * then propagate to this file. Both ML and Mobile owners must sign off on
 * any contract change (see shared_contracts/README.md).
 */

// ---- Match threshold -------------------------------------------------------
/** Metric: cosine DISTANCE (not similarity). Range [0, 2]. */
export const MATCH_THRESHOLD_METRIC = 'cosine_distance' as const;
/**
 * A pair matches if cosineDistance(a, b) < MATCH_THRESHOLD_VALUE.
 * Lower = more similar. Placeholder pending EER calibration from ML pipeline.
 */
export const MATCH_THRESHOLD_VALUE = 0.40;

// ---- Liveness (Gate 2) -----------------------------------------------------
/** Reject frame if ShuffleNet spoof probability exceeds this value. */
export const LIVENESS_SPOOF_REJECT_PROB = 0.5;

// ---- Gate 1 heuristics -----------------------------------------------------
export const EAR_BLINK_MAX = 0.2;
export const EAR_BLINK_CONSECUTIVE_FRAMES = 3;
export const MAR_SMILE_MIN = 0.5;
/** Degrees of Yaw shift that constitutes a head turn (PnP). */
export const PNP_YAW_TURN_DEGREES = 25;
/** Minimum Laplacian variance to accept a frame as sharp enough. */
export const LAPLACIAN_VARIANCE_MIN = 60;

// ---- Frame pipeline --------------------------------------------------------
export const CAMERA_RESOLUTION = '480p' as const;
/** Frames per second while idle (no active challenge). */
export const THROTTLE_IDLE_FPS = 10;
/** Frames per second during an active challenge prompt (e.g. "Blink"). */
export const THROTTLE_ACTIVE_CHALLENGE_FPS = 30;
export const MAX_INFERENCE_MS = 1000;
export const TARGET_INFERENCE_MS = 450;
export const WARMUP_ON_SPLASH = true;

// ---- Enrollment ------------------------------------------------------------
export const ENROLLMENT_SHOTS_MIN = 3;
export const ENROLLMENT_SHOTS_MAX = 5;
