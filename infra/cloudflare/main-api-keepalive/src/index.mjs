const DEFAULT_HEALTH_URL =
  "https://codearchive-api.onrender.com/actuator/health";

function configuredHealthUrl(env) {
  const value = env?.MAIN_API_HEALTH_URL;
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : DEFAULT_HEALTH_URL;
}

/**
 * Performs one credential-free health request. Redirects are rejected so the
 * scheduled request cannot follow an unexpected host.
 */
export async function keepMainApiAwake({
  env = {},
  fetchImpl = fetch,
} = {}) {
  try {
    await fetchImpl(configuredHealthUrl(env), {
      method: "GET",
      redirect: "error",
    });
  } catch {
    // Keep scheduled failures quiet and bounded; the next schedule is the
    // only retry. Response status and body are intentionally not inspected.
  }
}

export default {
  async scheduled(_controller, env) {
    await keepMainApiAwake({ env });
  },
};
