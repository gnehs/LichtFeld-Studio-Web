import type { Response } from "express";
import type { EventPayload } from "./types/models.js";

interface Client {
  jobId: string;
  res: Response;
}

const clients = new Set<Client>();

export function registerSseClient(jobId: string, res: Response) {
  const client: Client = { jobId, res };
  clients.add(client);

  res.on("close", () => {
    clients.delete(client);
  });
}

export function emitJobEvent(payload: EventPayload) {
  const wire = `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    if (client.jobId === payload.jobId) {
      client.res.write(wire);
    }
  }
}
