import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage } from "node:http";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { logger } from "./logger.js";
import { datasetService } from "../services/datasetService.js";
import type { DatasetRecord } from "../types/models.js";

export const TUS_RESUMABLE_VERSION = "1.0.0";
export const TUS_UPLOAD_EXPIRATION_MS = 24 * 60 * 60 * 1000;

interface TusUploadRecord {
  id: string;
  uploadLength: number;
  uploadOffset: number;
  metadata: Record<string, string>;
  filePath: string;
  createdAt: string;
  lastActivityAt: string;
  completedAt: string | null;
  finalizedAt: string | null;
  dataset: DatasetRecord | null;
  errorMessage: string | null;
  /** 若此上傳為 concatenation 的一部分 part，標記為 true */
  isPart?: boolean;
}

const tusUploadDir = path.join(config.datasetsDir, "_uploads", "tus");
const finalizeInFlight = new Map<string, Promise<DatasetRecord>>();

fs.mkdirSync(tusUploadDir, { recursive: true });

function getUploadRecordPath(id: string) {
  const safeId = path.basename(id);
  return path.join(tusUploadDir, `${safeId}.json`);
}

function getUploadBinaryPath(id: string) {
  const safeId = path.basename(id);
  return path.join(tusUploadDir, `${safeId}.zip`);
}

