interface PopupServices {
  load: () => Promise<unknown>;
  extensionId: string;
  copy: (text: string) => Promise<void>;
}
export function mountPopup(document: Document, services: PopupServices): void {
  const count = document.querySelector<HTMLElement>('#pending-count')!;
  const status = document.querySelector<HTMLElement>('#status')!;
  const description = document.querySelector<HTMLElement>('#capture-description')!;
  const error = document.querySelector<HTMLElement>('#error')!;
  const card = document.querySelector<HTMLElement>('#capture-card')!;
  const refresh = document.querySelector<HTMLButtonElement>('#refresh')!;
  const copy = document.querySelector<HTMLButtonElement>('#copy-id')!;
  const copyStatus = document.querySelector<HTMLElement>('#copy-status')!;
  let loading = false;
  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    error.hidden = true;
    count.textContent = '—';
    status.textContent = '확인 중';
    description.textContent = '이 브라우저에 저장된 풀이를 확인하고 있어요.';
    card.setAttribute('aria-busy', 'true');
    try {
      const state = await services.load() as { pendingCount?: unknown; settings?: unknown; error?: unknown } | null;
      if (!state || state.error || !state.settings || typeof state.pendingCount !== 'number' || !Number.isSafeInteger(state.pendingCount) || state.pendingCount < 0) throw new Error('Invalid state');
      count.textContent = String(state.pendingCount);
      status.textContent = '로컬 보관';
      description.textContent = state.pendingCount ? '통과한 풀이가 기다리고 있어요. 대시보드로 가져가세요.' : '아직 대기 중인 풀이가 없어요. 첫 통과 풀이를 모아보세요.';
    } catch {
      count.textContent = '—';
      status.textContent = '확인 필요';
      description.textContent = '저장된 풀이 수를 확인할 수 없어요.';
      error.hidden = false;
    } finally {
      loading = false;
      refresh.disabled = false;
      card.setAttribute('aria-busy', 'false');
    }
  }
  refresh.addEventListener('click', () => void load());
  copy.disabled = !/^[a-p]{32}$/.test(services.extensionId);
  copy.addEventListener('click', () => {
    copy.disabled = true;
    void services.copy(services.extensionId).then(() => {
      copyStatus.textContent = 'ID를 복사했어요. 대시보드 설정에 붙여 넣어 주세요.';
    }).catch(() => {
      copyStatus.textContent = `복사하지 못했어요. ID: ${services.extensionId}`;
    }).finally(() => { copy.disabled = false; });
  });
  void load();
}
