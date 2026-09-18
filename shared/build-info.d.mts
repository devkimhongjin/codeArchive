export interface ResolvedBuildInfo {
  version: string;
  buildId: string;
  updatedDate: string;
}

export function resolveBuildInfo(options?: {
  env?: Record<string, string | undefined>;
  cwd?: string;
}): ResolvedBuildInfo;

export function buildDefines(info: ResolvedBuildInfo): Record<string, string>;
