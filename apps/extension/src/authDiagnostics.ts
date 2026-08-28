export type AuthLoginFailureStage =
  | "login_start"
  | "login_start_host_access"
  | "login_start_fetch"
  | "login_start_fetch_origin"
  | "login_start_fetch_request"
  | "login_start_http"
  | "login_start_json"
  | "login_start_envelope"
  | "web_auth_launch"
  | "callback_validation"
  | "exchange"
  | "me"
  | "auth_failed";

export class AuthLoginStageError extends Error {
  constructor(public readonly stage: AuthLoginFailureStage) {
    super(`Authentication failed at ${stage}.`);
    this.name = "AuthLoginStageError";
  }
}

export function authLoginFailureMessage(stage: AuthLoginFailureStage): string {
  return stage === "auth_failed"
    ? "GitHub 로그인을 완료하지 못했습니다. 진단 단계: auth_failed"
    : `GitHub 로그인을 완료하지 못했습니다. 진단 단계: ${stage}`;
}
