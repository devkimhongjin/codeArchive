import { useEffect, useState } from "react";
import type { DashboardSolution } from "./archiveTypes";
import { communityId, mainApiCommunityClient, type CommunityClient, type CommunityComment } from "./communityClient";
import { invalidateCommunity, useCommunityResource } from "./communityLifecycle";

interface Context { account: string; client?: CommunityClient; onSessionExpired: () => void }
const link = (id: string) => `${globalThis.location.origin}${globalThis.location.pathname}#community=${id}`;

export function CommunitySharing({ solution, account, client = mainApiCommunityClient, onSessionExpired }: Context & { solution: DashboardSolution }) {
  const [opened, setOpened] = useState(false);
  const [consent, setConsent] = useState(false);
  const [peers, setPeers] = useState(false);
  const [ownDiscussion, setOwnDiscussion] = useState(false);
  const sharing = useCommunityResource(opened ? (signal) => client.sharing(solution.id, signal) : null, onSessionExpired);
  const status = sharing.data;
  // Parent is keyed by account + solution revision; stale UI never crosses that boundary.
  return <section className="community-section" aria-label="문제 커뮤니티">
    <h3>함께 푼 사람들의 코드</h3>
    <p>이 문제의 성공 풀이를 공개하면 다른 사람의 풀이를 볼 수 있습니다. 자동 공개되지 않습니다.</p>
    <button type="button" onClick={() => { setOpened(true); if (opened) sharing.refresh(); }}>공개 설정 확인</button>
    {sharing.busy && <p role="status">공개 상태를 확인하는 중입니다.</p>}
    {sharing.error && <p role="alert">{sharing.error}</p>}
    {status && <>
      <p><strong>{status.publicSolution ? "공개 중" : "비공개"}</strong> · 성공 수집 기록 기준이며 플랫폼 공식 검증은 아닙니다.</p>
      {!status.canPublish && <p>성공 수집 출처를 확인할 수 없습니다. 기존·수정·수동 기록은 자동으로 자격을 얻지 않습니다. SWEA에서 성공 풀이를 다시 수집하고 Dashboard에 동기화해 주세요.</p>}
      {!status.publicSolution && status.canPublish && <>
        <p>아래의 코드, 문제·제목·언어와 GitHub 계정명이 같은 문제의 정답 공개자에게 표시됩니다. AI 결과와 개인 성능 메모는 공개하지 않습니다.</p>
        <label className="community-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />공개할 코드와 정보를 확인했으며 공유에 동의합니다</label>
        <button type="button" disabled={!consent || sharing.busy} onClick={() => {
          void sharing.mutate((signal) => client.publish(solution.id, true, signal), () => { setConsent(false); invalidateCommunity(); });
        }}>이 풀이 공개하기</button>
      </>}
      {status.publicSolution && <>
        <button type="button" disabled={sharing.busy} onClick={() => {
          setPeers(false); setOwnDiscussion(false);
          void sharing.mutate((signal) => client.publish(solution.id, false, signal), invalidateCommunity);
        }}>비공개로 전환</button>
        <button type="button" disabled={sharing.busy} onClick={() => setOwnDiscussion(!ownDiscussion)}>내 공개 풀이·댓글 보기</button>
        <label>자격이 있는 사용자용 공유 링크<input readOnly value={link(solution.id)} onFocus={(e) => e.target.select()} /></label>
        <p>원본 코드·언어·문제를 수정하면 공개와 수집 자격이 해제됩니다. 제목 변경은 공개 글에 반영됩니다.</p>
      </>}
    </>}
    <button type="button" disabled={!status?.eligible || sharing.busy} onClick={() => setPeers(!peers)}>다른 풀이 보기</button>
    {!opened && <p>먼저 공개 설정을 확인해 주세요.</p>}
    {peers && status?.eligible && <PeerList key={`${account}:${solution.id}`} anchor={solution} account={account} client={client} onSessionExpired={onSessionExpired} />}
    {ownDiscussion && status?.publicSolution && <SharedDiscussion key={`${account}:${solution.id}`} id={solution.id} account={account} client={client} onSessionExpired={onSessionExpired} />}
  </section>;
}

