import { CODEARCHIVE_API_BASE_URL } from "../apiConfig";
import { listRelayPendingCaptures, markRelayConflicts, markRelayConflictsForRecords, markRelayImportReceipts, type RelayStateSnapshot } from "../solutionRepository";
import type { SolutionRecord } from "../solution";
import { indexedDbRelayStateRepository, type RelayStateRecord, type RelayStateRepository } from "./relayState";
import type { CodeArchiveAutomationState } from "../../../../packages/shared-types/src";

export const RELAY_DRAIN_ALARM = "codearchive-relay-drain";
const RETRY_DELAYS_MS = [60_000, 180_000, 600_000, 1_800_000, 3_600_000] as const;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RECORD_CODE_CHARS = 200_000;
const MAX_BATCH_CODE_CHARS = 1_000_000;

export interface RelayAlarmApi {
  create(name: string, info: { when: number }): Promise<void> | void;
  clear(name: string): Promise<boolean> | boolean;
  onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
}

export interface RelayFetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type RelayFetch = (input: string, init: RequestInit) => Promise<RelayFetchResponse>;

export interface RelayRuntimeDependencies {
  state?: RelayStateRepository;
  alarms?: RelayAlarmApi;
  fetch?: RelayFetch;
  now?: () => number;
  listPending?: (generation: number, limit?: number) => Promise<SolutionRecord[]>;
  markImported?: (ids: readonly string[], at: string) => Promise<void>;
  markConflicts?: (ids: readonly string[], at: string, errorCode?: string) => Promise<void>;
  markInvalid?: (records: readonly SolutionRecord[], at: string, errorCode: string) => Promise<void>;
}

export interface RelayPopupState {
  state: RelayStateRecord["state"];
  autoSyncEnabled: boolean;
  grantId?: string;
  generation?: number;
}

function isStateActive(state: RelayStateRecord, now: number): boolean {
  return state.state === "ACTIVE" && typeof state.credential === "string" && state.credential.length > 0
    && Number.isSafeInteger(state.generation) && (state.generation as number) > 0
    && typeof state.expiresAt === "string" && Date.parse(state.expiresAt) > now;
}

function validAbsoluteTimestamp(value: unknown): value is string {
  return typeof value === "string" && /T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim()) && Number.isFinite(Date.parse(value));
}

