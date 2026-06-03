/**
 * Smoke tests for the Gate 1 heuristics math + embedding math.
 *
 * These exercise pure-TS functions that don't depend on any native module,
 * so they run fast (< 1 s) and don't need a phone. Goal: prove the math is
 * correct in isolation so when Sahil unblocks the YUV→tensor preprocessing,
 * we know the gates will compute the right thing.
 *
 * Run with: npm test -- --testPathPattern=heuristics
 */

import {
  computeEAR,
  computeMAR,
  computeYawDegrees,
  faceIsPresent,
  computeLaplacianVariance,
  frameIsSharp,
} from '../src/heuristics/math';
import {
  reshapeFaceMeshOutput,
  extractEyePoints,
  extractMouthPoints,
  extractYawAnchors,
  type Point3D,
} from '../src/heuristics/landmarks';
import {unpackFaceMeshOutput} from '../src/heuristics/faceMeshIO';
import {
  l2Normalize,
  cosineDistance,
  l2AverageEmbeddings,
  findBestMatch,
} from '../src/utils/embeddingUtils';

// ─── synthetic face landmarks ──────────────────────────────────────────────

/** Build a 468-landmark "face" with all points at origin then overwrite the ones we test. */
function blankLandmarks(): Point3D[] {
  return new Array(468).fill(null).map(() => ({x: 0, y: 0, z: 0}));
}

/** Place a 6-point eye contour with given vertical opening (in pixels). */
function placeEye(
  landmarks: Point3D[],
  indices: readonly number[],
  centerX: number,
  centerY: number,
  width: number,
  height: number,
): void {
  // EAR uses order [outer, top1, top2, inner, bot1, bot2]
  // outer/inner are the corners; top1/top2 and bot1/bot2 are the lid points.
  landmarks[indices[0]] = {x: centerX - width / 2, y: centerY, z: 0}; // outer
  landmarks[indices[1]] = {
    x: centerX - width / 4,
    y: centerY - height / 2,
    z: 0,
  };
  landmarks[indices[2]] = {
    x: centerX + width / 4,
    y: centerY - height / 2,
    z: 0,
  };
  landmarks[indices[3]] = {x: centerX + width / 2, y: centerY, z: 0}; // inner
  landmarks[indices[4]] = {
    x: centerX + width / 4,
    y: centerY + height / 2,
    z: 0,
  };
  landmarks[indices[5]] = {
    x: centerX - width / 4,
    y: centerY + height / 2,
    z: 0,
  };
}

const RIGHT_EYE = [33, 160, 158, 133, 153, 144] as const;
const LEFT_EYE = [263, 387, 385, 362, 380, 373] as const;
const MOUTH = [61, 39, 0, 291, 17, 84] as const;

// ─── EAR — eye aspect ratio ────────────────────────────────────────────────

describe('EAR (eye aspect ratio) — blink detection', () => {
  test('open eye → EAR ≈ 0.3 (well above blink threshold 0.2)', () => {
    const landmarks = blankLandmarks();
    placeEye(landmarks, RIGHT_EYE, 100, 100, 30, 10); // wide and open
    placeEye(landmarks, LEFT_EYE, 200, 100, 30, 10);
    const ear = computeEAR(landmarks);
    expect(ear).toBeGreaterThan(0.25);
    expect(ear).toBeLessThan(0.5);
  });

  test('closed eye → EAR < 0.2 (triggers blink condition)', () => {
    const landmarks = blankLandmarks();
    placeEye(landmarks, RIGHT_EYE, 100, 100, 30, 2); // wide but barely open
    placeEye(landmarks, LEFT_EYE, 200, 100, 30, 2);
    const ear = computeEAR(landmarks);
    expect(ear).toBeLessThan(0.2);
  });
});

// ─── MAR — mouth aspect ratio ──────────────────────────────────────────────

describe('MAR (mouth aspect ratio) — smile / open mouth', () => {
  test('closed mouth → MAR < 0.5', () => {
    const landmarks = blankLandmarks();
    // mouth: width 40, vertical opening 5 → ratio 0.125
    landmarks[MOUTH[0]] = {x: 100, y: 100, z: 0};
    landmarks[MOUTH[1]] = {x: 110, y: 97, z: 0};
    landmarks[MOUTH[2]] = {x: 130, y: 97, z: 0};
    landmarks[MOUTH[3]] = {x: 140, y: 100, z: 0};
    landmarks[MOUTH[4]] = {x: 130, y: 103, z: 0};
    landmarks[MOUTH[5]] = {x: 110, y: 103, z: 0};
    const mar = computeMAR(landmarks);
    expect(mar).toBeLessThan(0.5);
  });

  test('open mouth → MAR > 0.5', () => {
    const landmarks = blankLandmarks();
    // mouth: width 40, vertical opening 25 → ratio 0.625
    landmarks[MOUTH[0]] = {x: 100, y: 100, z: 0};
    landmarks[MOUTH[1]] = {x: 110, y: 87, z: 0};
    landmarks[MOUTH[2]] = {x: 130, y: 87, z: 0};
    landmarks[MOUTH[3]] = {x: 140, y: 100, z: 0};
    landmarks[MOUTH[4]] = {x: 130, y: 113, z: 0};
    landmarks[MOUTH[5]] = {x: 110, y: 113, z: 0};
    const mar = computeMAR(landmarks);
    expect(mar).toBeGreaterThan(0.5);
  });
});

