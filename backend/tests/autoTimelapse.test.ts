import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAutoTimelapse, pickSpreadImageNames, pickTimelapseImagesFromDataset } from "../src/lib/autoTimelapse.js";

function createDatasetWithImages(names: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-dataset-"));
  const imagesDir = path.join(root, "images");
  fs.mkdirSync(imagesDir, { recursive: true });
  for (const name of names) {
    fs.mkdirSync(path.dirname(path.join(imagesDir, name)), { recursive: true });
    fs.writeFileSync(path.join(imagesDir, name), "image");
  }
  return root;
}

function writeColmapImagesTxt(datasetPath: string, names: string[]) {
  const sparseDir = path.join(datasetPath, "sparse", "0");
  fs.mkdirSync(sparseDir, { recursive: true });
  const lines = [
    "# Image list with two lines of data per image:",
    "# IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME",
    "# POINTS2D[] as (X, Y, POINT3D_ID)"
  ];

  names.forEach((name, index) => {
    lines.push(`${index + 1} 1 0 0 0 0 0 0 ${index + 10} ${name}`);
    lines.push("");
  });

  fs.writeFileSync(path.join(sparseDir, "images.txt"), lines.join("\n"));
}

function writeColmapImagesBin(datasetPath: string, names: string[]) {
  const sparseDir = path.join(datasetPath, "sparse", "0");
  fs.mkdirSync(sparseDir, { recursive: true });

  const chunks: Buffer[] = [];
  const header = Buffer.alloc(8);
  header.writeBigUInt64LE(BigInt(names.length), 0);
  chunks.push(header);

  names.forEach((name, index) => {
    const fixed = Buffer.alloc(4 + 8 * 4 + 8 * 3 + 4);
    let offset = 0;
    fixed.writeInt32LE(index + 1, offset);
    offset += 4;
    fixed.writeDoubleLE(1, offset);
    offset += 8;
    fixed.writeDoubleLE(0, offset);
    offset += 8;
    fixed.writeDoubleLE(0, offset);
    offset += 8;
    fixed.writeDoubleLE(0, offset);
    offset += 8;
    fixed.writeDoubleLE(0, offset);
    offset += 8;
    fixed.writeDoubleLE(0, offset);
    offset += 8;
    fixed.writeDoubleLE(0, offset);
    offset += 8;
    fixed.writeInt32LE(index + 10, offset);
    chunks.push(fixed, Buffer.from(`${name}\0`, "utf8"));

    const pointsHeader = Buffer.alloc(8);
    pointsHeader.writeBigUInt64LE(0n, 0);
    chunks.push(pointsHeader);
  });

  fs.writeFileSync(path.join(sparseDir, "images.bin"), Buffer.concat(chunks));
}

function rngSequence(values: number[]) {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}

describe("autoTimelapse", () => {
  it("picks spread image names from dataset images folder", () => {
    const dataset = createDatasetWithImages(["IMG_20.JPG", "IMG_2.JPG", "README.txt", "IMG_10.JPG"]);
    const picked = pickTimelapseImagesFromDataset(dataset, 2, rngSequence([0, 0.5]));
    expect(picked).toEqual(["IMG_2.JPG", "IMG_20.JPG"]);
  });

  it("includes nested image paths under dataset images folder", () => {
    const dataset = createDatasetWithImages([
      "cam-b/IMG_20.JPG",
      "cam-a/IMG_2.JPG",
      "cam-a/IMG_4.JPG",
      "cam-a/README.txt",
      "cam-b/IMG_10.JPG"
    ]);

    const picked = pickTimelapseImagesFromDataset(dataset, 2, rngSequence([0, 0.5]));

    expect(picked).toEqual(["cam-a/IMG_4.JPG", "cam-b/IMG_20.JPG"]);
  });

  it("uses a random rotation while keeping selections far apart", () => {
    const picked = pickSpreadImageNames(
      ["IMG_1.JPG", "IMG_2.JPG", "IMG_3.JPG", "IMG_4.JPG", "IMG_5.JPG", "IMG_6.JPG", "IMG_7.JPG", "IMG_8.JPG"],
      2,
      rngSequence([0.125, 0.5])
    );

    expect(picked).toEqual(["IMG_4.JPG", "IMG_8.JPG"]);
  });

  it("prefers COLMAP image names that include the images directory", () => {
    const dataset = createDatasetWithImages(["wide_20260516_211847.jpg", "wide_20260516_211848.jpg"]);
    writeColmapImagesTxt(dataset, ["images/wide_20260516_211848.jpg", "images/wide_20260516_211847.jpg"]);

    const picked = pickTimelapseImagesFromDataset(dataset, 2, rngSequence([0, 0.5]));

    expect(picked).toEqual(["images/wide_20260516_211847.jpg", "images/wide_20260516_211848.jpg"]);
  });

  it("reads COLMAP binary image names before falling back to filesystem names", () => {
    const dataset = createDatasetWithImages(["wide_20260516_211847.jpg", "wide_20260516_211848.jpg"]);
    writeColmapImagesBin(dataset, ["images/wide_20260516_211848.jpg", "images/wide_20260516_211847.jpg"]);

    const picked = pickTimelapseImagesFromDataset(dataset, 2, rngSequence([0, 0.5]));

    expect(picked).toEqual(["images/wide_20260516_211847.jpg", "images/wide_20260516_211848.jpg"]);
  });

  it("builds config with dataset images and custom interval", () => {
    const dataset = createDatasetWithImages(["cam_a.jpg", "cam_b.png", "cam_c.jpg"]);
    const config = buildAutoTimelapse({
      dataPath: dataset,
      every: 150,
      random: rngSequence([0, 0.5])
    });

    expect(config).toEqual({
      images: ["cam_a.jpg", "cam_c.jpg"],
      every: 150
    });
  });

  it("falls back to existing images when dataset scan is unavailable", () => {
    const config = buildAutoTimelapse({
      dataPath: "/not/exists",
      existingImages: ["  A.JPG ", "B.JPG"],
      every: -1
    });

    expect(config).toEqual({
      images: ["A.JPG", "B.JPG"],
      every: 1000
    });
  });

  it("returns undefined when no images are available", () => {
    const dataset = createDatasetWithImages([]);
    const config = buildAutoTimelapse({
      dataPath: dataset
    });
    expect(config).toBeUndefined();
  });
});
