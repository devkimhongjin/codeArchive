import type { PlatformCode } from "../enums/platform";

export interface ProblemInfo {
  platform: PlatformCode;
  platformProblemId: string;
  problemNumber?: string;
  slug?: string;
  title: string;
  url: string;
  difficulty?: string;
  tags: string[];
}