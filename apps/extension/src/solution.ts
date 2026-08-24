export type AiUsage = "used" | "not_used" | "unknown";

export interface SolutionRecord {
  id: string;
  platform: string;
  problemNumber: string;
  title: string;
  language: string;
  code: string;
  solvedAt: string | null;
  aiUsage: AiUsage;
  createdAt: string;
  updatedAt: string;
  autoCapture?: { source: "SWEA_AUTO"; result: "ACCEPTED"; observedAt: string };
}

export interface NewSolutionInput {
  platform: string;
  problemNumber: string;
  title: string;
  language: string;
  code: string;
  solvedAt: string | null;
  aiUsage: AiUsage;
}
