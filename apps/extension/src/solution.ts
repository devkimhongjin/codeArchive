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
