/**
 * Gate 1 — Heuristic liveness state machine.
 *
 * Wraps the math from ../heuristics/math.ts into a frame-driven state machine.
 * The mobile JSI camera processor calls `onFrame(landmarks, presenceLogit)` once
 * per processed frame. The gate manages the challenge prompt, tracks consecutive-
 * frame conditions (e.g. blink = 3 frames of low EAR), and reports the gate
 * decision to the rest of the app.
 *
 * State diagram:
 *
 *                          ┌──────────────────┐
 *                          │   IDLE           │ ← face not present
 *                          └────────┬─────────┘
 *                                   │ face appears
 *                                   ▼
 *                          ┌──────────────────┐
 *                          │   CHALLENGED     │ ← randomized prompt active
 *                          └────────┬─────────┘
 *                                   │ user completes challenge
 *                                   ▼
 *                          ┌──────────────────┐
 *                          │   GATE_1_PASSED  │ → Gate 2 (ShuffleNet) takes over
 *                          └──────────────────┘
 *                                   │ timeout / fallback
 *                                   ▼
 *                          ┌──────────────────┐
 *                          │   FAILED         │ → show retry UI
 *                          └──────────────────┘
 *
 * Use:
 *   const gate = new LivenessGate({ thresholds });
 *   // per camera frame:
 *   const result = gate.onFrame(landmarks, presenceLogit);
 *   if (result.state === "GATE_1_PASSED") { proceed to Gate 2 }
 *   if (result.prompt) renderPromptUI(result.prompt);
 */

import {
  computeEAR,
  computeMAR,
  computeYawDegrees,
  faceIsPresent,
} from "../heuristics/math";
import type { Point3D } from "../heuristics/landmarks";

// Mirrors `shared_contracts/thresholds.json` heuristics block. The mobile loader
// should read that file at build time; defaults here are the contract values
// as of 2026-06-02.
export type GateThresholds = {
  earBlinkMax: number;
  earBlinkConsecutiveFrames: number;
  marSmileMin: number;
  pnpYawTurnDegrees: number;
  challengeTimeoutMs: number;
  // optional: face-presence confidence cutoff
  facePresenceMin: number;
};

export const DEFAULT_THRESHOLDS: GateThresholds = {
  earBlinkMax: 0.2,
  earBlinkConsecutiveFrames: 3,
  marSmileMin: 0.5,
  pnpYawTurnDegrees: 25,
  challengeTimeoutMs: 8000,
  facePresenceMin: 0.5,
};

export type Challenge = "BLINK" | "SMILE" | "TURN_LEFT" | "TURN_RIGHT";

export type GateState =
  | "IDLE"
  | "CHALLENGED"
  | "GATE_1_PASSED"
  | "FAILED";

export type FrameResult = {
  state: GateState;
  prompt: string | null;
  currentChallenge: Challenge | null;
  metrics: {
    ear: number | null;
    mar: number | null;
    yawDegrees: number | null;
  };
};

const PROMPT_TEXTS: Record<Challenge, string> = {
  BLINK: "Blink your eyes",
  SMILE: "Smile",
  TURN_LEFT: "Turn your head to your left",
  TURN_RIGHT: "Turn your head to your right",
};

// Pseudo-random challenge picker. Deliberately not crypto-grade — randomness only
// matters to defeat replay attacks where the attacker pre-records the user's
// response. For that, anything non-deterministic per session is fine.
function pickChallenge(allowed: Challenge[]): Challenge {
  return allowed[Math.floor(Math.random() * allowed.length)];
}

export class LivenessGate {
  private state: GateState = "IDLE";
  private currentChallenge: Challenge | null = null;
  private challengeStartedAt: number | null = null;

  // EAR consecutive-frame counter for blink detection
  private earLowStreak = 0;

  // Per-frame conditions tracked across the challenge window
  private observedBlink = false;
  private observedSmile = false;
  private observedYawLeft = false;
  private observedYawRight = false;

  // Allowed challenges (sunglasses fallback can disable BLINK)
  private allowedChallenges: Challenge[] = ["BLINK", "SMILE", "TURN_LEFT", "TURN_RIGHT"];

