export type MessageTone = "info" | "success" | "error";

export interface Notice {
  tone: MessageTone;
  text: string;
}

export interface JobInsight {
  latestFramePath: string | null;
  latestIteration: number | null;
}
