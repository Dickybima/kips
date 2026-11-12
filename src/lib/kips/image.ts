// Prepares an agent logo in the browser before upload: center-crops to a
// square and scales to SIZE px, so every logo is small and consistent.
export const SIZE = 512;
const MAX_INPUT = 15 * 1024 * 1024;
const ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/bmp"];

export class LogoError extends Error {}

export interface PreparedLogo {
  blob: Blob;
  /** Local object URL for an instant preview; revoke when done. */
  preview: string;
}

export async function prepareLogo(file: File): Promise<PreparedLogo> {
  if (!ACCEPT.includes(file.type)) throw new LogoError("Choose a PNG, JPEG, WebP or GIF image.");
  if (file.size > MAX_INPUT) throw new LogoError("That image is over 15 MB. Choose a smaller one.");
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new LogoError("That image could not be read.");
  }
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext("2d");
  if (!g) throw new LogoError("This browser cannot process images.");
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bmp.close();
  const encode = (type: string, q?: number) =>
    new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
  // WebP keeps logos small; browsers that cannot encode it fall back to PNG.
  let blob = await encode("image/webp", 0.9);
  if (!blob || blob.type !== "image/webp") blob = await encode("image/png");
  if (!blob) throw new LogoError("That image could not be processed.");
  return { blob, preview: URL.createObjectURL(blob) };
}

/** Sends a prepared logo to /api/upload and returns its public URL. */
export async function uploadLogo(blob: Blob): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/upload", { method: "POST", headers: { "content-type": blob.type }, body: blob });
  } catch {
    throw new LogoError("Could not reach the upload service. Check your connection.");
  }
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) {
    throw new LogoError(data.error ?? `Upload failed (${res.status}). The upload service may not be available here.`);
  }
  return data.url;
}