// ─── Yaw — head pose ───────────────────────────────────────────────────────

describe('Yaw — head turn detection (simplified estimator)', () => {
  test('facing camera (symmetric nose-to-eye) → yaw ≈ 0', () => {
    const landmarks = blankLandmarks();
    landmarks[4] = {x: 100, y: 100, z: 0}; // nose tip
    landmarks[33] = {x: 50, y: 90, z: 0}; // right eye outer (subject's right)
    landmarks[263] = {x: 150, y: 90, z: 0}; // left eye outer (subject's left)
    const yaw = computeYawDegrees(landmarks);
    expect(Math.abs(yaw)).toBeLessThan(5);
  });

  test('head turned subject-left (left eye closer to nose) → yaw > 25°', () => {
    const landmarks = blankLandmarks();
    landmarks[4] = {x: 100, y: 100, z: 0};
    landmarks[33] = {x: 50, y: 90, z: 0}; // far from nose
    landmarks[263] = {x: 105, y: 90, z: 0}; // close to nose (head turned subject-left)
    const yaw = computeYawDegrees(landmarks);
    expect(yaw).toBeLessThan(-25);
  });

  test('head turned subject-right → yaw < -25°', () => {
    const landmarks = blankLandmarks();
    landmarks[4] = {x: 100, y: 100, z: 0};
    landmarks[33] = {x: 95, y: 90, z: 0}; // close to nose (head turned subject-right)
    landmarks[263] = {x: 150, y: 90, z: 0}; // far
    const yaw = computeYawDegrees(landmarks);
    expect(yaw).toBeGreaterThan(25);
  });
});

// ─── Face presence sigmoid ─────────────────────────────────────────────────

describe('Face presence', () => {
  test('high logit → present', () => {
    expect(faceIsPresent(3.0)).toBe(true);
    expect(faceIsPresent(10.0)).toBe(true);
  });
  test('low logit → absent', () => {
    expect(faceIsPresent(-3.0)).toBe(false);
    expect(faceIsPresent(-10.0)).toBe(false);
  });
  test('logit 0 → boundary (sigmoid(0) = 0.5, not > 0.5)', () => {
    expect(faceIsPresent(0)).toBe(false);
  });
});

// ─── Laplacian variance — frame quality ────────────────────────────────────

describe('Laplacian variance — blur detection', () => {
  test('uniform gray → variance ≈ 0 (sharpness fails)', () => {
    const w = 32,
      h = 32;
    const px = new Uint8Array(w * h).fill(128);
    expect(computeLaplacianVariance(px, w, h)).toBeLessThan(1);
    expect(frameIsSharp(px, w, h)).toBe(false);
  });

  test('checkerboard-ish high-contrast → variance high (sharpness passes)', () => {
    const w = 32,
      h = 32;
    const px = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        px[y * w + x] = (x + y) & 1 ? 255 : 0;
      }
    }
    const v = computeLaplacianVariance(px, w, h);
    expect(v).toBeGreaterThan(60);
    expect(frameIsSharp(px, w, h)).toBe(true);
  });
});

// ─── FaceMesh I/O helpers ──────────────────────────────────────────────────

