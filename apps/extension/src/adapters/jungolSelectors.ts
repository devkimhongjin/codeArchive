export const JUNGOL_ORIGIN = "https://jungol.co.kr";
export const JUNGOL_PROBLEM_PATH = /^\/problem\/(\d+)\/?$/;
export const JUNGOL_SOURCE_SELECTOR = "textarea[data-codearchive-jungol-source]";

export function jungolSelectedLanguage(document: Document): string | null {
  const current = [...document.querySelectorAll<HTMLButtonElement>("button.lang-chip")];
  const legacy = [...document.querySelectorAll<HTMLButtonElement>("button")].filter(button =>
    /^language\s+\S/i.test(button.textContent?.replace(/\s+/g, " ").trim() ?? "")
  );
  const buttons = current.length ? current : legacy;
  if (buttons.length !== 1) return null;
  const label = buttons[0]?.textContent?.replace(/\s+/g, " ").trim().replace(/^language\s+/i, "") ?? "";
  return label && label.length <= 100 ? label : null;
}

export function jungolSubmitControl(element: Element): boolean {
  if (element.tagName !== "BUTTON") return false;
  const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return /^upload\s+제출$/.test(text) || text === "제출";
}
