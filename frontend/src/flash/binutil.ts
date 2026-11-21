/** Pure helpers for ESP32 images (kept free of esptool-js so tests stay in Node). */
import type { BoardProfile } from '@/contracts';

/** Offset of the app partition when only `sketch.ino.bin` is available (no merged image). */
export const ESP32_APP_OFFSET = 0x10000;

/**
 * Where to write an ESP32 artifact: the merged image goes to `upload.flashOffset` (0x0);
 * the app-only fallback (`sketch.ino.bin`) goes to 0x10000.
 */
export function espFlashOffset(artifactName: string | undefined, board: BoardProfile): number {
  const merged = board.toolchain.artifactSuffix;
  if (artifactName && artifactName.endsWith(merged)) {
    return board.upload.protocol === 'esptool' ? board.upload.flashOffset : 0;
  }
  if (artifactName && artifactName.endsWith('.bin')) return ESP32_APP_OFFSET;
  return board.upload.protocol === 'esptool' ? board.upload.flashOffset : 0;
}

/**
 * Drop trailing 0xFF padding (merged images are padded to the full flash size, 4 MB) and
 * round up to `align` bytes. Erased flash already reads 0xFF, and esptool only erases the
 * sectors it writes, so the result is equivalent to what the Arduino IDE uploads — but much faster.
 */
export function trimTrailingFF(data: Uint8Array, align = 4096): Uint8Array {
  let end = data.length;
  while (end > 0 && data[end - 1] === 0xff) end--;
  if (end === 0) return data.subarray(0, Math.min(data.length, align));
  const rounded = Math.min(data.length, Math.ceil(end / align) * align);
  return data.subarray(0, rounded);
}

/** Heuristic: does this look like an ESP image (magic byte 0xE9 at the start)? */
export const looksLikeEspImage = (data: Uint8Array) => data.length > 0 && data[0] === 0xe9;
