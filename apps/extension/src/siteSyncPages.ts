import { importVisibleJungolHistory, isJungolHistorySenderUrl, jungolHistoryRow, previewJungolHistory, readJungolRowSubmittedAt } from './historicalJungol';
import { authenticatedSweaHistoryIdentity, hydrateSweaCandidateResult, loadSweaProblemCandidates, sweaProblemCards } from './historicalSwea';
import { canonicalProgrammersLessonUrl, readProgrammersLessonHistory } from './historicalProgrammers';
import { SWEA_ORIGIN, SWEA_USER_SUBMISSIONS_PATH } from './adapters/sweaSelectors';
import { isCaptureRecord } from './capture';
import { siteSyncErrorLabel, type Send, type SiteSyncPage, type SyncOutcome } from './siteSyncView';
import type { SiteSyncStatus } from './siteSync';
import type { Capture } from './types';

type Registered = { ok?: boolean; created?: boolean; captureId?: string; error?: string } | undefined;
const registerOutcome = (result: Registered): SyncOutcome => result?.ok
  ? { ok: true, message: result.created ? '동기화 완료' : '이미 등록됨' } : { ok: false, message: siteSyncErrorLabel(result?.error) };

/** Jungol: one row per accepted own submission on /account/{id}/submission or /submission?account=. */
export function jungolSyncPage(document: Document, location: Location, send: Send): SiteSyncPage {
  // Exact submission times let a row match a live capture, which carries no
  // site submission id. Read each once; a failed read is not retried in a loop.
  const times = new Map<string, string>(), attempted = new Set<string>();
  let refining: Promise<boolean> | null = null;
  const candidates = () => {
    if (!isJungolHistorySenderUrl(new URL(location.href))) return [];
    const preview = previewJungolHistory(document, location);
    return preview.status === 'READY' ? preview.candidates : [];
  };
  return {
    platform: 'JUNGOL',
    refine(submissionIds) {
      refining ??= (async () => {
        const pending = candidates().filter(candidate => submissionIds.includes(candidate.submissionId) && !attempted.has(candidate.submissionId));
        let changed = false;
        // A few tooltips at a time: each row waits briefly, never the whole list in turn.
        for (let index = 0; index < pending.length; index += 3) {
          await Promise.all(pending.slice(index, index + 3).map(async candidate => {
            attempted.add(candidate.submissionId);
            const row = jungolHistoryRow(document, location, candidate.submissionId);
            const solvedAt = row ? await readJungolRowSubmittedAt(document, row) : null;
            if (solvedAt) { times.set(candidate.submissionId, solvedAt); changed = true; }
          }));
        }
        return changed;
      })().finally(() => { refining = null; });
      return refining;
    },
    targets() {
      if (!isJungolHistorySenderUrl(new URL(location.href))) return [];
      const preview = previewJungolHistory(document, location);
      if (preview.status !== 'READY') return [];
      return preview.candidates.flatMap(candidate => {
        const row = jungolHistoryRow(document, location, candidate.submissionId);
        const anchor = row?.querySelector<HTMLElement>('td[data-col="결과"]') ?? row?.lastElementChild as HTMLElement | null | undefined;
        if (!anchor) return [];
        return [{ id: candidate.submissionId, anchor, problemNumber: candidate.problemNumber,
          row: { submissionId: candidate.submissionId, problemNumber: candidate.problemNumber, language: candidate.language,
            ...(times.has(candidate.submissionId) ? { solvedAt: times.get(candidate.submissionId) } : {}) },
          async sync(): Promise<SyncOutcome> {
            let registered: Registered; let failure: string | undefined;
            await importVisibleJungolHistory(document, location, [candidate], async capture => {
              registered = await send({ type: 'SITE_SYNC_REGISTER', capture }) as Registered;
              return registered?.ok ? { ok: true, created: registered.created === true } : { ok: false, error: registered?.error ?? 'REJECTED' };
            }, () => undefined, reason => { failure = reason; });
            if (registered) return registerOutcome(registered);
            return { ok: false, message: failure === 'DETAIL_UNVERIFIED' ? '제출 상세를 확인하지 못했습니다' : failure === 'LIST_CHANGED' ? '목록이 바뀌었습니다. 새로고침해 주세요' : '제출 상세를 열지 못했습니다' };
          } }];
      });
    }
  };
}