describe('FaceMesh output unpacking + reshape', () => {
  test('reshapeFaceMeshOutput throws on wrong length', () => {
    expect(() => reshapeFaceMeshOutput(new Float32Array(100))).toThrow();
  });
  test('reshapeFaceMeshOutput returns 468 Point3D from 1404 floats', () => {
    const flat = new Float32Array(1404);
    for (let i = 0; i < 1404; i++) {
      flat[i] = i;
    }
    const points = reshapeFaceMeshOutput(flat);
    expect(points.length).toBe(468);
    expect(points[0]).toEqual({x: 0, y: 1, z: 2});
    expect(points[467]).toEqual({x: 1401, y: 1402, z: 1403});
  });

  test('unpackFaceMeshOutput discriminates by length, ordering-agnostic', () => {
    const landmarks = new Float32Array(1404);
    landmarks[0] = 42;
    const presence = new Float32Array([1.5]);

    // ordering 1: [landmarks, presence]
    const a = unpackFaceMeshOutput([landmarks, presence]);
    expect(a.landmarks.length).toBe(468);
    expect(a.presenceLogit).toBe(1.5);

    // ordering 2: [presence, landmarks] — same result
    const b = unpackFaceMeshOutput([presence, landmarks]);
    expect(b.landmarks.length).toBe(468);
    expect(b.presenceLogit).toBe(1.5);

    // faceLikelihood is sigmoid(1.5) ≈ 0.818
    expect(a.faceLikelihood).toBeCloseTo(0.818, 2);
  });

  test('extractEyePoints returns 6 landmarks per side', () => {
    const landmarks = blankLandmarks();
    landmarks[33] = {x: 1, y: 2, z: 3};
    landmarks[263] = {x: 10, y: 20, z: 30};
    expect(extractEyePoints(landmarks, 'right').length).toBe(6);
    expect(extractEyePoints(landmarks, 'left').length).toBe(6);
    expect(extractEyePoints(landmarks, 'right')[0]).toEqual({x: 1, y: 2, z: 3});
    expect(extractEyePoints(landmarks, 'left')[0]).toEqual({
      x: 10,
      y: 20,
      z: 30,
    });
  });

  test('extractMouthPoints returns 6 mouth landmarks', () => {
    expect(extractMouthPoints(blankLandmarks()).length).toBe(6);
  });

  test('extractYawAnchors returns the three reference landmarks', () => {
    const landmarks = blankLandmarks();
    landmarks[4] = {x: 100, y: 0, z: 0};
    const a = extractYawAnchors(landmarks);
    expect(a.noseTip).toEqual({x: 100, y: 0, z: 0});
    expect(a.rightEyeOuter).toBeDefined();
    expect(a.leftEyeOuter).toBeDefined();
  });
});

// ─── Embedding math ────────────────────────────────────────────────────────

describe('embedding math (L2 normalize + cosine distance)', () => {
  test('l2Normalize produces unit norm', () => {
    const v = new Float32Array([3, 4, 0, 0]); // norm = 5
    l2Normalize(v);
    const norm = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2 + v[3] ** 2);
    expect(norm).toBeCloseTo(1, 5);
    expect(v[0]).toBeCloseTo(0.6, 5);
    expect(v[1]).toBeCloseTo(0.8, 5);
  });

  test('cosine distance of identical vectors = 0', () => {
    const v = new Float32Array([0.6, 0.8, 0, 0]);
    expect(cosineDistance(v, v)).toBeCloseTo(0, 5);
  });

  test('cosine distance of orthogonal vectors = 1', () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([0, 1, 0, 0]);
    expect(cosineDistance(a, b)).toBeCloseTo(1, 5);
  });

  test('cosine distance of antiparallel vectors = 2', () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([-1, 0, 0, 0]);
    expect(cosineDistance(a, b)).toBeCloseTo(2, 5);
  });

  test('l2AverageEmbeddings produces unit-norm centroid', () => {
    const e1 = new Float32Array([1, 0, 0, 0]);
    const e2 = new Float32Array([0, 1, 0, 0]);
    const centroid = l2AverageEmbeddings([e1, e2]);
    const norm = Math.sqrt(
      centroid[0] ** 2 + centroid[1] ** 2 + centroid[2] ** 2 + centroid[3] ** 2,
    );
    expect(norm).toBeCloseTo(1, 5);
    expect(centroid[0]).toBeCloseTo(0.707, 2);
    expect(centroid[1]).toBeCloseTo(0.707, 2);
  });

  test('findBestMatch returns closest under threshold', () => {
    const live = new Float32Array([1, 0, 0]);
    l2Normalize(live);
    const a = new Float32Array([0.95, 0.05, 0]);
    l2Normalize(a);
    const b = new Float32Array([0, 1, 0]);
    l2Normalize(b);
    const match = findBestMatch(
      live,
      [
        {userId: 'alice', embedding: a},
        {userId: 'bob', embedding: b},
      ],
      0.5,
    );
    expect(match).not.toBeNull();
    expect(match?.userId).toBe('alice');
    expect(match?.distance).toBeLessThan(0.1);
  });

  test('findBestMatch returns null when all distances above threshold', () => {
    const live = new Float32Array([1, 0, 0]);
    const a = new Float32Array([0, 1, 0]);
    const match = findBestMatch(live, [{userId: 'alice', embedding: a}], 0.5);
    expect(match).toBeNull();
  });
});