function solvedAtWireValue(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const trimmed = value.trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? Date.parse(`${trimmed}T00:00:00+09:00`)
    : validAbsoluteTimestamp(trimmed) ? Date.parse(trimmed) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function validBoundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

function relayRecordError(record: SolutionRecord, generation: number, now: number): string | undefined {
  if (!validBoundedText(record.clientRecordId, 128)) return "RELAY_RECORD_INVALID";
  if (record.platform !== "SWEA" && record.platform !== "PROGRAMMERS") return "RELAY_RECORD_INVALID";
  if (!validBoundedText(record.problemNumber, 64) || !validBoundedText(record.title, 255) || !validBoundedText(record.language, 64)) return "RELAY_RECORD_INVALID";
  if (typeof record.code !== "string" || record.code.trim().length === 0) return "RELAY_RECORD_INVALID";
  if (record.code.length > MAX_RECORD_CODE_CHARS) return "RELAY_RECORD_TOO_LARGE";
  if (record.autoCapture?.result !== "ACCEPTED") return "RELAY_RECORD_INVALID";
  if (!solvedAtWireValue(record.solvedAt) || !validAbsoluteTimestamp(record.autoCapture.observedAt)) return "RELAY_RECORD_INVALID";
  if (!validAbsoluteTimestamp(record.relayCapture?.capturedAt) || Date.parse(record.relayCapture.capturedAt) > now + 300_000) return "RELAY_RECORD_INVALID";
  if (!Number.isSafeInteger(record.relayCapture?.generation) || record.relayCapture.generation !== generation) return "RELAY_RECORD_INVALID";
  if (record.performance && (!validBoundedText(record.performance.executionTime, 128) || !validBoundedText(record.performance.memoryUsage, 128))) return "RELAY_RECORD_INVALID";
  if (record.aiUsage !== "used" && record.aiUsage !== "not_used" && record.aiUsage !== "unknown") return "RELAY_RECORD_INVALID";
  return undefined;
}

function payload(record: SolutionRecord) {
  return {
    clientRecordId: record.clientRecordId?.trim(),
    platform: record.platform,
    problemNumber: record.problemNumber.trim(),
    title: record.title.trim(),
    language: record.language.trim(),
    code: record.code,
    result: "ACCEPTED",
    solvedAt: solvedAtWireValue(record.solvedAt),
    observedAt: record.autoCapture?.observedAt ?? record.updatedAt,
    capturedAt: record.relayCapture?.capturedAt,
    executionTime: record.performance?.executionTime.trim() ?? null,
    memoryUsage: record.performance?.memoryUsage.trim() ?? null,
    aiUsage: record.aiUsage,
  };
}

function retryAfterMs(response: RelayFetchResponse, now: number): number | undefined {
  const value = response.headers.get("Retry-After");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class RelayRuntime {
  private readonly state: RelayStateRepository;
  private readonly alarms?: RelayAlarmApi;
  private readonly request: RelayFetch;
  private readonly now: () => number;
  private readonly listPending: (generation: number, limit?: number) => Promise<SolutionRecord[]>;
  private readonly markImported: (ids: readonly string[], at: string) => Promise<void>;
  private readonly markConflicts: (ids: readonly string[], at: string, errorCode?: string) => Promise<void>;
  private readonly markInvalid: (records: readonly SolutionRecord[], at: string, errorCode: string) => Promise<void>;
  private running = false;
  private blocked = false;

  constructor(dependencies: RelayRuntimeDependencies = {}) {
    this.state = dependencies.state ?? indexedDbRelayStateRepository;
    this.alarms = dependencies.alarms ?? (globalThis as { chrome?: { alarms?: RelayAlarmApi } }).chrome?.alarms;
    this.request = dependencies.fetch ?? ((input, init) => fetch(input, init));
    this.now = dependencies.now ?? (() => Date.now());
    this.listPending = dependencies.listPending ?? listRelayPendingCaptures;
    this.markImported = dependencies.markImported ?? markRelayImportReceipts;
    this.markConflicts = dependencies.markConflicts ?? markRelayConflicts;
    this.markInvalid = dependencies.markInvalid ?? markRelayConflictsForRecords;
  }

  start(): void {
    this.alarms?.onAlarm.addListener((alarm) => {
      if (alarm.name === RELAY_DRAIN_ALARM) void this.drain();
    });
    void this.reconstruct();
  }

  async onCaptureCommitted(): Promise<void> {
    await this.scheduleIfEligible();
  }

  async getPopupState(): Promise<RelayPopupState> {
    const state = await this.state.get();
    return {
      state: state.state,
      autoSyncEnabled: state.autoSyncEnabled === true,
      ...(state.grantId ? { grantId: state.grantId } : {}),
      ...(state.generation ? { generation: state.generation } : {}),
    };
  }

  async stopLocally(): Promise<RelayPopupState> {
    this.blocked = true;
    await this.disableLocalRelay();
    return this.getPopupState();
  }

  async onAutomationState(state: CodeArchiveAutomationState): Promise<void> {
    if (state.errorCode === "MULTIPLE_DASHBOARD_TABS") {
      this.blocked = true;
      await this.cancelAlarm();
      return;
    }
    if (!state.authenticated || !state.autoSyncEnabled) {
      this.blocked = true;
      await this.disableLocalRelay();
      return;
    }
    this.blocked = false;
    await this.state.update((current) => ({ ...current, autoSyncEnabled: true, failureCount: 0, nextRetryAt: undefined }));
    await this.scheduleIfEligible();
  }

  onMultipleDashboardTabs(): void {
    this.blocked = true;
    void this.cancelAlarm();
  }

  async onLogoutOrAccountChange(): Promise<void> {
    this.blocked = true;
    await this.disableLocalRelay();
  }

  private async reconstruct(): Promise<void> {
    try {
      const state = await this.state.get();
      if (state.state === "ACTIVE" && !isStateActive(state, this.now())) {
        await this.invalidate("EXPIRED");
      } else if (isStateActive(state, this.now()) && state.autoSyncEnabled) await this.scheduleIfEligible();
    } catch { /* fail closed; pairing or next capture can reconstruct the state */ }
  }

  private async scheduleIfEligible(delayMs = 0): Promise<void> {
    if (!this.alarms || this.blocked) return;
    const state = await this.state.get();
    if (state.state === "ACTIVE" && !isStateActive(state, this.now())) {
      await this.invalidate("EXPIRED");
      return;
    }
    if (!isStateActive(state, this.now()) || !state.autoSyncEnabled) return;
    await this.alarms.create(RELAY_DRAIN_ALARM, { when: this.now() + Math.max(0, delayMs) });
  }

  private async cancelAlarm(): Promise<void> {
    await this.alarms?.clear(RELAY_DRAIN_ALARM);
  }

  private async disableLocalRelay(): Promise<void> {
    await this.cancelAlarm();
    await this.state.update((current) => ({
      ...current,
      state: current.state === "ACTIVE" && current.grantId && current.generation ? "REVOCATION_PENDING" : current.state,
      credential: undefined,
      autoSyncEnabled: false,
      signedChallengeId: undefined,
      signedChallengeExpiresAt: undefined,
      nextRetryAt: undefined,
    }));
  }

  async drain(): Promise<void> {
    if (this.running || this.blocked) return;
    this.running = true;
    try {
      const state = await this.state.get();
      if (state.state === "ACTIVE" && !isStateActive(state, this.now())) {
        await this.invalidate("EXPIRED");
        return;
      }
      if (!isStateActive(state, this.now()) || !state.autoSyncEnabled) return;
      if (state.nextRetryAt && Date.parse(state.nextRetryAt) > this.now()) {
        await this.scheduleIfEligible(Date.parse(state.nextRetryAt) - this.now());
        return;
      }
      const generation = state.generation as number;
      const candidates = (await this.listPending(generation, 25)).filter((record) => record.relayCapture?.generation === generation);
      const invalidByReason = new Map<string, SolutionRecord[]>();
      const validRecords: SolutionRecord[] = [];
      for (const record of candidates) {
        const errorCode = relayRecordError(record, generation, this.now());
        if (errorCode) invalidByReason.set(errorCode, [...(invalidByReason.get(errorCode) ?? []), record]);
        else validRecords.push(record);
      }
      for (const [errorCode, invalidRecords] of invalidByReason) {
        await this.markInvalid(invalidRecords, new Date(this.now()).toISOString(), errorCode);
      }
      let batchCodeChars = 0;
      const records = validRecords
        .filter((record) => {
          if (batchCodeChars + record.code.length > MAX_BATCH_CODE_CHARS) return false;
          batchCodeChars += record.code.length;
          return true;
        });
      if (records.length === 0) return;
      const ids = records.map((record) => record.clientRecordId!);
      let response: RelayFetchResponse;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          response = await this.request(`${CODEARCHIVE_API_BASE_URL}/api/v1/relay/captures`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.credential}` },
            body: JSON.stringify({ records: records.map(payload) }),
            signal: controller.signal,
          });
        } finally { clearTimeout(timer); }
      } catch {
        await this.retry();
        return;
      }
      if (this.blocked) return;
      if (response.status === 401 || response.status === 403) {
        await this.invalidate(response.status === 401 ? "EXPIRED" : "INVALIDATED");
        return;
      }
      if (response.status === 429 || response.status >= 500) {
        await this.retry(retryAfterMs(response, this.now()));
        return;
      }
      if (!response.status.toString().startsWith("2")) {
        await this.invalidate("INVALIDATED");
        return;
      }
      const body = await response.json().catch(() => null);
      if (!isObject(body) || body.success !== true || !isObject(body.data) || !Array.isArray(body.data.results)) {
        await this.invalidate("INVALIDATED");
        return;
      }
      const imported: string[] = [];
      const conflicts: string[] = [];
      const seen = new Set<string>();
      for (const result of body.data.results) {
        if (!isObject(result) || typeof result.clientRecordId !== "string" || seen.has(result.clientRecordId)
          || !ids.includes(result.clientRecordId)) {
          await this.invalidate("INVALIDATED");
          return;
        }
        seen.add(result.clientRecordId);
        if ((result.outcome === "IMPORTED" || result.outcome === "EXISTING") && result.ackEligible === true && result.errorCode === null) imported.push(result.clientRecordId);
        else if (result.outcome === "CONFLICT" && result.ackEligible === false) conflicts.push(result.clientRecordId);
        else { await this.invalidate("INVALIDATED"); return; }
      }
      if (seen.size !== ids.length) { await this.invalidate("INVALIDATED"); return; }
      const at = new Date(this.now()).toISOString();
      if (this.blocked) return;
      if (imported.length) await this.markImported(imported, at);
      if (conflicts.length) await this.markConflicts(conflicts, at, "CLIENT_RECORD_CONFLICT");
      await this.state.update((current) => ({ ...current, failureCount: 0, nextRetryAt: undefined }));
      if (imported.length || records.length < candidates.length) await this.scheduleIfEligible();
    } finally {
      this.running = false;
    }
  }

  private async retry(retryAfter?: number): Promise<void> {
    const next = await this.state.update((current) => {
      const index = Math.min(Math.max(current.failureCount, 0), RETRY_DELAYS_MS.length - 1);
      const delay = Math.max(RETRY_DELAYS_MS[0], RETRY_DELAYS_MS[index], retryAfter ?? 0);
      return { ...current, failureCount: current.failureCount + 1, nextRetryAt: new Date(this.now() + delay).toISOString() };
    });
    await this.scheduleIfEligible(Math.max(0, Date.parse(next.nextRetryAt!) - this.now()));
  }

  private async invalidate(state: RelayStateSnapshot["state"]): Promise<void> {
    await this.cancelAlarm();
    await this.state.update((current) => ({ ...current, state, credential: undefined, autoSyncEnabled: false, signedChallengeId: undefined, signedChallengeExpiresAt: undefined, nextRetryAt: undefined }));
  }
}

export const backgroundRelayRuntime = new RelayRuntime();
