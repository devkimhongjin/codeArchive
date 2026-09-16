import type { ThemedToken } from "shiki";
import { sourceFileExtension } from "./export";
import type { CaptureSettings } from "./types";

export const LIGHT_THEMES = ["github-light", "vitesse-light", "catppuccin-latte", "solarized-light", "one-light"] as const;
export const DARK_THEMES = ["github-dark", "vitesse-dark", "catppuccin-mocha", "dracula", "one-dark-pro"] as const;

let singleton: ReturnType<typeof loadHighlighter> | undefined;

async function loadHighlighter() {
  const { createHighlighterCore } = await import("shiki/core");
  const { createOnigurumaEngine } = await import("shiki/engine/oniguruma");
  return createHighlighterCore({
    themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/vitesse-light.mjs"), import("shiki/themes/catppuccin-latte.mjs"), import("shiki/themes/solarized-light.mjs"), import("shiki/themes/one-light.mjs"), import("shiki/themes/github-dark.mjs"), import("shiki/themes/vitesse-dark.mjs"), import("shiki/themes/catppuccin-mocha.mjs"), import("shiki/themes/dracula.mjs"), import("shiki/themes/one-dark-pro.mjs")],
    langs: [import("shiki/langs/java.mjs"), import("shiki/langs/kotlin.mjs"), import("shiki/langs/python.mjs"), import("shiki/langs/javascript.mjs"), import("shiki/langs/typescript.mjs"), import("shiki/langs/c.mjs"), import("shiki/langs/cpp.mjs"), import("shiki/langs/csharp.mjs"), import("shiki/langs/go.mjs"), import("shiki/langs/rust.mjs"), import("shiki/langs/ruby.mjs"), import("shiki/langs/swift.mjs"), import("shiki/langs/scala.mjs"), import("shiki/langs/sql.mjs")],
    engine: createOnigurumaEngine(import("shiki/wasm")),
  });
}

export function highlightLanguage(language: string): string | null {
  const extension = sourceFileExtension(language);
  return ({ java: "java", kt: "kotlin", py: "python", js: "javascript", ts: "typescript", c: "c", cpp: "cpp", cs: "csharp", go: "go", rs: "rust", rb: "ruby", swift: "swift", scala: "scala", sql: "sql" } as Record<string, string>)[extension] ?? null;
}

export type HighlightedSource = { tokens: ThemedToken[][]; theme: string; foreground?: string; background?: string };

export async function tokensForSource(code: string, language: string, settings: Pick<CaptureSettings, "lightTheme" | "darkTheme">, dark: boolean): Promise<HighlightedSource | null> {
  const lang = highlightLanguage(language);
  if (!lang) return null;
  singleton ??= loadHighlighter().catch(error => { singleton = undefined; throw error; });
  const engine = await singleton;
  const theme = dark ? (settings.darkTheme ?? "github-dark") : (settings.lightTheme ?? "github-light");
  const palette = engine.getTheme(theme) as { fg?: string; bg?: string };
  return { tokens: engine.codeToTokens(code, { lang, theme }).tokens, theme, foreground: palette.fg, background: palette.bg };
}
