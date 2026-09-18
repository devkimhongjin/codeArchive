declare const __CODEARCHIVE_VERSION__: string;
declare const __CODEARCHIVE_BUILD_ID__: string;
declare const __CODEARCHIVE_UPDATED_DATE__: string;

export interface BuildMetadata {
  version: string;
  buildId: string;
  updatedDate: string;
}

export const BUILD_METADATA: BuildMetadata = {
  version: typeof __CODEARCHIVE_VERSION__ === "string" ? __CODEARCHIVE_VERSION__ : "dev",
  buildId: typeof __CODEARCHIVE_BUILD_ID__ === "string" ? __CODEARCHIVE_BUILD_ID__ : "dev+source-unknown",
  updatedDate: typeof __CODEARCHIVE_UPDATED_DATE__ === "string" ? __CODEARCHIVE_UPDATED_DATE__ : "dev"
};

export function buildLabel(metadata: BuildMetadata = BUILD_METADATA): string {
  return `v${metadata.version} · ${metadata.buildId}`;
}

export function updatedLabel(metadata: BuildMetadata = BUILD_METADATA): string {
  return metadata.updatedDate === "dev" ? "Updated dev" : `Updated ${metadata.updatedDate}`;
}
