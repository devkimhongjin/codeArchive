import { describe, expect, it } from "vitest";
import { canEnrichAcceptedCapturePerformance, isRelayCaptureEligible } from "./solutionRepository";
import type { SolutionRecord } from "./solution";

const savedAt = "2026-08-24T12:00:01.000Z";
const record: SolutionRecord = {
  id: "swea-auto:uuid",
  clientRecordId: "client-uuid",
  platform: "SWEA",
  problemNumber: "1234",
  title: "Synthetic title",
  language: "Java",
  code: "latest",
  solvedAt: "2026-08-24",
  aiUsage: "unknown",
  createdAt: savedAt,
  updatedAt: savedAt,
  autoCapture: { source: "SWEA_AUTO", result: "ACCEPTED", observedAt: "2026-08-24T12:00:00.000Z" },
};

describe("late SWEA performance enrichment guard", () => {
  it("only accepts the untouched original SWEA capture", () => {
    expect(canEnrichAcceptedCapturePerformance(record, savedAt)).toBe(true);
    expect(canEnrichAcceptedCapturePerformance({ ...record, updatedAt: "2026-08-24T12:01:00.000Z" }, savedAt)).toBe(false);
    expect(canEnrichAcceptedCapturePerformance({ ...record, performance: { executionTime: "1 ms", memoryUsage: "2 kb" } }, savedAt)).toBe(false);
    expect(canEnrichAcceptedCapturePerformance({ ...record, platform: "PROGRAMMERS" }, savedAt)).toBe(false);
  });

  it("still permits local optional enrichment after relay ACK without resetting relay eligibility", () => {
    const acknowledged: SolutionRecord = {
      ...record,
      relayCapture: { grantId: "grant-a", generation: 7, capturedAt: savedAt },
      relayImportReceipt: { importedAt: "2026-08-24T12:00:03.000Z" },
    };

    // Relay ACK metadata does not mutate the immutable local capture fields, so
    // a very-late performance result may still enrich the local archive record.
    // listRelayPendingCaptures separately excludes relayImportReceipt records;
    // therefore this does not create an automatic follow-up server transfer.
    expect(canEnrichAcceptedCapturePerformance(acknowledged, savedAt)).toBe(true);
  });
});

describe("durable relay eligibility", () => {
  const now = Date.parse("2026-08-24T12:00:00.000Z");

  it("keeps a no-performance SWEA capture out of every relay trigger until its bound", () => {
    const deferred: SolutionRecord = { ...record, relayEligibility: { eligibleAt: new Date(now + 5_000).toISOString() } };
    expect(isRelayCaptureEligible(deferred, now)).toBe(false);
    expect(isRelayCaptureEligible(deferred, now + 4_999)).toBe(false);
    expect(isRelayCaptureEligible(deferred, now + 5_000)).toBe(true);
  });

  it("fails closed for malformed scheduling metadata", () => {
    expect(isRelayCaptureEligible({ ...record, relayEligibility: { eligibleAt: "not-a-date" } }, now)).toBe(false);
  });
});
