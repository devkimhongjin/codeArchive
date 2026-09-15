import { createAdapter } from "./adapters";
import { collectAcceptedCaptureAttempt } from "./capture";
import type { PlatformAdapter } from "./types";

const adapter: PlatformAdapter | null = createAdapter(document, window.location);

if (adapter) {
  let processing = false;
  let checkScheduled = false;
  let checkAfterProcessing = false;

  const runCaptureCheck = async (): Promise<void> => {
    if (processing) {
      checkAfterProcessing = true;
      return;
    }
    const collected = collectAcceptedCaptureAttempt(adapter);
    if (!collected) return;

    processing = true;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "STORE_CAPTURE",
        capture: collected.capture
      });
      // A capture is consumed only after the service worker confirms local
      // persistence. Storage or channel failures remain retryable.
      if (response?.ok === true) adapter.consumeSubmissionResult(collected.detection);
    } finally {
      processing = false;
      if (checkAfterProcessing) {
        checkAfterProcessing = false;
        scheduleCaptureCheck();
      }
    }
  };

  function scheduleCaptureCheck(): void {
    if (processing) {
      checkAfterProcessing = true;
      return;
    }
    if (checkScheduled) return;
    checkScheduled = true;
    // Several platform mutations arrive in one render turn. One microtask
    // keeps detection bounded without delaying the accepted-result capture.
    queueMicrotask(() => {
      checkScheduled = false;
      void runCaptureCheck();
    });
  }

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      let current: Element | null = target;
      while (current) {
        if (adapter.isSubmitControl(current)) {
          // The MAIN-world document_start listener runs before this isolated
          // document_idle listener and synchronously updates the platform's
          // source textarea at this click boundary.
          adapter.beginSubmissionAttempt(new Date());
          break;
        }
        current = current.parentElement;
      }
    },
    true
  );

  const root = document.body ?? document.documentElement;
  if (root) {
    const observer = new MutationObserver(() => scheduleCaptureCheck());
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden", "aria-modal"]
    });
  }
}