  constructor(private thresholds: GateThresholds = DEFAULT_THRESHOLDS) {}

  /**
   * Drop the BLINK challenge when the BlazeFace bounding box is darker than
   * expected (suggesting sunglasses). Caller decides when to flip this — the
   * gate just respects the constraint.
   */
  public excludeBlinkChallenge(): void {
    this.allowedChallenges = this.allowedChallenges.filter((c) => c !== "BLINK");
    if (this.currentChallenge === "BLINK") {
      this.currentChallenge = pickChallenge(this.allowedChallenges);
      this.challengeStartedAt = Date.now();
    }
  }

  /**
   * Hard reset. Call this when the user manually retries or the app navigates
   * back to the auth screen.
   */
  public reset(): void {
    this.state = "IDLE";
    this.currentChallenge = null;
    this.challengeStartedAt = null;
    this.earLowStreak = 0;
    this.observedBlink = false;
    this.observedSmile = false;
    this.observedYawLeft = false;
    this.observedYawRight = false;
  }

  /**
   * Main entry point — call once per camera frame.
   *
   * @param landmarks       FaceMesh's 468 landmarks (after squeezing unit dims).
   * @param presenceLogit   FaceMesh's presence sigmoid logit (second output).
   */
  public onFrame(landmarks: Point3D[] | null, presenceLogit: number | null): FrameResult {
    // No face → reset to IDLE
    if (
      landmarks === null ||
      presenceLogit === null ||
      !faceIsPresent(presenceLogit, this.thresholds.facePresenceMin)
    ) {
      if (this.state !== "GATE_1_PASSED") {
        this.reset();
      }
      return this.snapshot(null, null, null);
    }

    // Compute metrics for this frame
    const ear = computeEAR(landmarks);
    const mar = computeMAR(landmarks);
    const yaw = computeYawDegrees(landmarks);

    switch (this.state) {
      case "IDLE":
        // Face just appeared → pick a challenge and prompt the user
        this.currentChallenge = pickChallenge(this.allowedChallenges);
        this.challengeStartedAt = Date.now();
        this.state = "CHALLENGED";
        break;

      case "CHALLENGED": {
        // Update per-condition observations
        if (ear < this.thresholds.earBlinkMax) {
          this.earLowStreak += 1;
          if (this.earLowStreak >= this.thresholds.earBlinkConsecutiveFrames) {
            this.observedBlink = true;
          }
        } else {
          this.earLowStreak = 0;
        }

        if (mar > this.thresholds.marSmileMin) {
          this.observedSmile = true;
        }

        if (yaw > this.thresholds.pnpYawTurnDegrees) {
          this.observedYawLeft = true;
        } else if (yaw < -this.thresholds.pnpYawTurnDegrees) {
          this.observedYawRight = true;
        }

        // Did the user complete the assigned challenge?
        const completed = this.challengeCompleted();
        if (completed) {
          this.state = "GATE_1_PASSED";
          break;
        }

        // Timeout?
        const elapsed = Date.now() - (this.challengeStartedAt ?? 0);
        if (elapsed > this.thresholds.challengeTimeoutMs) {
          this.state = "FAILED";
        }
        break;
      }

      case "GATE_1_PASSED":
      case "FAILED":
        // Terminal states — caller drives next step
        break;
    }

    return this.snapshot(ear, mar, yaw);
  }

  private challengeCompleted(): boolean {
    switch (this.currentChallenge) {
      case "BLINK":      return this.observedBlink;
      case "SMILE":      return this.observedSmile;
      case "TURN_LEFT":  return this.observedYawLeft;
      case "TURN_RIGHT": return this.observedYawRight;
      default:           return false;
    }
  }

  private snapshot(ear: number | null, mar: number | null, yaw: number | null): FrameResult {
    return {
      state: this.state,
      prompt: this.currentChallenge ? PROMPT_TEXTS[this.currentChallenge] : null,
      currentChallenge: this.currentChallenge,
      metrics: { ear, mar, yawDegrees: yaw },
    };
  }
}
