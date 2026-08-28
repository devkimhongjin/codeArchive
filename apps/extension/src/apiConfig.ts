type ImportMetaWithEnv = ImportMeta & { env?: Record<string, string | undefined> };

export const BETA_CODEARCHIVE_API_BASE_URL = "https://codearchive-api.onrender.com";

export const CODEARCHIVE_API_BASE_URL = (
  (import.meta as ImportMetaWithEnv).env?.VITE_CODEARCHIVE_API_BASE_URL
  ?? BETA_CODEARCHIVE_API_BASE_URL
).trim();
