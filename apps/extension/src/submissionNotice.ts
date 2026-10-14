import type { CaptureConnectionStatus } from './captureConnection';
const messages: Record<Exclude<CaptureConnectionStatus, 'READY'>, string> = {
  LOGIN_REQUIRED: 'GitHub 로그인이 필요합니다. 대시보드에서 로그인한 뒤 연결을 다시 확인해 주세요.',
  OFFLINE: '서버에 연결할 수 없습니다. 네트워크를 확인한 뒤 연결을 다시 확인해 주세요.',
  ACCOUNT_CHANGED: 'CodeArchive 로그인 계정이 변경됐습니다. 대시보드에서 연결을 확인해 주세요.',
  RECONNECT_REQUIRED: 'CodeArchive 연결을 확인하지 못했습니다. 대시보드에서 연결 상태를 확인해 주세요.',
};
export function submissionNotice(document: Document, status: CaptureConnectionStatus, open: () => void, retry: () => void): void {
  let notice = document.getElementById('codearchive-connection-notice');
  if (status === 'READY') { notice?.remove(); return; }
  if (notice?.dataset.status === status) return;
  notice?.remove();
  notice = document.createElement('aside'); notice.id = 'codearchive-connection-notice'; notice.dataset.status = status; notice.setAttribute('role', 'alert');
  notice.style.cssText = 'position:fixed;z-index:2147483647;bottom:16px;right:16px;max-width:400px;padding:18px;background:#fff8eb;color:#332719;border:1px solid #d59b43;border-radius:12px;font:14px/1.6 system-ui;box-shadow:0 4px 24px #0003';
  const title = document.createElement('strong'); title.textContent = 'CodeArchive · 자동 동기화 확인 필요';
  const text = document.createElement('p'); text.textContent = messages[status]; text.style.margin = '8px 0';
  const detail = document.createElement('p'); detail.textContent = '사이트 제출은 계속 진행됩니다. 서버 등록 완료 전에는 동기화된 풀이로 표시되지 않습니다.'; detail.style.cssText = 'font-size:12px;margin:8px 0 12px';
  notice.append(title, text, detail);
  for (const [label, action] of [['대시보드 열기', open], ['연결 다시 확인', retry], ['확인', () => notice?.remove()]] as const) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.style.cssText = 'padding:8px 12px;margin-right:8px;border:0;border-radius:7px;background:#5042c5;color:white;font:inherit;cursor:pointer'; button.onclick = action; notice.append(button);
  }
  (document.body ?? document.documentElement).append(notice);
}
