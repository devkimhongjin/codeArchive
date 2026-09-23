export const JUNGOL_ORIGIN = "https://jungol.co.kr";
export const JUNGOL_PROBLEM_PATH = /^\/problem\/(\d+)\/?$/;
export const JUNGOL_SOURCE_SELECTOR = "textarea[data-codearchive-jungol-source]";

export function jungolSubmitControl(element: Element): boolean {
  if (element.tagName !== "BUTTON") return false;
  const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return /^upload\s+제출$/.test(text) || text === "제출";
}