/** SWEA: the list shows problems, so each card syncs all of that problem's accepted submissions. */
export function sweaSyncPage(document: Document, location: Location, send: Send): SiteSyncPage {
  return {
    platform: 'SWEA',
    targets() {
      if (location.origin !== SWEA_ORIGIN || location.pathname !== SWEA_USER_SUBMISSIONS_PATH) return [];
      return sweaProblemCards(document, location).map(({ problem, card }) => ({
        id: `swea:${problem.contestProbId}:${problem.solvingClub?.solveclubId ?? ''}:${problem.solvingClub?.probBoxId ?? ''}`,
        anchor: card, problemNumber: problem.problemNumber,
        async sync(): Promise<SyncOutcome> {
          const identity = authenticatedSweaHistoryIdentity(document, location);
          if (!identity) return { ok: false, message: 'SWEA 로그인 상태를 확인하지 못했습니다' };
          const history = await loadSweaProblemCandidates(problem, identity);
          if (history.status !== 'READY') return { ok: false, message: '제출 이력을 읽지 못했습니다' };
          if (!history.candidates.length) return { ok: true, message: '정답 제출 없음' };
          const status = await send({ type: 'SITE_SYNC_STATUS', rows: history.candidates.slice(0, 500).map(candidate => ({
            submissionId: candidate.submissionId, problemNumber: candidate.problemNumber, language: candidate.language, solvedAt: candidate.solvedAt })) }) as SiteSyncStatus;
          if (!status?.ok) return { ok: false, message: siteSyncErrorLabel(status && 'error' in status ? status.error : undefined) };
          const missing = history.candidates.filter(candidate => status.rows.find(row => row.submissionId === candidate.submissionId)?.state === 'UNREGISTERED');
          let created = 0, failed = 0;
          for (const candidate of missing) {
            const hydrated = await hydrateSweaCandidateResult(candidate, identity);
            if (hydrated.status !== 'DONE' || !hydrated.capture) { failed++; continue; }
            const result = await send({ type: 'SITE_SYNC_REGISTER', capture: hydrated.capture }) as Registered;
            if (result?.ok && result.created) created++; else if (!result?.ok) failed++;
          }
          const ambiguous = status.rows.filter(row => row.state === 'AMBIGUOUS').length;
          const parts = [`${created}건 등록`, ...(failed ? [`${failed}건 실패`] : []), ...(ambiguous ? [`${ambiguous}건 확인 필요`] : [])];
          return { ok: failed === 0, message: missing.length || ambiguous ? parts.join(' · ') : '모두 등록됨' };
        }
      }));
    }
  };
}

type ReadLesson = (lessonUrl: string, submissionId: string) => Promise<{ status?: string; capture?: unknown }>;

/** Programmers: the lesson page's own submission history, one row per 100-point submission. */
export function programmersSyncPage(document: Document, location: Location, send: Send, readLesson: ReadLesson): SiteSyncPage {
  return {
    platform: 'PROGRAMMERS',
    targets() {
      const lessonUrl = canonicalProgrammersLessonUrl(location);
      if (!lessonUrl) return [];
      const state = readProgrammersLessonHistory(document, location);
      if (state.status !== 'READY') return [];
      return state.rows.filter(row => row.isPerfectScore).map(row => ({
        id: row.submissionId, anchor: row.row, problemNumber: row.problemNumber,
        row: { submissionId: row.submissionId, problemNumber: row.problemNumber, language: row.language, solvedAt: new Date(row.createdAt).toISOString() },
        async sync(): Promise<SyncOutcome> {
          const read = await readLesson(lessonUrl, row.submissionId);
          const capture = read?.capture;
          if (read?.status !== 'DONE' || !isCaptureRecord(capture)) return { ok: false, message: read?.status === 'STALE_SUBMISSION' ? '목록이 바뀌었습니다. 새로고침해 주세요' : '제출 코드를 확인하지 못했습니다' };
          return registerOutcome(await send({ type: 'SITE_SYNC_REGISTER', capture: capture as Capture }) as Registered);
        }
      }));
    }
  };
}
