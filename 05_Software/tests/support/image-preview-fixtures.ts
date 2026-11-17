import type { Page } from "@playwright/test";

/** Code-generated encoded fixtures; no image library, network or checked-in binary asset. */
export async function imagePreviewFixtures(page: Page): Promise<Record<string, string>> {
  const raster = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 400;
    const context = canvas.getContext("2d");
    if (!context) throw Error("Canvas unavailable");
    context.fillStyle = "#16384a";
    context.fillRect(0, 0, 800, 400);
    context.strokeStyle = "#70e2af";
    for (let x = 0; x < 800; x += 10) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, 400);
      context.stroke();
    }
    context.fillStyle = "#ffffff";
    context.font = "36px sans-serif";
    context.fillText("VERA image preview", 80, 200);
    return Object.fromEntries(
      ["png", "jpeg", "webp"].map((format) => [
        format,
        canvas.toDataURL(`image/${format}`).split(",")[1] ?? "",
      ]),
    );
  });
  const bmp = Buffer.alloc(54 + 12 * 8);
  bmp.write("BM");
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(4, 18);
  bmp.writeInt32LE(8, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.fill(160, 54);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" onload="top.__imageScriptRan=true">
    <script>top.__imageScriptRan=true;fetch('https://image-preview.invalid/image-probe-script')</script>
    <style>@import url('https://image-preview.invalid/image-probe-style');</style>
    <rect width="800" height="400" fill="#16384a"/>
    <path d="M0 200H800M400 0V400" stroke="#70e2af" stroke-width="2"/>
    <text x="70" y="180" font-size="36" fill="white">VERA SVG image preview</text>
    <image href="https://image-preview.invalid/image-probe-external" width="10" height="10"/>
    <image href="http://127.0.0.1:9/image-probe-local" width="10" height="10"/>
    <image href="http://127.0.0.1:5173/image-probe-same-origin.png" width="10" height="10"/>
    <image href="vera://app/image-probe-same-origin.png" width="10" height="10"/>
    <a href="https://image-preview.invalid/image-probe-navigation"><rect width="40" height="40"/></a>
  </svg>`;
  return {
    "preview.png": raster.png ?? "",
    "preview.jpg": raster.jpeg ?? "",
    "preview.gif": "R0lGODlhAQABAIAAAABmZv///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "preview.webp": raster.webp ?? "",
    "preview.bmp": bmp.toString("base64"),
    "view06-private.svg": Buffer.from(svg).toString("base64"),
  };
}
