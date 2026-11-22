import { readFileSync } from "node:fs";
import { KairosError } from "../errors.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

interface Bitmap {
  data: Uint8Array;
  width: number;
  height: number;
}

// The format is detected from the content, not the file extension. The image
// libraries are loaded on demand: only `import-qr` needs them.
async function decodeImage(file: Buffer): Promise<Bitmap> {
  if (file.subarray(0, PNG.length).equals(PNG)) {
    const { PNG: decoder } = (await import("pngjs")).default;
    return decoder.sync.read(file);
  }
  if (file.subarray(0, JPEG.length).equals(JPEG)) {
    const jpeg = (await import("jpeg-js")).default;
    return jpeg.decode(file, { useTArray: true, formatAsRGBA: true });
  }
  throw new KairosError("Unsupported image format. Use a PNG or JPEG file.");
}

/** Loads the QR library and returns a function that finds the code in RGBA pixels. */
export async function decoder(): Promise<(pixels: Uint8ClampedArray, width: number, height: number) => string | undefined> {
  // jsqr is CommonJS with a `default` property, hence the double default.
  const jsQR = (await import("jsqr")).default.default;
  return (pixels, width, height) => jsQR(pixels, width, height)?.data || undefined;
}

/** Returns the text in the QR code found in a PNG or JPEG file. */
export async function readQr(imagePath: string): Promise<string> {
  let file: Buffer;
  try {
    file = readFileSync(imagePath);
  } catch {
    throw new KairosError(`Could not read the image: ${imagePath}`);
  }

  let image: Bitmap;
  try {
    image = await decodeImage(file);
  } catch (error) {
    if (error instanceof KairosError) throw error;
    throw new KairosError(`Could not decode the image: ${(error as Error).message}`);
  }

  // A QR code on a transparent background is meant to be seen on white.
  const pixels = new Uint8ClampedArray(image.data);
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3]! / 255;
    for (let channel = i; channel < i + 3; channel++) {
      pixels[channel] = pixels[channel]! * alpha + 255 * (1 - alpha);
    }
  }

  const decode = await decoder();
  const text = decode(pixels, image.width, image.height);
  if (!text) {
    throw new KairosError("No QR code found in the image. Use a sharp, uncropped screenshot of the code.");
  }
  return text;
}
