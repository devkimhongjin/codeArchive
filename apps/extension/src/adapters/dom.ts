export function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function isVisible(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") return false;
    const style = current.getAttribute("style")?.toLowerCase() ?? "";
    if (/(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0)/.test(style)) return false;
    const view = current.ownerDocument.defaultView;
    if (view) {
      try {
        const computed = view.getComputedStyle(current);
        if (computed.display === "none" || computed.visibility === "hidden" || computed.opacity === "0") return false;
      } catch {
        // Lightweight test DOMs may not implement computed styles.
      }
    }
    current = current.parentElement;
  }
  return true;
}

export function elementText(element: Element): string {
  return normalizeText(element.textContent);
}

export function firstElement<T extends Element>(document: Document, selectors: readonly string[]): T | null {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) return element as T;
  }
  return null;
}

export function closestFromTarget(target: EventTarget | null, selectors: readonly string[]): Element | null {
  if (!(target instanceof Element)) return null;
  for (const selector of selectors) {
    const match = target.closest(selector);
    if (match) return match;
  }
  return null;
}

export function parseFiniteNonNegative(value: string | null | undefined): number | null {
  const parsed = Number(normalizeText(value).replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function mainWorldSyncFailed(document: Document): boolean {
  return document.documentElement?.getAttribute("data-codearchive-editor-sync")?.startsWith("failed:") ?? false;
}
