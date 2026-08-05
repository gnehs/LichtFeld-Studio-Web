import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emitJobEvent, registerSseClient } from "../src/sse.js";

class MockResponse extends EventEmitter {
  readonly writes: string[] = [];
  writableEnded = false;
  destroyed = false;

  write(chunk: string) {
    this.writes.push(chunk);
    return true;
  }
}

describe("SSE clients", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a comment heartbeat every 15 seconds and stops after close", () => {
    vi.useFakeTimers();
    const response = new MockResponse();

    registerSseClient("job-1", response as never);
    vi.advanceTimersByTime(14_999);
    expect(response.writes).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(response.writes).toEqual([": heartbeat\n\n"]);

    response.emit("close");
    vi.advanceTimersByTime(15_000);
    expect(response.writes).toEqual([": heartbeat\n\n"]);
  });

  it("broadcasts job events only to clients subscribed to the job", () => {
    vi.useFakeTimers();
    const first = new MockResponse();
    const second = new MockResponse();

    registerSseClient("job-1", first as never);
    registerSseClient("job-2", second as never);
    emitJobEvent({
      type: "job.status",
      jobId: "job-1",
      ts: new Date().toISOString(),
      data: { status: "completed" },
    });

    expect(first.writes).toHaveLength(1);
    expect(first.writes[0]).toContain('"status":"completed"');
    expect(second.writes).toHaveLength(0);

    first.emit("close");
    second.emit("close");
  });

  it("does not retain an already closed response", () => {
    vi.useFakeTimers();
    const response = new MockResponse();
    response.destroyed = true;

    registerSseClient("job-closed", response as never);
    vi.advanceTimersByTime(30_000);
    emitJobEvent({
      type: "log",
      jobId: "job-closed",
      ts: new Date().toISOString(),
      data: { lines: ["late"] },
    });

    expect(response.writes).toEqual([]);
  });
});
