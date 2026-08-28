export const MAIN_API_ORIGIN = "https://codearchive-api.onrender.com";
export const DASHBOARD_LOGIN_URL = `${MAIN_API_ORIGIN}/api/v1/auth/github/dashboard-login`;
const SESSION_URL = `${MAIN_API_ORIGIN}/api/v1/me`;
const LOGOUT_URL = `${MAIN_API_ORIGIN}/api/v1/auth/logout`;

export interface DashboardUser {
  readonly githubLogin: string;
  readonly displayName: string;
  readonly avatarUrl: string;
}

export type SessionDiscovery =
  | { readonly status: "authenticated"; readonly user: DashboardUser }
  | { readonly status: "signed_out" }
  | { readonly status: "unavailable" };

export interface DashboardAuthClient {
  discoverSession(): Promise<SessionDiscovery>;
  login(): void;
  logout(beforeApiLogout?: () => Promise<void> | void): Promise<boolean>;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Navigate = (url: string) => void;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseUser(value: unknown): DashboardUser | null {
  if (!isObject(value)) return null;
  if (typeof value.githubLogin !== "string" || !value.githubLogin.trim()) return null;
  if (typeof value.displayName !== "string") return null;
  if (typeof value.avatarUrl !== "string") return null;
  return {
    githubLogin: value.githubLogin,
    displayName: value.displayName,
    avatarUrl: value.avatarUrl,
  };
}

function parseMeEnvelope(value: unknown): DashboardUser | null {
  if (!isObject(value) || value.success !== true) return null;
  return parseUser(value.data);
}

export function createDashboardAuthClient(
  fetcher: FetchLike = globalThis.fetch.bind(globalThis),
  navigate: Navigate = (url) => globalThis.location.assign(url),
): DashboardAuthClient {
  return {
    async discoverSession() {
      try {
        const response = await fetcher(SESSION_URL, {
          method: "GET",
          credentials: "include",
        });
        if (response.status === 401) return { status: "signed_out" };
        if (!response.ok) return { status: "unavailable" };
        const user = parseMeEnvelope(await response.json());
        return user ? { status: "authenticated", user } : { status: "unavailable" };
      } catch {
        return { status: "unavailable" };
      }
    },

    login() {
      navigate(DASHBOARD_LOGIN_URL);
    },

    async logout(beforeApiLogout = () => undefined) {
      try {
        await beforeApiLogout();
        const response = await fetcher(LOGOUT_URL, {
          method: "POST",
          credentials: "include",
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}

export const dashboardAuthClient = createDashboardAuthClient();
