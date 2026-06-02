/**
 * Composed identity-embedding pipeline helper.
 *
 * Per `shared_contracts/thresholds.json`, Phase 3 calibration picked the
 * composed adapter pipeline as the EER winner (AUC 0.9499 vs 0.8487 for the
 * raw InsightFace baseline). The deployed pipeline runs the backbone tflite
 * followed by the adapter tflite, then L2-normalises before cosine distance.
 *
 * This helper hides that two-step composition behind a single function call
 * so the frame processor doesn't have to think about it.
 *
 * Usage:
 *
 *   const embedding = computeComposedEmbedding(
 *     backbone,       // useTensorflowModel(mobilefacenet.tflite)
 *     adapter,        // useTensorflowModel(mobilefacenet_adapter.tflite)
 *     preprocessedImage,
 *   );
 *   const distance = cosineDistance(embedding, storedTemplate);
 *   const matched  = distance < MATCH_THRESHOLD_VALUE;   // 0.8616 (calibrated)
 */

import { l2Normalize } from "./embeddingUtils";

/**
 * Minimal structural interface — anything with a synchronous `runSync` method
 * that accepts a list of Float32Array inputs and returns a list of Float32Array
 * outputs. Both `react-native-fast-tflite`'s `TensorflowModel` and a hand-rolled
 * mock for tests satisfy this. Not coupling to library version to keep this
 * file resilient across react-native-fast-tflite minor bumps.
 */
export interface InferenceCallable {
  runSync: (inputs: Float32Array[]) => Float32Array[];
}

/**
 * Run the full composed pipeline:
 *   image → backbone → raw 512-D → adapter → adapted 512-D → L2-normalize
 *
 * The input image must already be preprocessed:
 *   - 112×112 RGB
 *   - channels-last layout (NHWC)
 *   - normalized to [-1, 1] via (pixel - 127.5) / 127.5
 *   - face-aligned (eye landmarks roughly horizontal) — though for Phase 2
 *     the demo accepts unaligned crops at modest quality cost
 *
 * Returns a 512-D L2-normalized embedding. The returned vector can be fed
 * directly to `cosineDistance(embedding, storedTemplate)` from `embeddingUtils`.
 *
 * NOTE: `l2Normalize` mutates in place. If the caller wants to keep the
 * pre-normalized adapted embedding around (for debug logging, etc.), copy it
 * before calling this function. We don't copy by default to avoid an
 * unnecessary allocation in the hot frame-processor path.
 */
export function computeComposedEmbedding(
  backbone: InferenceCallable,
  adapter: InferenceCallable,
  preprocessedImage: Float32Array,
): Float32Array {
  // Step 1: backbone produces the raw 512-D embedding (not L2-normalized yet)
  const backboneOutputs = backbone.runSync([preprocessedImage]);
  if (backboneOutputs.length === 0 || backboneOutputs[0].length !== 512) {
    throw new Error(
      `Backbone output unexpected: ${backboneOutputs.length} tensors, ` +
        `first of length ${backboneOutputs[0]?.length}`,
    );
  }
  const rawEmbedding = backboneOutputs[0];

  // Step 2: adapter takes the raw embedding, produces the adapted embedding
  const adapterOutputs = adapter.runSync([rawEmbedding]);
  if (adapterOutputs.length === 0 || adapterOutputs[0].length !== 512) {
    throw new Error(
      `Adapter output unexpected: ${adapterOutputs.length} tensors, ` +
        `first of length ${adapterOutputs[0]?.length}`,
    );
  }
  const adaptedEmbedding = adapterOutputs[0];

  // Step 3: L2-normalize so cosine distance reduces to (1 - dot product)
  return l2Normalize(adaptedEmbedding);
}
