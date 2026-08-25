import { describe, expect, it, vi } from "vitest";
import { cacheSweaFamilyContext, trustedFamilyContext } from "./adapters/swea/sweaHistoryFallback";
import { captureAccepted } from "./sweaAutoCapture";

const url = new URL("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=current");
const accepted = { status: "observed" as const, submission: { result: "ACCEPTED" as const, observedAt: "2026-08-25T01:11:00.000Z" }, warnings: [] };
const row = `<div class="problem_smt"><div class="submitter"><dl class="smt_txt"><dt>#Beginner</dt><dd>제출일 : 2026-08-25 10:10</dd></dl></div><div class="info"><ul><li><span>Java</span><span>언어</span></li><li><span>12,345 kb</span><span>메모리</span></li><li><span>67 ms</span><span>시간</span></li><li><span>6 Bytes</span><span>코드길이</span></li><li><span>Pass</span><span>결과</span></li></ul></div></div>`;

function doc(history = ""): Document {
  return new DOMParser().parseFromString(`<div class="problem_box"><h3>1234. Synthetic title</h3></div><input id="contestProbId" value="current"><select id="selectCodeLang"><option selected>Java 17</option></select><textarea id="textSource">latest</textarea><header><span class="name">Beginner</span></header>${history}`, "text/html");
}

function historyForm(rows = row): string {
  return `<form id="contestProbForm"><input name="contestProbId" value="current"><div class="box-list"><div class="box-list-inner">${rows}</div></div></form>`;
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; }, clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; }, key(index) { return Array.from(values.keys())[index] ?? null; },
    removeItem(key) { values.delete(key); }, setItem(key, value) { values.set(key, value); },
  };
}

const referrer = "https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do?contestProbId=current";
const detailHtml = `<a href="/main/code/userProblem/userProblemSubmitHistory.do?contestProbId=current">제출 이력</a>`;
const historyHtml = `<header><span class="name">Beginner</span></header>${historyForm()}`;

function response(body: string, ok = true): Response {
  return { ok, text: async () => body } as Response;
}

function sender() {
  return vi.fn(async () => ({ status: "saved" as const, solutionId: "swea-auto:uuid", savedAt: "2026-08-25T01:11:01.000Z" }));
}

describe("captureAccepted history fallback", () => {
  it("does not fetch when primary same-page performance succeeds", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await captureAccepted(doc(historyForm()), url, accepted, sender(), () => "uuid", () => ({ status: "synced" }), 0, { referrer, storage: memoryStorage(), fetcher });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("discovers and follows the exact history href after a primary miss", async () => {
    const send = sender();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(detailHtml))
      .mockResolvedValueOnce(response(historyHtml));

    await captureAccepted(doc(historyForm("")), url, accepted, send, () => "uuid", () => ({ status: "synced" }), 0, { referrer, storage: memoryStorage(), fetcher });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe(referrer);
    expect(fetcher.mock.calls[1][0]).toBe("https://swexpertacademy.com/main/code/userProblem/userProblemSubmitHistory.do?contestProbId=current");
    expect(send.mock.calls[0][0]).toMatchObject({ capture: { performance: { memoryUsage: "12,345 kb", executionTime: "67 ms" } } });
  });

  it("uses matching cached context after reload", async () => {
    const storage = memoryStorage();
    cacheSweaFamilyContext(storage, trustedFamilyContext(referrer, "current")!);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(detailHtml)).mockResolvedValueOnce(response(historyHtml));
    const send = sender();

    await captureAccepted(doc(historyForm("")), url, accepted, send, () => "uuid", () => ({ status: "synced" }), 0, { referrer: "", storage, fetcher });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({ capture: { performance: { executionTime: "67 ms" } } });
  });

  it("rejects a cache entry for a different contestProbId", async () => {
    const storage = memoryStorage();
    const other = trustedFamilyContext("https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do?contestProbId=other", "other")!;
    cacheSweaFamilyContext(storage, other);
    const fetcher = vi.fn<typeof fetch>();
    const send = sender();

    await captureAccepted(doc(historyForm("")), url, accepted, send, () => "uuid", () => ({ status: "synced" }), 0, { referrer: "", storage, fetcher });

    expect(fetcher).not.toHaveBeenCalled();
    expect((send.mock.calls[0][0] as any).capture.performance).toBeUndefined();
  });

  it("preserves ACCEPTED source save when fallback fetch fails", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("network"));
    const send = sender();

    await captureAccepted(doc(historyForm("")), url, accepted, send, () => "uuid", () => ({ status: "synced" }), 0, { referrer, storage: memoryStorage(), fetcher });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ capture: { result: "ACCEPTED", code: "latest" } });
    expect((send.mock.calls[0][0] as any).capture.performance).toBeUndefined();
  });
});
