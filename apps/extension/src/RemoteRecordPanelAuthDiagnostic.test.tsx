import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthLoginStageError } from "./authDiagnostics";
import { RemoteRecordPanel } from "./RemoteRecordPanel";
import type { CodeArchiveAuthService } from "./authSession";
import type { SolutionRecord } from "./solution";
import type { SolutionRepository } from "./solutionRepository";

const record: SolutionRecord = {
  id: "local-1",
  platform: "SWEA",
  problemNumber: "1234",
  title: "Test",
  language: "Java",
  code: "class Solution {}",
  solvedAt: "2026-08-26",
  aiUsage: "unknown",
  createdAt: "2026-08-26T00:00:00Z",
  updatedAt: "2026-08-26T00:00:00Z",
};

const repository: SolutionRepository = {
  create: vi.fn(),
  list: vi.fn(async () => [record]),
  getById: vi.fn(async () => record),
  update: vi.fn(),
  delete: vi.fn(),
  setSyncMetadata: vi.fn(),
};

describe("RemoteRecordPanel OAuth diagnostics", () => {
  it("shows only the delegated safe failure stage", async () => {
    const authService = {
      isConfigured: () => true,
      restore: vi.fn(async () => ({ status: "signed_out" as const })),
      login: vi.fn(async () => { throw new AuthLoginStageError("callback_validation"); }),
      logout: vi.fn(),
      getAuthenticatedSession: vi.fn(async () => null),
    } as unknown as CodeArchiveAuthService;

    render(<RemoteRecordPanel record={record} repository={repository} authService={authService} />);
    fireEvent.click(await screen.findByRole("button", { name: "GitHub로 로그인" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("진단 단계: callback_validation");
    expect(status.textContent).not.toMatch(/authorization|state=|code=|token|secret|github\.com\/login/i);
  });
});
