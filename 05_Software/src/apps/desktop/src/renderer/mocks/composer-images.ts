import { composerRasterFormat, MAX_MESSAGE_IMAGE_BYTES, veraError } from "@vera/shared";

/** The browser mock decodes fixture files locally; native storage is exercised by Electron. */
export async function mockImageThumbnail(name: string, data: string) {
  const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
  if (bytes.length > MAX_MESSAGE_IMAGE_BYTES) throw veraError("IMAGE_TOO_LARGE");
  const format = composerRasterFormat(name, bytes, false);
  if (!format) throw veraError("IMAGE_FORMAT");
  const image = await createImageBitmap(new Blob([bytes], { type: `image/${format}` })).catch(() => {
    throw veraError("IMAGE_FORMAT");
  });
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 128 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  } finally {
    image.close();
  }
}
