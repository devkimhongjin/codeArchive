import { useEffect, useRef, useState } from "react";
import type { DashboardSolution } from "./archiveTypes";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import { GitHubAutoCommit } from "./GitHubAutoCommit";
import { githubErrorMessage, GitHubRequestError, type GitHubAutoTarget, type GitHubBranch, type GitHubClient, type GitHubCommitResult, type GitHubConfirmation, type GitHubDirectory, type GitHubInstallation, type GitHubPage, type GitHubRepository } from "./githubClient";

type AutomationIntent = { enabled: boolean; nonce: number };

export function GitHubUpload({ solution, client, syncEligible, onSessionExpired, automationIntent, onAutomationStateChange, onTargetConfiguredChange }: { solution: DashboardSolution | null; client: GitHubClient; syncEligible: boolean; onSessionExpired: () => void; automationIntent?: AutomationIntent | null; onAutomationStateChange?: (enabled: boolean, errorCode: import("../../../packages/shared-types/src").CodeArchiveAutomationControlErrorCode | null) => void; onTargetConfiguredChange?: (configured: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return <section className="github-panel" aria-label="GitHub 풀이 업로드">
    <div className="github-heading"><div><h2>GitHub 풀이 업로드</h2><p>수동 확인 후 한 번 커밋하거나, 새 풀이의 자동 커밋을 켜세요. 기본은 OFF입니다.</p></div>
      <button type="button" onClick={() => setOpen(v => !v)}>{open ? "업로드 화면 닫기" : "GitHub 저장소 연결 확인"}</button></div>
    <GitHubUploadBody open={open} solution={solution} client={client} syncEligible={syncEligible} onSessionExpired={onSessionExpired} automationIntent={automationIntent} onAutomationStateChange={onAutomationStateChange} onTargetConfiguredChange={onTargetConfiguredChange} />
  </section>;
}
function GitHubUploadBody({ open, solution, client, syncEligible, onSessionExpired, automationIntent, onAutomationStateChange, onTargetConfiguredChange }: { open: boolean; solution: DashboardSolution | null; client: GitHubClient; syncEligible: boolean; onSessionExpired: () => void; automationIntent?: AutomationIntent | null; onAutomationStateChange?: (enabled: boolean, errorCode: import("../../../packages/shared-types/src").CodeArchiveAutomationControlErrorCode | null) => void; onTargetConfiguredChange?: (configured: boolean) => void }) {
  const [installations, setInstallations] = useState<GitHubInstallation[]>([]);
  const [installation, setInstallation] = useState("");
  const [repositories, setRepositories] = useState<GitHubPage<GitHubRepository>>({ page: 1, hasMore: false, items: [] });
  const [repository, setRepository] = useState<GitHubRepository | null>(null);
  const [branches, setBranches] = useState<GitHubPage<GitHubBranch>>({ page: 1, hasMore: false, items: [] });
  const [branch, setBranch] = useState<GitHubBranch | null>(null);
  const [folder, setFolder] = useState("");
  const [directory, setDirectory] = useState<GitHubDirectory | null>(null);
  const [path, setPath] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<GitHubConfirmation | null>(null);
  const [consent, setConsent] = useState(false);
  const [risk, setRisk] = useState(false);
  const [publicConsent, setPublicConsent] = useState(false);
  const [receipt, setReceipt] = useState<GitHubCommitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoLocked, setAutoLocked] = useState(false);
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const callback = useRef(onSessionExpired); callback.current = onSessionExpired;
  const sourceKey = `${solution?.id}:${solution?.updatedAt}`;
  const sourceRef = useRef(sourceKey); sourceRef.current = sourceKey;
  const previousSource = useRef(sourceKey);
  const pendingMutation = useRef(false);
  const unresolved = receipt?.status === "UNKNOWN" || receipt?.status === "READY";
  const locked = busy || autoLocked || !!unresolved;
  const target: GitHubAutoTarget | null = repository && branch ? { installationId: installation, repositoryId: repository.id, branch: branch.name, expectedCommitSha: branch.commitSha, folder, privateRepository: repository.private, fullName: repository.fullName } : null;
  useEffect(() => { onTargetConfiguredChange?.(Boolean(target)); }, [onTargetConfiguredChange, target?.installationId, target?.repositoryId, target?.branch, target?.expectedCommitSha, target?.folder, target?.privateRepository, target?.fullName]);
  async function refreshAutomationTarget(signal: AbortSignal): Promise<GitHubAutoTarget> {
    if (!target || !repository || !branch) throw new GitHubRequestError("GITHUB_REFERENCE_CHANGED");
    const latestRepositories = await client.repositories(installation, repositories.page, signal);
    const latestRepository = latestRepositories.items.find((item) => item.id === repository.id);
    if (!latestRepository || latestRepository.fullName !== repository.fullName || latestRepository.private !== repository.private) throw new GitHubRequestError("GITHUB_REFERENCE_CHANGED");
    const latest = await client.branches(installation, latestRepository.id, branches.page, signal);
    const current = latest.items.find((item) => item.name === branch.name);
    if (!current || current.protected || !current.selectable) throw new GitHubRequestError("GITHUB_REFERENCE_CHANGED");
    return { ...target, privateRepository: latestRepository.private, fullName: latestRepository.fullName, expectedCommitSha: current.commitSha };
  }
  function invalidate() { setConfirmation(null); setConsent(false); setRisk(false); setPublicConsent(false); }
  async function perform<T>(operation: (s: AbortSignal) => Promise<T>, accept: (v: T) => void, checkSource = false) {
    controller.current?.abort(); const current = ++generation.current;
    const abort = new AbortController(); controller.current = abort;
    const selected = sourceRef.current; setBusy(true); setNotice("");
    try {
      const value = await operation(abort.signal);
      if (mounted.current && generation.current === current && (!checkSource || sourceRef.current === selected)) accept(value);
    } catch (error) {
      if (mounted.current && generation.current === current && !abort.signal.aborted) {
        if (error instanceof ArchiveSessionExpiredError) callback.current();
        else setNotice(githubErrorMessage(error));
      }
    } finally { if (mounted.current && generation.current === current) { setBusy(false); pendingMutation.current = false; } }
  }
  function load() { void perform(s => client.installations(s), value => { setInstallations(value); setLoaded(true); if (!value.length) setNotice("현재 계정에 연결된 개인 GitHub App 설치가 없습니다. GitHub 로그인만으로는 저장소 권한이 생기지 않습니다."); }); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++generation.current; controller.current?.abort(); }; }, [client]);
  useEffect(() => { if (open && !loaded) load(); }, [open, loaded, client]);
  useEffect(() => {
    if (previousSource.current === sourceKey) return;
    previousSource.current = sourceKey;
    invalidate(); setPath(""); setMessage("");
    if (!pendingMutation.current) { ++generation.current; controller.current?.abort(); setBusy(false); }
  }, [sourceKey]);
  function chooseInstallation(value: string) {
    setInstallation(value); setRepository(null); setBranch(null); setDirectory(null); setFolder(""); invalidate();
    if (value) void perform(s => client.repositories(value, 1, s), setRepositories);
  }
  function chooseRepository(value: string) {
    const selected = repositories.items.find(r => r.id === value) ?? null;
    setRepository(selected); setBranch(null); setDirectory(null); setFolder(""); invalidate();
    if (selected) void perform(s => client.branches(installation, selected.id, 1, s), setBranches);
  }
  function browse(t: GitHubAutoTarget, directoryPath: string) { void perform(s => client.directory(t, directoryPath, s), value => { setDirectory(value); setFolder(value.path); invalidate(); }); }
  function prepare() {
    if (!solution || !target || locked) return;
    invalidate();
    const extension = ({ java: "java", python: "py", javascript: "js", typescript: "ts", "c++": "cpp" } as Record<string, string>)[solution.language.trim().toLowerCase()] ?? "txt";
    const defaultPath = `${folder ? folder + "/" : ""}${solution.platform}/${solution.problemNumber}/Solution.${extension}`;
    void perform(s => client.prepare({ solutionId: solution.id, expectedUpdatedAt: solution.updatedAt, installationId: installation, repositoryId: target.repositoryId,
      branch: target.branch, expectedCommitSha: target.expectedCommitSha, path: path || defaultPath, commitMessage: message || null }, s), value => {
        if (value.preview.source.id !== solution.id || value.preview.source.updatedAt !== solution.updatedAt || value.preview.target.installationId !== installation || value.preview.target.repositoryId !== target.repositoryId || value.preview.target.branch !== target.branch || value.preview.target.commitSha !== target.expectedCommitSha) { setNotice("미리보기 대상이 달라 다시 확인해야 합니다."); return; }
        setConfirmation(value);
      }, true);
  }
  function commit() {
    if (!confirmation || locked || pendingMutation.current || !consent || !risk || (!confirmation.preview.target.privateRepository && !publicConsent)) return;
    if (confirmation.preview.source.id !== solution?.id || confirmation.preview.source.updatedAt !== solution.updatedAt) return;
    const id = confirmation.intentId;
    pendingMutation.current = true;
    setReceipt({ intentId: id, status: "UNKNOWN", retryAllowed: false, commitSha: null, commitUrl: null, errorCode: null });
    invalidate();
    void perform(s => client.commit(id, { confirmUpload: consent, acknowledgeVisibilityRisk: risk, confirmPublicUpload: publicConsent }, s), value => {
      setReceipt(value); if (value.status === "SUCCEEDED") { setBranch(null); setDirectory(null); setNotice("커밋을 완료했습니다. 다음 업로드 전에 브랜치를 새로 확인해 주세요."); }
    });
  }
  return <>
    <div hidden={!open}>
      <p>GitHub 로그인·자동 동기화·커뮤니티 공개 동의와 별개입니다. 자동 수집된 정답 원본만 전송하며, Extension의 로컬 원본과 서버 풀이는 변경하지 않습니다.</p>
    <fieldset disabled={locked} className="github-target"><legend>저장 위치</legend>
      <label>GitHub 연결<select value={installation} onChange={e => chooseInstallation(e.target.value)}><option value="">연결 선택</option>{installations.map(i => <option key={i.id} value={i.id}>{i.account.login}</option>)}</select></label>
      <label>저장소<select disabled={!installation} value={repository?.id ?? ""} onChange={e => chooseRepository(e.target.value)}><option value="">저장소 선택</option>{repositories.items.map(r => <option key={r.id} value={r.id}>{r.fullName} · {r.private ? "비공개" : "공개"}</option>)}</select></label>
      {installation && <div className="github-actions"><button disabled={repositories.page <= 1} onClick={() => void perform(s => client.repositories(installation, repositories.page - 1, s), v => { setRepositories(v); setRepository(null); setBranch(null); invalidate(); })}>이전 저장소</button><button disabled={!repositories.hasMore} onClick={() => void perform(s => client.repositories(installation, repositories.page + 1, s), v => { setRepositories(v); setRepository(null); setBranch(null); invalidate(); })}>다음 저장소</button></div>}
      <label>브랜치<select disabled={!repository} value={branch?.name ?? ""} onChange={e => { const selected = branches.items.find(b => b.name === e.target.value) ?? null; setBranch(selected); setFolder(""); setDirectory(null); invalidate(); }}><option value="">브랜치 선택</option>{branches.items.map(b => <option key={b.name} disabled={!b.selectable || b.protected} value={b.name}>{b.name}{b.protected ? " (보호됨)" : !b.selectable ? " (사용 불가)" : ""}</option>)}</select></label>
      {repository && <div className="github-actions"><button onClick={() => void perform(s => client.branches(installation, repository.id, 1, s), v => { setBranches(v); setBranch(null); invalidate(); })}>브랜치 새로 확인</button><button disabled={branches.page <= 1} onClick={() => void perform(s => client.branches(installation, repository.id, branches.page - 1, s), v => { setBranches(v); setBranch(null); invalidate(); })}>이전 브랜치</button><button disabled={!branches.hasMore} onClick={() => void perform(s => client.branches(installation, repository.id, branches.page + 1, s), v => { setBranches(v); setBranch(null); invalidate(); })}>다음 브랜치</button></div>}
      <label>기본 폴더<input value={folder} disabled={!target} placeholder="비워 두면 저장소 루트" onChange={e => { setFolder(e.target.value); setDirectory(null); invalidate(); }} /></label>
      <div className="github-actions"><button disabled={!target} onClick={() => target && browse(target, folder)}>폴더 찾아보기</button>{directory?.parentPath !== null && directory && <button onClick={() => target && browse(target, directory.parentPath!)}>상위 폴더</button>}</div>
      {directory && <div className="github-folders" aria-label="폴더 목록"><span>{directory.path || "/"}</span>{directory.entries.filter(e => e.type === "DIRECTORY" && e.browsable).map(e => <button key={e.path} onClick={() => target && browse(target, e.path)}>{e.name}/</button>)}{!directory.entries.some(e => e.type === "DIRECTORY" && e.browsable) && <small>하위 폴더 없음</small>}</div>}
    </fieldset>
      {target && <p className="github-destination">{target.privateRepository ? "비공개" : "공개"} 저장소 <strong>{target.fullName}</strong> / {target.branch} / {folder || "루트"}</p>}
      <section className="github-manual" aria-label="한 번 커밋">
      <h3>선택한 풀이 한 번 커밋</h3><p>{solution ? `${solution.platform} ${solution.problemNumber} · ${solution.language}` : "목록에서 풀이를 선택하세요."}</p>
      <fieldset disabled={locked}><legend>미리보기 설정</legend>
        <label>파일 경로 (선택)<input value={path} placeholder="기본 폴더/플랫폼/문제번호/Solution.확장자" onChange={e => { setPath(e.target.value); invalidate(); }} /></label>
        <label>커밋 메시지 (선택)<input value={message} maxLength={200} placeholder="Add SWEA 1206 solution" onChange={e => { setMessage(e.target.value); invalidate(); }} /></label>
        <button disabled={!target || !solution || solution.source !== "captured"} onClick={prepare}>코드·경로 미리보기</button>
      </fieldset>
      {confirmation && <div className="github-preview"><h4>새 파일 추가</h4><p>{confirmation.preview.target.fullName} · {confirmation.preview.target.privateRepository ? "비공개" : "공개"} · {confirmation.preview.target.branch}</p><p><code>{confirmation.preview.file.path}</code> · {confirmation.preview.file.byteLength} bytes · {confirmation.preview.commitMessage}</p>
        <p>확인 유효 시간: {new Date(confirmation.expiresAt).toLocaleTimeString("ko-KR")}</p><pre className="code-view"><code>{confirmation.preview.diff.after}</code></pre><p>{confirmation.consentNotice}</p>
        <fieldset disabled={locked}><legend>이번 전송 확인</legend><label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />위 코드·경로·메시지를 GitHub에 전송합니다.</label><label><input type="checkbox" checked={risk} onChange={e => setRisk(e.target.checked)} />저장소 공개 여부가 바뀔 수 있고 전송한 코드는 자동 회수되지 않음을 확인했습니다.</label>{!confirmation.preview.target.privateRepository && <label><input type="checkbox" checked={publicConsent} onChange={e => setPublicConsent(e.target.checked)} />공개 저장소에 코드를 공개합니다.</label>}<button className="primary-button" disabled={!consent || !risk || (!confirmation.preview.target.privateRepository && !publicConsent)} onClick={commit}>확인한 풀이 커밋</button></fieldset>
      </div>}
      {receipt && <div className="github-result" role="status"><strong>{receipt.status === "SUCCEEDED" ? "커밋 완료" : receipt.status === "UNKNOWN" ? "전송 결과 확인 필요 · 재전송하지 마세요" : receipt.status === "REJECTED" ? "전송 전 중단됨" : "요청 상태 확인 필요"}</strong>{receipt.commitUrl && <a href={receipt.commitUrl} target="_blank" rel="noopener noreferrer">GitHub 커밋 보기</a>}<button disabled={busy} onClick={() => void perform(s => client.result(receipt.intentId, s), value => { setReceipt(value); if (value.status === "SUCCEEDED") { setBranch(null); setDirectory(null); setNotice("커밋 완료를 확인했습니다. 다음 업로드 전에 브랜치를 새로 확인해 주세요."); } })}>전송 결과 확인</button></div>}
      </section>
      {busy && <p role="status">GitHub 요청 확인 중…</p>}{notice && <p role="status">{notice}</p>}
      {!loaded && !busy && <button onClick={load}>GitHub 연결 다시 확인</button>}
    </div>
    <div hidden={!open}>
      <GitHubAutoCommit client={client} target={target} eligible={syncEligible} blocked={busy || !!unresolved} automationIntent={automationIntent} onAutomationStateChange={onAutomationStateChange} refreshTarget={refreshAutomationTarget} onSessionExpired={() => callback.current()}
        onLock={value => { setAutoLocked(value); invalidate(); if (!value) { setBranch(null); setDirectory(null); } }} />
    </div>
  </>;
}
