import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAutoTimelapse, pickTimelapseImagesFromDataset } from "../src/lib/autoTimelapse.js";

function createDatasetWithImages(names: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-dataset-"));
  const imagesDir = path.join(root, "images");
  fs.mkdirSync(imagesDir, { recursive: true });
  for (const name of names) {
    fs.writeFileSync(path.join(imagesDir, name), "image");
  }
  return root;
}

describe("autoTimelapse", () => {
  it("picks stable image names from dataset images folder", () => {
    const dataset = createDatasetWithImages(["IMG_20.JPG", "IMG_2.JPG", "README.txt", "IMG_10.JPG"]);
    const picked = pickTimelapseImagesFromDataset(dataset);
    expect(picked).toEqual(["IMG_2.JPG", "IMG_10.JPG"]);
  });

  it("builds config with dataset images and custom interval", () => {
    const dataset = createDatasetWithImages(["cam_a.jpg", "cam_b.png", "cam_c.jpg"]);
    const config = buildAutoTimelapse({
      dataPath: dataset,
      every: 150
    });

    expect(config).toEqual({
      images: ["cam_a.jpg", "cam_b.png"],
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
      every: 100
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
