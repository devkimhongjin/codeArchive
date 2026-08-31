import { useEffect, useRef, useState } from "react";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import { CommunityRateLimitError, CommunityUnavailableError } from "./communityClient";

const EVENT = "codearchive-community-invalidated";
const CHANNEL = "codearchive-community";
export function invalidateCommunity() {
  globalThis.dispatchEvent(new Event(EVENT));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage("invalidate"); // No code, account identifiers, or credentials.
    channel.close();
  }
}
export function communityError(error: unknown) {
  if (error instanceof CommunityUnavailableError) return "접근할 수 없습니다. 이 문제의 성공 풀이 공개 여부를 확인하세요. 상대 풀이가 비공개 또는 삭제되었을 수도 있습니다.";
  if (error instanceof CommunityRateLimitError) return "요청이 많습니다. 잠시 후 다시 시도하세요.";
  return "커뮤니티를 불러오지 못했습니다. 다시 시도해 주세요.";
}

// No durable source cache. Abort and generation checks cover account/problem changes,
// revocation, background tabs and late responses from an old authenticated context.
export function useCommunityResource<T>(load: ((signal: AbortSignal) => Promise<T>) | null, onExpired: () => void) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mutating = useRef(false);
  const preserve = useRef(false);
  const loadRef = useRef(load); loadRef.current = load;
  const expiredRef = useRef(onExpired); expiredRef.current = onExpired;
  function clear() { generation.current++; controller.current?.abort(); setData(null); setError(""); setBusy(false); }
  function refresh() { clear(); setRevision((v) => v + 1); }
  useEffect(() => {
    const reload = () => { clear(); if (!document.hidden) setRevision((v) => v + 1); };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    channel?.addEventListener("message", reload);
    globalThis.addEventListener(EVENT, reload);
    globalThis.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", reload);
    const timer = globalThis.setInterval(() => {
      if (!document.hidden && !mutating.current) { preserve.current = true; setRevision((v) => v + 1); }
    }, 15000);
    return () => { clearInterval(timer); channel?.close(); globalThis.removeEventListener(EVENT, reload); globalThis.removeEventListener("focus", reload); document.removeEventListener("visibilitychange", reload); };
  }, []);
  const enabled = load !== null;
  useEffect(() => {
    const mine = ++generation.current;
    const abort = new AbortController(); controller.current = abort;
    if (!preserve.current) setData(null);
    preserve.current = false; setError("");
    if (!loadRef.current || document.hidden) return () => abort.abort();
    setBusy(true);
    void loadRef.current(abort.signal).then((result) => {
      if (generation.current === mine && !abort.signal.aborted) setData(result);
    }).catch((cause: unknown) => {
      if (generation.current !== mine || abort.signal.aborted) return;
      setData(null);
      if (cause instanceof ArchiveSessionExpiredError) expiredRef.current();
      else setError(communityError(cause));
    }).finally(() => { if (generation.current === mine && !abort.signal.aborted) setBusy(false); });
    return () => { abort.abort(); controller.current?.abort(); generation.current++; };
  }, [enabled, revision]);
  async function mutate(action: (signal: AbortSignal) => Promise<unknown>, after?: () => void) {
    if (busy || mutating.current) return;
    controller.current?.abort();
    const mine = ++generation.current;
    const abort = new AbortController(); controller.current = abort;
    mutating.current = true;
    setBusy(true); setError("");
    try {
      await action(abort.signal);
      if (mine !== generation.current || abort.signal.aborted) return;
      after?.(); refresh();
    } catch (cause) {
      if (mine !== generation.current || abort.signal.aborted) return;
      // Never retain peer code/counts after a failed authorization or stale session.
      setData(null);
      if (cause instanceof ArchiveSessionExpiredError) expiredRef.current();
      else setError(communityError(cause));
    } finally { mutating.current = false; if (mine === generation.current) setBusy(false); }
  }
  return { data, error, busy, refresh, clear, mutate };
}
