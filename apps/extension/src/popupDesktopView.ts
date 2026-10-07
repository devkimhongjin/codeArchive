type DesktopServices = {
  send(message: { type: string; code?: string }): Promise<{ connected?: boolean; error?: string }>;
  schedule(refresh: () => void): unknown;
};
export function mountDesktopConnection(document: Document, services: DesktopServices) {
  const entry = document.querySelector<HTMLElement>('#desktop-entry')!;
  const content = document.querySelector<HTMLElement>('#popup-content')!;
  const footer = document.querySelector<HTMLElement>('#popup-footer')!;
  const status = document.querySelector<HTMLElement>('#desktop-status')!;
  const feedback = document.querySelector<HTMLElement>('#desktop-feedback')!;
  const code = document.querySelector<HTMLInputElement>('#desktop-pair-code')!;
  const button = document.querySelector<HTMLButtonElement>('#desktop-pair-form button')!;
  let checking = false;
  let pairingFailed = false;
  const show = (connected: boolean) => {
    entry.hidden = connected;
    content.hidden = footer.hidden = !connected;
    status.textContent = connected ? '연결됨' : '연결 안 됨';
  };
  const refresh = async () => {
    if (checking) return;
    checking = true;
    try {
      const result = await services.send({ type: 'DESKTOP_STATUS' });
      show(result?.connected === true);
      if (result?.connected !== true && result?.error && !pairingFailed) feedback.textContent = result.error;
      if (result?.connected === true) { pairingFailed = false; feedback.textContent = ''; }
    }
    catch { show(false); status.textContent = '연결 상태를 확인하지 못했습니다.'; }
    finally { checking = false; }
  };
  document.querySelector('#desktop-pair-form')!.addEventListener('submit', event => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    pairingFailed = false;
    void (async () => {
      try {
        const result = await services.send({ type: 'DESKTOP_PAIR', code: code.value.trim() });
        pairingFailed = Boolean(result?.error);
        feedback.textContent = result?.error ?? '연결 요청을 보냈습니다.';
        if (!result?.error) code.value = '';
        await refresh();
      } catch { pairingFailed = true; feedback.textContent = '연결하지 못했습니다. PC 앱을 실행한 뒤 다시 시도해 주세요.'; }
      finally { button.disabled = false; }
    })();
  });
  void refresh();
  services.schedule(() => void refresh());
  return { refresh };
}
