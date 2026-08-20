import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  ImageProcessingError,
  processListingImage,
} from "@/lib/server/images/process";

const OPTS = { maxEdgePx: 1600, webpQuality: 80 };

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 10, b: 30 } },
  })
    .jpeg()
    .toBuffer();
}

describe("processListingImage", () => {
  it("re-encodes a JPEG to WebP and resizes the longest edge", async () => {
    const result = await processListingImage(await makeJpeg(3200, 1600), OPTS);
    expect(result.mimeType).toBe("image/webp");
    expect(result.width).toBe(1600);
    expect(result.height).toBe(800);
    expect(result.sizeBytes).toBe(result.data.length);
    const meta = await sharp(result.data).metadata();
    expect(meta.format).toBe("webp");
  });

  it("does not upscale small images", async () => {
    const result = await processListingImage(await makeJpeg(400, 300), OPTS);
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
  });

  it("accepts PNG and WebP input", async () => {
    const png = await sharp({
      create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const webp = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .webp()
      .toBuffer();
    await expect(processListingImage(png, OPTS)).resolves.toBeTruthy();
    await expect(processListingImage(webp, OPTS)).resolves.toBeTruthy();
  });

  it("strips EXIF metadata (including orientation source data)", async () => {
    const withExif = await sharp({
      create: { width: 80, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: "avtosh-test", Software: "avtosh" } })
      .toBuffer();
    const sourceMeta = await sharp(withExif).metadata();
    expect(sourceMeta.exif).toBeDefined(); // fixture really carries EXIF
    const result = await processListingImage(withExif, OPTS);
    const meta = await sharp(result.data).metadata();
    expect(meta.exif).toBeUndefined(); // stripped in output
  });

  it("rejects SVG content", async () => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>`,
    );
    await expect(processListingImage(svg, OPTS)).rejects.toThrowError(
      ImageProcessingError,
    );
    await expect(processListingImage(svg, OPTS)).rejects.toMatchObject({
      reason: "INVALID_FORMAT",
    });
  });

  it("rejects corrupt bytes and plain text regardless of claimed type", async () => {
    await expect(
      processListingImage(Buffer.from("definitely not an image"), OPTS),
    ).rejects.toMatchObject({ reason: "INVALID_FORMAT" });
    const noise = Buffer.alloc(4096);
    for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 31) % 251;
    await expect(processListingImage(noise, OPTS)).rejects.toMatchObject({
      reason: "INVALID_FORMAT",
    });
  });

  it("rejects a truncated JPEG", async () => {
    const jpeg = await makeJpeg(600, 400);
    const truncated = jpeg.subarray(0, 60);
    await expect(processListingImage(truncated, OPTS)).rejects.toThrowError(
      ImageProcessingError,
    );
  });
});
