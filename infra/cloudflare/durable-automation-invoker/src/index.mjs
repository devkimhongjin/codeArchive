const INVOCATION_URL =
  "https://codearchive-api.onrender.com/api/v1/internal/automation/invoke";
const TOKEN_BINDING = "CODEARCHIVE_DURABLE_INVOCATION_TOKEN";
const TOKEN_HEADER = "X-CodeArchive-Invocation-Token";
const MAX_INVOCATIONS_PER_EVENT = 5;
const SAFE_STATUSES = new Set(["IDLE", "SUCCEEDED", "REJECTED", "UNKNOWN"]);

function configuredToken(env) {
  const token = env?.[TOKEN_BINDING];
  return typeof token === "string" && token.trim() !== "" ? token : null;
}

async function invokeOnce(env, fetchImpl) {
  const token = configuredToken(env);
  if (token === null) {
    return { kind: "configuration" };
  }

  let response;
  try {
    response = await fetchImpl(INVOCATION_URL, {
      method: "POST",
      headers: {
        [TOKEN_HEADER]: token,
      },
    });
  } catch {
    return { kind: "transport" };
  }

  if (!response || !response.ok) {
    return { kind: "http" };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { kind: "malformed" };
  }

  const status = payload?.success === true
    ? payload?.data?.status
    : undefined;
  if (typeof status !== "string" || !SAFE_STATUSES.has(status)) {
    return { kind: "malformed" };
  }

  return { kind: "status", status };
}

/**
 * Runs the bounded sequence and returns only test-safe control-flow metadata.
 * No response body, token, URL input, or provider data is logged or returned.
 */
export async function runInvocations({
  env,
  fetchImpl = fetch,
  maxInvocations = MAX_INVOCATIONS_PER_EVENT,
} = {}) {
  const limit = Number.isInteger(maxInvocations)
    ? Math.min(Math.max(maxInvocations, 0), MAX_INVOCATIONS_PER_EVENT)
    : MAX_INVOCATIONS_PER_EVENT;
  const statuses = [];

  for (let attempt = 0; attempt < limit; attempt += 1) {
    const outcome = await invokeOnce(env, fetchImpl);
    if (outcome.kind !== "status") {
      return { attempts: attempt + 1, statuses, stopped: outcome.kind };
    }

    statuses.push(outcome.status);
    if (outcome.status !== "SUCCEEDED") {
      return { attempts: attempt + 1, statuses, stopped: outcome.status };
    }
  }

  return { attempts: statuses.length, statuses, stopped: "CAP" };
}

export default {
  async scheduled(_controller, env) {
    await runInvocations({ env });
  },
};