function PeerList({ anchor, account, client = mainApiCommunityClient, onSessionExpired }: Context & { anchor: DashboardSolution }) {
  const [language, setLanguage] = useState("");
  const [filter, setFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const resource = useCommunityResource((signal) => client.peers(anchor.id, filter, offset, signal), onSessionExpired);
  return <section className="community-peers" aria-label="같은 문제의 다른 풀이">
    <h4>{anchor.platform} · {anchor.problemNumber} 다른 풀이</h4>
    <form onSubmit={(e) => { e.preventDefault(); setFilter(language.trim()); setOffset(0); setSelected(null); resource.refresh(); }}>
      <label>언어 필터<input maxLength={64} placeholder="전체 언어 (예: Java)" value={language} onChange={(e) => setLanguage(e.target.value)} /></label>
      <button type="submit" disabled={resource.busy}>언어 적용</button>
    </form>
    <p>최근 공개순 · 내 풀이는 제외됩니다.</p>
    {resource.busy && <p role="status">다른 풀이를 불러오는 중입니다.</p>}
    {resource.error && <p role="alert">{resource.error}</p>}
    <button type="button" disabled={resource.busy} onClick={() => { setSelected(null); resource.refresh(); }}>다른 풀이 새로고침</button>
    {resource.data && <>
      {resource.data.items.length === 0 ? <p>{filter ? "이 언어에 공개된 다른 풀이가 없습니다." : "아직 공개된 다른 풀이가 없습니다."}</p> : <ul className="community-peer-list">
        {resource.data.items.map((item) => <li key={item.id}><button type="button" onClick={() => setSelected(item.id)}>
          @{item.author.login} · {item.language} · {new Date(item.publishedAt).toLocaleDateString("ko-KR")} · 좋아요 {item.likeCount} · 댓글 {item.commentCount}
        </button></li>)}
      </ul>}
      <nav aria-label="다른 풀이 페이지"><button type="button" disabled={offset === 0 || resource.busy} onClick={() => { setOffset(offset - 20); setSelected(null); resource.refresh(); }}>이전 풀이</button>
        <span>{offset / 20 + 1}페이지</span><button type="button" disabled={!resource.data.hasMore || resource.busy || offset >= 10000} onClick={() => { setOffset(offset + 20); setSelected(null); resource.refresh(); }}>다음 풀이</button></nav>
      {selected && <SharedDiscussion key={`${account}:${selected}`} id={selected} account={account} client={client} ownCode={anchor.code} onSessionExpired={onSessionExpired} />}
    </>}
  </section>;
}

export function SharedDiscussion({ id, account, client = mainApiCommunityClient, ownCode, onSessionExpired }: Context & { id: string; ownCode?: string }) {
  const [offset, setOffset] = useState(0);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [report, setReport] = useState("");
  const [notice, setNotice] = useState("");
  const resource = useCommunityResource(async (signal) => {
    const [solution, comments] = await Promise.all([client.detail(id, signal), client.comments(id, offset, signal)]);
    return { solution, comments };
  }, onSessionExpired);
  const value = resource.data;
  function edit(comment: CommunityComment) { setEditing(comment.id); setDraft(comment.body); }
  return <section className="community-discussion" aria-label="공유 풀이 상세">
    {resource.busy && <p role="status">공유 풀이를 확인하는 중입니다.</p>}
    {resource.error && <p role="alert">{resource.error}</p>}
    <button type="button" disabled={resource.busy} onClick={resource.refresh}>공유 풀이 새로고침</button>
    {notice && <p role="status">{notice}</p>}
    {value && <>
      <h4>{value.solution.title} · @{value.solution.author.login}</h4>
      <p>{value.solution.platform} · {value.solution.problemNumber} · {value.solution.language} · 성공 수집 기록 (공식 검증 아님)</p>
      {ownCode !== undefined && <button type="button" onClick={() => setCompare(!compare)}>{compare ? "비교 닫기" : "내 코드와 비교"}</button>}
      <div className={compare ? "community-code-compare" : ""}>
        {compare && <div><h5>내 코드</h5><pre className="code-view"><code>{ownCode}</code></pre></div>}
        <div><h5>공개 코드</h5><pre className="code-view"><code>{value.solution.code}</code></pre></div>
      </div>
      <p>좋아요 {value.solution.likeCount} · 댓글 {value.solution.commentCount}</p>
      {value.solution.author.id !== account && <button type="button" aria-pressed={value.solution.liked} disabled={resource.busy}
        onClick={() => { void resource.mutate((signal) => client.like(id, !value.solution.liked, signal)); }}>{value.solution.liked ? "좋아요 취소" : "좋아요"}</button>}
      <label>공유 링크<input readOnly value={link(id)} onFocus={(e) => e.target.select()} /></label>
      <h4>댓글</h4>
      {value.comments.items.length === 0 && <p>아직 댓글이 없습니다.</p>}
      <ul className="community-comments">{value.comments.items.map((item) => <li key={item.id}>
        <strong>@{item.author.login}</strong><small> · {new Date(item.createdAt).toLocaleString("ko-KR")}{item.createdAt !== item.updatedAt ? " · 수정됨" : ""}</small>
        <p className="community-comment-body">{item.body}</p>
        {item.author.id === account && <>
          <button type="button" disabled={resource.busy} onClick={() => edit(item)}>댓글 수정</button>
          <button type="button" disabled={resource.busy} onClick={() => setConfirmDelete(item.id)}>댓글 삭제</button>
          {confirmDelete === item.id && <div role="group" aria-label="댓글 삭제 확인"><p>이 댓글을 삭제할까요?</p>
            <button type="button" disabled={resource.busy} onClick={() => { void resource.mutate((signal) => client.deleteComment(id, item.id, signal), () => { setConfirmDelete(null); if (editing === item.id) { setEditing(null); setDraft(""); } }); }}>삭제 확인</button>
            <button type="button" onClick={() => setConfirmDelete(null)}>삭제 취소</button></div>}
        </>}
      </li>)}</ul>
      <nav aria-label="댓글 페이지"><button type="button" disabled={offset === 0 || resource.busy} onClick={() => { setOffset(offset - 50); resource.refresh(); }}>이전 댓글</button>
        <span>{offset / 50 + 1}페이지</span><button type="button" disabled={!value.comments.hasMore || resource.busy || offset >= 10000} onClick={() => { setOffset(offset + 50); resource.refresh(); }}>다음 댓글</button></nav>
      <form onSubmit={(e) => {
        e.preventDefault(); if (!draft.trim() || draft.length > 2000) return;
        void resource.mutate((signal) => editing ? client.editComment(id, editing, draft, signal) : client.addComment(id, draft, signal), () => { setDraft(""); setEditing(null); setNotice("댓글을 저장했습니다."); });
      }}>
        <label>{editing ? "댓글 수정 내용" : "새 댓글"}<textarea maxLength={2000} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={resource.busy} /></label>
        <small>{draft.length}/2000 · 코드·개인정보·비밀키를 댓글에 붙여 넣지 마세요.</small>
        <button type="submit" disabled={resource.busy || !draft.trim()}>{editing ? "수정 저장" : "댓글 등록"}</button>
        {editing && <button type="button" onClick={() => { setEditing(null); setDraft(""); }}>수정 취소</button>}
      </form>
      <details><summary>문제 있는 게시물 신고</summary><label>신고 사유<select value={report} onChange={(e) => setReport(e.target.value)}>
        <option value="">선택하세요</option><option value="SPAM">스팸</option><option value="ABUSE">욕설·괴롭힘</option><option value="SENSITIVE">개인정보·비밀정보</option></select></label>
        <button type="button" disabled={!report || resource.busy} onClick={() => { void resource.mutate((signal) => client.report(id, report, signal), () => { setReport(""); setNotice("신고를 접수했습니다. 운영자 검토 대상이며 자동 삭제되지는 않습니다."); }); }}>신고 접수</button>
      </details>
    </>}
  </section>;
}

export function CommunityPermalink({ account, client, onSessionExpired }: Context) {
  const read = () => globalThis.location.hash.startsWith("#community=") ? globalThis.location.hash.slice(11) : "";
  const [id, setId] = useState(read);
  useEffect(() => { const update = () => setId(read()); globalThis.addEventListener("hashchange", update); return () => globalThis.removeEventListener("hashchange", update); }, []);
  if (!id) return null;
  return <section className="community-permalink" aria-label="공유 링크">
    <h2>공유된 풀이</h2>
    <button type="button" onClick={() => { globalThis.history.replaceState(null, "", globalThis.location.pathname + globalThis.location.search); setId(""); }}>공유 링크 닫기</button>
    {!communityId(id) ? <p role="alert">올바르지 않은 공유 링크입니다.</p> : !account ? <p>로그인하고 같은 문제의 성공 풀이를 공개해야 열 수 있습니다.</p>
      : <SharedDiscussion key={`${account}:${id}`} id={id} account={account} client={client} onSessionExpired={onSessionExpired} />}
  </section>;
}
