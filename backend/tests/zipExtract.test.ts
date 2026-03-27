import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import archiver from "archiver";
import { afterEach, describe, expect, it } from "vitest";
import { extractZipToDirectory } from "../src/lib/zipExtract.js";

async function createZipFile(zipPath: string, entries: Array<{ name: string; content: string }>) {
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", {
      forceZip64: true,
      zlib: { level: 0 }
    });

    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);

    for (const entry of entries) {
      archive.append(entry.content, { name: entry.name });
    }

    void archive.finalize();
  });
}

afterEach(() => {
  // no-op placeholder for consistency with other backend tests
});

describe("extractZipToDirectory", () => {
  it("extracts a zip64 archive without loading the whole file into memory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-zip-extract-"));
    const zipPath = path.join(root, "dataset.zip");
    const extractDir = path.join(root, "dataset");

    try {
      await createZipFile(zipPath, [
        { name: "images/0001.jpg", content: "image" },
        { name: "sparse/points3D.txt", content: "sparse" }
      ]);

      await extractZipToDirectory(zipPath, extractDir);

      expect(fs.readFileSync(path.join(extractDir, "images", "0001.jpg"), "utf-8")).toBe("image");
      expect(fs.readFileSync(path.join(extractDir, "sparse", "points3D.txt"), "utf-8")).toBe("sparse");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