function readUploadRecord(id: string): TusUploadRecord | null {
  const recordPath = getUploadRecordPath(id);
  if (!fs.existsSync(recordPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(recordPath, "utf-8")) as TusUploadRecord;
}

function writeUploadRecord(record: TusUploadRecord) {
  fs.writeFileSync(getUploadRecordPath(record.id), JSON.stringify(record, null, 2));
}

function removeUploadArtifacts(record: Pick<TusUploadRecord, "id" | "filePath">) {
  fs.rmSync(getUploadRecordPath(record.id), { force: true });
  fs.rmSync(record.filePath, { force: true });
}

function getExpirationBaseMs(record: TusUploadRecord): number {
  const source = record.lastActivityAt || record.finalizedAt || record.completedAt || record.createdAt;
  const parsed = Date.parse(source);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getTusUploadExpiresAt(record: Pick<TusUploadRecord, "createdAt" | "completedAt" | "finalizedAt" | "lastActivityAt">): string {
  return new Date(getExpirationBaseMs(record as TusUploadRecord) + TUS_UPLOAD_EXPIRATION_MS).toUTCString();
}

function isUploadExpired(record: TusUploadRecord, nowMs = Date.now()): boolean {
  return nowMs >= getExpirationBaseMs(record) + TUS_UPLOAD_EXPIRATION_MS;
}

function getActiveUploadRecord(id: string, nowMs = Date.now()): TusUploadRecord | null {
  const record = readUploadRecord(id);
  if (!record) {
    return null;
  }

  if (isUploadExpired(record, nowMs)) {
    removeUploadArtifacts(record);
    return null;
  }

  return record;
}

function requireUploadRecord(id: string): TusUploadRecord {
  const record = getActiveUploadRecord(id);
  if (!record) {
    throw new Error(`Upload not found: ${id}`);
  }
  return record;
}

function parseUploadLength(headerValue: string | undefined): number {
  const uploadLength = Number(headerValue);
  if (!Number.isSafeInteger(uploadLength) || uploadLength < 0) {
    throw new Error("Upload-Length must be a non-negative integer");
  }
  return uploadLength;
}

function parseContentLength(headerValue: string | undefined): number | null {
  if (headerValue == null) {
    return null;
  }

  const contentLength = Number(headerValue);
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    throw new Error("Content-Length must be a non-negative integer");
  }

  return contentLength;
}

export function parseTusMetadata(headerValue: string | undefined): Record<string, string> {
  if (!headerValue) {
    return {};
  }

  const metadata: Record<string, string> = {};
  for (const part of headerValue.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const separatorIndex = trimmed.indexOf(" ");
    const key = separatorIndex >= 0 ? trimmed.slice(0, separatorIndex) : trimmed;
    const encodedValue = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : "";
    if (!key) continue;

    metadata[key] = encodedValue ? Buffer.from(encodedValue, "base64").toString("utf-8") : "";
  }

  return metadata;
}

export function formatTusMetadata(metadata: Record<string, string | undefined>): string {
  return Object.entries(metadata)
    .filter(([, value]) => typeof value === "string")
    .map(([key, value]) => `${key} ${Buffer.from(value ?? "", "utf-8").toString("base64")}`)
    .join(",");
}

export const tusUploadStore = {
  cleanupExpiredUploads(nowMs = Date.now()) {
    if (!fs.existsSync(tusUploadDir)) {
      return;
    }

    const entries = fs.readdirSync(tusUploadDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const id = entry.name.slice(0, -5);
      const record = readUploadRecord(id);
      if (!record) {
        continue;
      }

      if (isUploadExpired(record, nowMs)) {
        removeUploadArtifacts(record);
      }
    }
  },

  createUpload(params: { uploadLength: number; metadata: Record<string, string> }) {
    this.cleanupExpiredUploads();
    const id = nanoid();
    const filePath = getUploadBinaryPath(id);
    fs.writeFileSync(filePath, "");
    const now = new Date().toISOString();

    const record: TusUploadRecord = {
      id,
      uploadLength: params.uploadLength,
      uploadOffset: 0,
      metadata: params.metadata,
      filePath,
      createdAt: now,
      lastActivityAt: now,
      completedAt: null,
      finalizedAt: null,
      dataset: null,
      errorMessage: null
    };

    writeUploadRecord(record);
    logger.info("tus upload created", {
      upload_id: id,
      upload_length: params.uploadLength,
      filename: params.metadata.filename ?? null
    });
    return record;
  },

  getUpload(id: string) {
    this.cleanupExpiredUploads();
    return getActiveUploadRecord(id);
  },

  async appendChunk(id: string, expectedOffset: number, request: IncomingMessage) {
    this.cleanupExpiredUploads();
    const record = requireUploadRecord(id);
    if (record.finalizedAt) {
      throw new Error("Upload already finalized");
    }
    if (expectedOffset !== record.uploadOffset) {
      const error = new Error("Upload offset mismatch") as Error & {
        currentOffset?: number;
      };
      error.currentOffset = record.uploadOffset;
      logger.warn("tus chunk offset mismatch", {
        upload_id: id,
        expected_offset: expectedOffset,
        current_offset: record.uploadOffset
      });
      throw error;
    }

    const contentLength = parseContentLength(request.headers["content-length"]);
    if (contentLength !== null && record.uploadOffset + contentLength > record.uploadLength) {
      throw new Error("Upload exceeds declared length");
    }

    let bytesReceived = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        bytesReceived += Buffer.byteLength(chunk);
        callback(null, chunk);
      }
    });

    try {
      await pipeline(
        request,
        meter,
        fs.createWriteStream(record.filePath, {
          flags: "r+",
          start: record.uploadOffset
        })
      );
    } catch (err) {
      logger.error("tus chunk pipeline failed", {
        upload_id: id,
        offset: record.uploadOffset,
        bytes_received_so_far: bytesReceived,
        ...logger.errFields(err)
      });
      throw err;
    }

    if (record.uploadOffset + bytesReceived > record.uploadLength) {
      throw new Error("Upload exceeds declared length");
    }

    record.uploadOffset += bytesReceived;
    record.lastActivityAt = new Date().toISOString();
    if (record.uploadOffset === record.uploadLength && !record.completedAt) {
      record.completedAt = new Date().toISOString();
    }
    record.errorMessage = null;
    writeUploadRecord(record);

    logger.debug("tus chunk received", {
      upload_id: id,
      bytes_received: bytesReceived,
      upload_offset: record.uploadOffset,
      upload_length: record.uploadLength,
      pct: record.uploadLength > 0
        ? Math.round((record.uploadOffset / record.uploadLength) * 100)
        : null
    });

    return record;
  },

  async completeUpload(id: string) {
    this.cleanupExpiredUploads();
    const existingPromise = finalizeInFlight.get(id);
    if (existingPromise) {
      return existingPromise;
    }

    const finalizePromise = (async () => {
      const record = requireUploadRecord(id);
      if (record.dataset) {
        logger.info("tus upload already finalized, returning cached result", { upload_id: id });
        return record.dataset;
      }
      if (record.uploadOffset < record.uploadLength) {
        throw new Error("Upload is not complete yet");
      }

      logger.info("tus upload finalizing", {
        upload_id: id,
        upload_length: record.uploadLength,
        filename: record.metadata.filename ?? null,
        dataset_name: record.metadata.datasetName ?? null
      });

      const item = await datasetService.createFromUpload({
        originalName: record.metadata.filename?.trim() || `${record.id}.zip`,
        zipPath: record.filePath,
        datasetName: record.metadata.datasetName?.trim() || undefined
      });

      record.dataset = item;
      record.finalizedAt = new Date().toISOString();
      record.lastActivityAt = record.finalizedAt;
      record.completedAt ??= record.finalizedAt;
      record.errorMessage = null;
      writeUploadRecord(record);

      logger.info("tus upload finalized", {
        upload_id: id,
        dataset_id: item.id,
        dataset_name: item.name
      });

      return item;
    })()
      .catch((error) => {
        logger.error("tus upload finalize failed", {
          upload_id: id,
          ...logger.errFields(error)
        });
        const record = readUploadRecord(id);
        if (record) {
          record.errorMessage = (error as Error).message;
          writeUploadRecord(record);
        }
        throw error;
      })
      .finally(() => {
        finalizeInFlight.delete(id);
      });

    finalizeInFlight.set(id, finalizePromise);
    return finalizePromise;
  },

  /**
   * 建立一個 part 上傳記錄（用於多線程 concatenation 的個別分片）。
   * part 記錄與一般上傳相同，但標記 isPart = true，不可直接 complete。
   */
  createPartUpload(params: { uploadLength: number; metadata: Record<string, string> }) {
    const record = this.createUpload(params);
    (record as TusUploadRecord).isPart = true;
    writeUploadRecord(record as TusUploadRecord);
    return record;
  },

  /**
   * 將多個已完成的 part 合併為一個新的上傳記錄，並立即觸發 finalize。
   * partIds 必須按照正確的位元組順序排列。
   */
  async concatenateUploads(params: {
    partIds: string[];
    metadata: Record<string, string>;
  }): Promise<DatasetRecord> {
    const { partIds, metadata } = params;
    if (partIds.length === 0) {
      throw new Error("At least one part is required for concatenation");
    }

    // 讀取並驗證所有 part
    const parts = partIds.map((partId) => {
      const record = getActiveUploadRecord(partId);
      if (!record) {
        throw new Error(`Part upload not found: ${partId}`);
      }
      if (record.uploadOffset < record.uploadLength) {
        throw new Error(`Part upload is not complete: ${partId}`);
      }
      return record;
    });

    // 計算總大小
    const totalLength = parts.reduce((sum, p) => sum + p.uploadLength, 0);

    // 建立合併後的上傳記錄與目標 ZIP 檔
    const id = nanoid();
    const filePath = getUploadBinaryPath(id);
    const now = new Date().toISOString();

    // 依序串接各 part 的 ZIP 資料
    const writeStream = fs.createWriteStream(filePath);
    await new Promise<void>((resolve, reject) => {
      writeStream.on("error", reject);
      writeStream.on("finish", resolve);

      (async () => {
        for (const part of parts) {
          await new Promise<void>((res, rej) => {
            const readStream = fs.createReadStream(part.filePath);
            readStream.on("error", rej);
            readStream.on("end", res);
            readStream.pipe(writeStream, { end: false });
          });
        }
        writeStream.end();
      })().catch(reject);
    });

    const record: TusUploadRecord = {
      id,
      uploadLength: totalLength,
      uploadOffset: totalLength,
      metadata,
      filePath,
      createdAt: now,
      lastActivityAt: now,
      completedAt: now,
      finalizedAt: null,
      dataset: null,
      errorMessage: null
    };

    writeUploadRecord(record);

    // 清除 part 暫存檔
    for (const part of parts) {
      removeUploadArtifacts(part);
    }

    // 觸發 finalize
    const item = await datasetService.createFromUpload({
      originalName: metadata.filename?.trim() || `${id}.zip`,
      zipPath: filePath,
      datasetName: metadata.datasetName?.trim() || undefined
    });

    record.dataset = item;
    record.finalizedAt = new Date().toISOString();
    record.lastActivityAt = record.finalizedAt;
    record.errorMessage = null;
    writeUploadRecord(record);

    return item;
  },

  parseUploadLength,
  parseContentLength,
  getUploadExpiresAt: getTusUploadExpiresAt
};

tusUploadStore.cleanupExpiredUploads();
