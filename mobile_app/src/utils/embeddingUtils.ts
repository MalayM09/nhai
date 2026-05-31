/**
 * Embedding math utilities.
 *
 * Convention (frozen in shared_contracts):
 *   cosine_distance(a, b) = 1 - dot(a, b)   (when a, b are L2-normalised)
 *   Range: [0, 2].   Lower = more similar.
 *   Match if cosine_distance < MATCH_THRESHOLD_VALUE (0.40 placeholder).
 *
 * The old blueprint placeholder of 0.8 was a cosine *similarity* magnitude
 * and has been corrected. Always use distance here.
 */

/** L2-normalise a Float32 embedding vector in-place and return it. */
export function l2Normalize(embedding: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < embedding.length; i++) {
    sumSq += embedding[i] * embedding[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm < 1e-10) return embedding; // zero vector — return as-is
  for (let i = 0; i < embedding.length; i++) {
    embedding[i] /= norm;
  }
  return embedding;
}

/**
 * Cosine distance between two L2-normalised 512-D vectors.
 * Assumes both inputs are already L2-normalised (output of MobileFaceNet
 * post-processed by l2Normalize). Returns value in [0, 2].
 */
export function cosineDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  // For L2-normalised vectors: cosine_distance = 1 - dot(a, b)
  return 1 - dot;
}

/**
 * L2-average a set of embeddings and re-normalise — used during multi-shot
 * enrollment to produce the centroid template stored in SQLite.
 */
export function l2AverageEmbeddings(embeddings: Float32Array[]): Float32Array {
  if (embeddings.length === 0) {
    throw new Error('Cannot average zero embeddings');
  }
  const dim = embeddings[0].length;
  const centroid = new Float32Array(dim);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += emb[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    centroid[i] /= embeddings.length;
  }
  return l2Normalize(centroid);
}

/**
 * Find the best-matching user from an in-memory embedding matrix.
 * Returns { userId, distance } for the closest match, or null if the
 * matrix is empty or no match beats the threshold.
 */
export function findBestMatch(
  liveEmbedding: Float32Array,
  storedEmbeddings: Array<{userId: string; embedding: Float32Array}>,
  threshold: number,
): {userId: string; distance: number} | null {
  let bestDist = Infinity;
  let bestId: string | null = null;

  for (const {userId, embedding} of storedEmbeddings) {
    const dist = cosineDistance(liveEmbedding, embedding);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = userId;
    }
  }

  if (bestId !== null && bestDist < threshold) {
    return {userId: bestId, distance: bestDist};
  }
  return null;
}
