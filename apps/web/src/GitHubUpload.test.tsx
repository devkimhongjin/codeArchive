import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GitHubUpload } from "./GitHubUpload";
import { GitHubAutoCommit } from "./GitHubAutoCommit";
import { GitHubRequestError, type GitHubAutoStatus, type GitHubConfirmation, type GitHubCommitResult } from "./githubClient";
import { deferred, githubTestClient, githubTestConfirmation, githubTestOff, githubTestResult, githubTestSource, githubTestTarget } from "./githubTestFixtures";
import { ArchiveSessionExpiredError } from "./archiveDataSource";

async function selectTarget() {
  fireEvent.click(screen.getByRole("button", { name: "GitHub 저장소 연결 확인" }));
  await screen.findByRole("option", { name: "synthetic" });
  fireEvent.change(screen.getByLabelText("GitHub 연결"), { target: { value: "701" } });
  await screen.findByRole("option", { name: "synthetic/solutions · 비공개" });
  fireEvent.change(screen.getByLabelText("저장소", { exact: true }), { target: { value: "801" } });
  await screen.findByRole("option", { name: "main" });
  fireEvent.change(screen.getByLabelText("브랜치", { exact: true }), { target: { value: "main" } });
}
describe("GitHub upload Dashboard", () => {
  it("makes no integration requests before opening, and requires reviewed consent before exactly one commit", async () => {
    const client = githubTestClient(); render(<GitHubUpload client={client} solution={githubTestSource} syncEligible onSessionExpired={vi.fn()} />);
    expect(client.installations).not.toHaveBeenCalled(); expect(client.autoEnable).not.toHaveBeenCalled();
    await selectTarget();
    fireEvent.click(screen.getByRole("button", { name: "코드·경로 미리보기" }));
    await screen.findByText("class Synthetic {}");
    const commit = screen.getByRole("button", { name: "확인한 풀이 커밋" });
    expect(commit).toBeDisabled(); expect(client.commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("위 코드·경로·메시지를 GitHub에 전송합니다."));
    expect(commit).toBeDisabled();
    fireEvent.click(screen.getByLabelText("저장소 공개 여부가 바뀔 수 있고 전송한 코드는 자동 회수되지 않음을 확인했습니다."));
    fireEvent.click(commit); fireEvent.click(commit);
    await screen.findByText("커밋 완료", { selector: "strong" });
    expect(client.commit).toHaveBeenCalledTimes(1);
    expect(client.commit).toHaveBeenCalledWith(githubTestConfirmation.intentId, { confirmUpload: true, acknowledgeVisibilityRisk: true, confirmPublicUpload: false }, expect.any(AbortSignal));
    expect(client.autoEnable).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "GitHub 커밋 보기" })).toHaveAttribute("href", githubTestResult.commitUrl);
  });
  it("discards late preview after source change, invalidates old consent and cancels on unmount", async () => {
    const client = githubTestClient(); const pending = deferred<GitHubConfirmation>(); vi.mocked(client.prepare).mockReturnValue(pending.promise);
    const view = render(<GitHubUpload client={client} solution={githubTestSource} syncEligible onSessionExpired={vi.fn()} />);
    await selectTarget(); fireEvent.click(screen.getByRole("button", { name: "코드·경로 미리보기" }));
    view.rerender(<GitHubUpload client={client} solution={{ ...githubTestSource, id: "33333333-3333-4333-8333-333333333333" }} syncEligible onSessionExpired={vi.fn()} />);
    await act(async () => pending.resolve(githubTestConfirmation));
    expect(screen.queryByText("class Synthetic {}")).not.toBeInTheDocument();
    expect(vi.mocked(client.prepare).mock.calls[0][1]?.aborted).toBe(true);
    view.unmount(); expect(client.commit).not.toHaveBeenCalled();
  });
  it("does not retry an uncertain send and uses read-only result lookup", async () => {
    const client = githubTestClient(); vi.mocked(client.commit).mockRejectedValue(new Error("private provider details"));
    render(<GitHubUpload client={client} solution={githubTestSource} syncEligible onSessionExpired={vi.fn()} />); await selectTarget();
    fireEvent.click(screen.getByRole("button", { name: "코드·경로 미리보기" })); await screen.findByText("class Synthetic {}");
    fireEvent.click(screen.getByLabelText("위 코드·경로·메시지를 GitHub에 전송합니다."));
    fireEvent.click(screen.getByLabelText("저장소 공개 여부가 바뀔 수 있고 전송한 코드는 자동 회수되지 않음을 확인했습니다."));
    fireEvent.click(screen.getByRole("button", { name: "확인한 풀이 커밋" }));
    await screen.findByText(/GitHub 요청을 완료하지/);
    expect(screen.getByRole("button", { name: "코드·경로 미리보기" })).toBeDisabled();
    expect(screen.queryByText("private provider details")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "전송 결과 확인" }));
    await screen.findByText("커밋 완료", { selector: "strong" }); expect(client.commit).toHaveBeenCalledTimes(1); expect(client.result).toHaveBeenCalledTimes(1);
  });
  it("requires extra public consent and clears it when the target changes", async () => {
    const client = githubTestClient(); vi.mocked(client.prepare).mockResolvedValue({ ...githubTestConfirmation, preview: { ...githubTestConfirmation.preview, target: { ...githubTestConfirmation.preview.target, privateRepository: false } } });
    render(<GitHubUpload client={client} solution={githubTestSource} syncEligible onSessionExpired={vi.fn()} />); await selectTarget();
    fireEvent.click(screen.getByRole("button", { name: "코드·경로 미리보기" })); await screen.findByText("class Synthetic {}");
    fireEvent.click(screen.getByLabelText("위 코드·경로·메시지를 GitHub에 전송합니다.")); fireEvent.click(screen.getByLabelText("저장소 공개 여부가 바뀔 수 있고 전송한 코드는 자동 회수되지 않음을 확인했습니다."));
    expect(screen.getByRole("button", { name: "확인한 풀이 커밋" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("공개 저장소에 코드를 공개합니다.")); expect(screen.getByRole("button", { name: "확인한 풀이 커밋" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("파일 경로 (선택)"), { target: { value: "Other.java" } }); expect(screen.queryByRole("button", { name: "확인한 풀이 커밋" })).not.toBeInTheDocument();
  });
  it("shows safe disabled-provider guidance and propagates session expiry", async () => {
    const client = githubTestClient(); const expired = vi.fn(); vi.mocked(client.installations).mockRejectedValueOnce(new GitHubRequestError("GITHUB_INTEGRATION_UNAVAILABLE")).mockRejectedValueOnce(new ArchiveSessionExpiredError());
    render(<GitHubUpload client={client} solution={githubTestSource} syncEligible onSessionExpired={expired} />);
    fireEvent.click(screen.getByRole("button", { name: "GitHub 저장소 연결 확인" })); await screen.findByText(/아직 활성화되지 않았습니다/);
    fireEvent.click(screen.getByRole("button", { name: "GitHub 연결 다시 확인" })); await waitFor(() => expect(expired).toHaveBeenCalledTimes(1));
  });
});

async function consentAuto() {
  await act(async () => {});
  const section = screen.getByRole("region", { name: "자동 풀이 커밋" });
  fireEvent.click(within(section).getByLabelText("선택한 저장소·브랜치·폴더로 새 풀이 코드를 자동 전송하는 데 동의합니다."));
  fireEvent.click(within(section).getByLabelText("비공개 저장소도 공개로 바뀔 수 있고, OFF로 바꿔도 전송한 코드는 회수되지 않음을 확인했습니다."));
}
describe("automatic commit lifecycle", () => {
  it("defaults OFF, enables only with independent consent and stops on disconnect without resuming", async () => {
    const client = githubTestClient(); const props = { client, target: githubTestTarget, eligible: true, blocked: false, onLock: vi.fn(), onSessionExpired: vi.fn() };
    const view = render(<GitHubAutoCommit {...props} />);
    expect(screen.getByText("OFF", { selector: "strong" })).toBeInTheDocument(); expect(screen.getByRole("button", { name: "자동 커밋 ON" })).toBeDisabled();
    await consentAuto(); fireEvent.click(screen.getByRole("button", { name: "자동 커밋 ON" })); await screen.findByText("ON", { selector: "strong" });
    view.rerender(<GitHubAutoCommit {...props} eligible={false} />); await waitFor(() => expect(client.autoStop).toHaveBeenCalledTimes(1)); await screen.findByText("OFF", { selector: "strong" });
    view.rerender(<GitHubAutoCommit {...props} />); expect(client.autoEnable).toHaveBeenCalledTimes(1); expect(screen.getByRole("button", { name: "자동 커밋 ON" })).toBeDisabled();
  });
  it("OFF during enabling defeats a late response and never starts ticking", async () => {
    const client = githubTestClient(); const pending = deferred<GitHubAutoStatus>(); vi.mocked(client.autoEnable).mockReturnValue(pending.promise);
    render(<GitHubAutoCommit client={client} target={githubTestTarget} eligible blocked={false} onLock={vi.fn()} onSessionExpired={vi.fn()} />);
    await consentAuto(); fireEvent.click(screen.getByRole("button", { name: "자동 커밋 ON" })); const id = vi.mocked(client.autoEnable).mock.calls[0][0];
    fireEvent.click(screen.getByRole("button", { name: "자동 커밋 OFF" })); await screen.findByText("OFF", { selector: "strong" });
    await act(async () => pending.resolve({ ...githubTestOff, runId: id, state: "ACTIVE", target: githubTestTarget }));
    expect(screen.getByText("OFF", { selector: "strong" })).toBeInTheDocument(); expect(client.autoTick).not.toHaveBeenCalled();
  });
  it("sequentially drains and stops after uncertain result without retrying", async () => {
    const client = githubTestClient(); vi.mocked(client.autoTick).mockRejectedValue(new GitHubRequestError("GITHUB_UPLOAD_OUTCOME_UNKNOWN"));
    render(<GitHubAutoCommit client={client} target={githubTestTarget} eligible blocked={false} onLock={vi.fn()} onSessionExpired={vi.fn()} />);
    await consentAuto(); fireEvent.click(screen.getByRole("button", { name: "자동 커밋 ON" })); await screen.findByText("ON", { selector: "strong" });
    await waitFor(() => expect(client.autoTick).toHaveBeenCalledTimes(1), { timeout: 2500 });
    await screen.findByText(/전송 결과를 확정할 수 없습니다/); expect(client.autoStop).toHaveBeenCalledTimes(1); expect(client.commit).not.toHaveBeenCalled();
  });
  it("stops on page hiding and on unmount, while an existing run is never adopted", async () => {
    const client = githubTestClient(); const view = render(<GitHubAutoCommit client={client} target={githubTestTarget} eligible blocked={false} onLock={vi.fn()} onSessionExpired={vi.fn()} />);
    await consentAuto(); fireEvent.click(screen.getByRole("button", { name: "자동 커밋 ON" })); await screen.findByText("ON", { selector: "strong" });
    act(() => window.dispatchEvent(new Event("pagehide"))); await screen.findByText("OFF", { selector: "strong" });
    await consentAuto(); fireEvent.click(screen.getByRole("button", { name: "자동 커밋 ON" })); await screen.findByText("ON", { selector: "strong" }); view.unmount(); expect(client.autoStop).toHaveBeenCalledTimes(2);
    vi.mocked(client.autoStatus).mockResolvedValue({ ...githubTestOff, runId: "44444444-4444-4444-8444-444444444444", state: "ACTIVE", target: githubTestTarget });
    render(<GitHubAutoCommit client={client} target={githubTestTarget} eligible blocked={false} onLock={vi.fn()} onSessionExpired={vi.fn()} />);
    await screen.findByText("다른 화면에서 ON"); expect(screen.getByRole("button", { name: "자동 커밋 ON" })).toBeDisabled(); expect(client.autoTick).not.toHaveBeenCalled();
  });
});
