/**
 * Frame preprocessing for TFLite model inputs.
 * Camera must have pixelFormat="rgba" set so the buffer is row-major RGBA.
 * Called on the React JS thread — not inside a worklet.
 *
 * Normalization per shared_contracts/README.md:
 *   MobileFaceNet / BlazeFace → [-1, 1]  via (x - 127.5) / 127.5
 *   ShuffleNet / FaceMesh     → [0, 1]   via x / 255
 */
export function resizeRgbaToModelInput(
  srcRgba: ArrayBuffer | Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  norm: 'minus1_to_1' | 'zero_to_1',
): Float32Array {
  const src = srcRgba instanceof Uint8Array ? srcRgba : new Uint8Array(srcRgba);
  const out = new Float32Array(dstW * dstH * 3);
  const xScale = srcW / dstW;
  const yScale = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(Math.floor(y * yScale), srcH - 1);
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(Math.floor(x * xScale), srcW - 1);
      const srcIdx = (srcY * srcW + srcX) * 4; // RGBA — 4 bytes/pixel
      const dstIdx = (y * dstW + x) * 3;       // RGB  — 3 floats/pixel
      const r = src[srcIdx];
      const g = src[srcIdx + 1];
      const b = src[srcIdx + 2];
      if (norm === 'minus1_to_1') {
        out[dstIdx]     = (r - 127.5) / 127.5;
        out[dstIdx + 1] = (g - 127.5) / 127.5;
        out[dstIdx + 2] = (b - 127.5) / 127.5;
      } else {
        out[dstIdx]     = r / 255;
        out[dstIdx + 1] = g / 255;
        out[dstIdx + 2] = b / 255;
      }
    }
  }
  return out;
}
