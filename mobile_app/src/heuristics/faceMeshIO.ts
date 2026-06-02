/**
 * Helpers for unpacking FaceMesh's TFLite output into the data structure the
 * `LivenessGate` expects.
 *
 * Why this file exists: `react-native-fast-tflite` returns model outputs as
 * a list of typed arrays in the order declared by the .tflite signature.
 * The JSI worklet shouldn't be doing tensor-shape gymnastics inline; it should
 * just call one function here and get back ready-to-use values.
 *
 * Usage in a vision-camera frame processor worklet:
 *
 *   const raw = facemesh.runSync(faceCropTensor);
 *   const { landmarks, presenceLogit, faceLikelihood } = unpackFaceMeshOutput(raw);
 *   if (faceLikelihood < 0.5) return;        // no face this frame
 *   const result = gate.onFrame(landmarks, presenceLogit);
 *
 * The function is pure and synchronous — safe to call from a worklet.
 */

import { reshapeFaceMeshOutput, type Point3D } from "./landmarks";

export interface FaceMeshOutput {
  /** 468 landmarks, ready to feed into `computeEAR`, `computeMAR`, etc. */
  landmarks: Point3D[];
  /** Raw sigmoid logit for "face present" — pass to `faceIsPresent()` */
  presenceLogit: number;
  /** Convenience: sigmoid(presenceLogit), in [0, 1]. */
  faceLikelihood: number;
}

/**
 * Unpack the two outputs from `react-native-fast-tflite`'s call into
 * `facemesh.tflite`. Tolerates either Float32Array or Float64Array; tolerates
 * either the legacy MediaPipe ordering (landmarks first, score second) or its
 * reverse. We discriminate by length — landmarks are 1404 floats; score is 1.
 *
 * Throws if neither output looks right. The throw is intentional — we'd rather
 * crash loudly than silently feed bad data into the gate.
 */
export function unpackFaceMeshOutput(
  rawOutputs: ReadonlyArray<Float32Array | Float64Array>,
): FaceMeshOutput {
  if (rawOutputs.length < 2) {
    throw new Error(
      `FaceMesh produced ${rawOutputs.length} outputs; expected 2 (landmarks + presence)`,
    );
  }

  let landmarksFlat: Float32Array | Float64Array | null = null;
  let presenceTensor: Float32Array | Float64Array | null = null;

  for (const out of rawOutputs) {
    if (out.length === 1404) {
      landmarksFlat = out;
    } else if (out.length === 1) {
      presenceTensor = out;
    }
  }

  if (!landmarksFlat) {
    throw new Error("FaceMesh: no output of length 1404 (landmarks) found");
  }
  if (!presenceTensor) {
    throw new Error("FaceMesh: no output of length 1 (presence) found");
  }

  const landmarks = reshapeFaceMeshOutput(
    landmarksFlat instanceof Float32Array
      ? landmarksFlat
      : new Float32Array(landmarksFlat),
  );
  const presenceLogit = presenceTensor[0];
  const faceLikelihood = 1 / (1 + Math.exp(-presenceLogit));

  return { landmarks, presenceLogit, faceLikelihood };
}
