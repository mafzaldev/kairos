import { spawn } from "node:child_process";
import { KairosError } from "../errors.js";
import { decoder } from "./qr.js";

const WIDTH = 1280;
const HEIGHT = 720;
const FRAME_SIZE = WIDTH * HEIGHT * 4;
const TIMEOUT = 60_000;

/** Watches the camera until a QR code is in view and returns its text. */
export function scan(device?: string): Promise<string> {
  const size = `${WIDTH}x${HEIGHT}`;
  switch (process.platform) {
    case "linux":
      return watch(["-f", "v4l2", "-video_size", size, "-i", device ?? "/dev/video0"]);
    case "darwin":
      return watch(["-f", "avfoundation", "-framerate", "30", "-video_size", size, "-i", device ?? "0"]);
    default:
      if (!device) throw new KairosError('Name the camera to use, for example: kairos scan --device "Integrated Camera"');
      return watch(["-f", "dshow", "-i", `video=${device}`]);
  }
}

/**
 * Reads video through ffmpeg (`input` is its input arguments) until a frame
 * holds a QR code. Frames are only held in memory, never written to disk.
 */
export async function watch(input: string[], timeout = TIMEOUT): Promise<string> {
  const decode = await decoder();

  // Raw RGBA at a fixed, letterboxed size, so the stream splits into frames by byte count.
  // The light blur matters: the QR reader copes with soft edges far better than with camera noise.
  const filter = `fps=4,scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,gblur=sigma=1.4`;
  const ffmpeg = spawn("ffmpeg", ["-loglevel", "error", ...input, "-vf", filter, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolve, reject) => {
    const frame = Buffer.alloc(FRAME_SIZE);
    let filled = 0;
    let complaints = "";
    let settled = false;

    const finish = (text?: string, problem?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ffmpeg.kill();
      frame.fill(0);
      if (text) resolve(text);
      else reject(new KairosError(problem ?? "The camera stopped."));
    };

    const timer = setTimeout(() => {
      finish(undefined, `No QR code seen in ${timeout / 1000} seconds. Hold it closer, steady and free of glare, then try again.`);
    }, timeout);

    ffmpeg.on("error", (error: NodeJS.ErrnoException) => {
      finish(undefined, error.code === "ENOENT" ? "kairos scan needs ffmpeg, which is not installed." : `Could not start ffmpeg: ${error.message}`);
    });
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      complaints += chunk.toString();
    });
    ffmpeg.on("close", () => {
      const reason = complaints.trim().split("\n").at(-1) ?? "";
      finish(undefined, `Could not read from the camera. ${reason}`.trim());
    });

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      for (let read = 0; read < chunk.length && !settled;) {
        const copied = chunk.copy(frame, filled, read, read + Math.min(chunk.length - read, FRAME_SIZE - filled));
        read += copied;
        filled += copied;
        if (filled === FRAME_SIZE) {
          filled = 0;
          const text = decode(new Uint8ClampedArray(frame.buffer, frame.byteOffset, FRAME_SIZE), WIDTH, HEIGHT);
          if (text) finish(text);
        }
      }
    });
  });
}
