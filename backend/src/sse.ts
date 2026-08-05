import type { Response } from "express";
import type { EventPayload } from "./types/models.js";

interface Client {
  jobId: string;
  res: Response;
  heartbeat: NodeJS.Timeout;
}

const clients = new Set<Client>();

const SSE_HEARTBEAT_MS = 15_000;

function removeClient(client: Client) {
  clearInterval(client.heartbeat);
  clients.delete(client);
}

export function registerSseClient(jobId: string, res: Response) {
  if (res.writableEnded || res.destroyed) {
    return;
  }

  let client: Client;
  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      removeClient(client);
      return;
    }
    try {
      res.write(": heartbeat\n\n");
    } catch {
      removeClient(client);
    }
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref?.();

  client = { jobId, res, heartbeat };
  clients.add(client);

  const cleanup = () => removeClient(client);
  res.once("close", cleanup);
  res.once("error", cleanup);
}

export function emitJobEvent(payload: EventPayload) {
  const wire = `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    if (client.jobId === payload.jobId) {
      if (client.res.writableEnded || client.res.destroyed) {
        removeClient(client);
        continue;
      }
      try {
        client.res.write(wire);
      } catch {
        removeClient(client);
      }
    }
  }
}
