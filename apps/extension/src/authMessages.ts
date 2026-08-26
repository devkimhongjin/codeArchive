import type { AuthLoginFailureStage } from "./authDiagnostics";
import type { AuthViewState } from "./authSession";

export const AUTH_LOGIN = "CODEARCHIVE_AUTH_LOGIN" as const;

export type AuthLoginRequest = { type: typeof AUTH_LOGIN };

export type AuthLoginResponse =
  | { ok: true; state: AuthViewState }
  | { ok: false; error: AuthLoginFailureStage };
