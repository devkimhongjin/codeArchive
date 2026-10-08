import assert from "node:assert/strict";
import test from "node:test";
import { DARK_THEMES, LIGHT_THEMES, highlightLanguage, tokensForSource } from "../src/highlighter";
import { bundledThemesInfo } from "shiki";

test("archive highlighter exposes the all bundled themes and plain-text fallback", () => {
  assert.equal(LIGHT_THEMES.length, 21); assert.equal(DARK_THEMES.length, 44);
  assert.equal(highlightLanguage("Scala 3"), "scala");
  assert.equal(highlightLanguage("Java 21"), "java");
  assert.equal(highlightLanguage("Unknown language"), null);
});

test("all 65 themes render with correct classification and actual local palettes", async () => {
  assert.deepEqual([...LIGHT_THEMES, ...DARK_THEMES].sort(), bundledThemesInfo.map(theme => theme.id).sort());
  for (const { id, type } of bundledThemesInfo) {
    const result = await tokensForSource('const answer = 42;', 'JavaScript',
      type === 'light' ? { lightTheme: id as typeof LIGHT_THEMES[number] } : { darkTheme: id as typeof DARK_THEMES[number] }, type === 'dark');
    assert.equal(result?.theme, id); assert.ok(result?.background); assert.ok(result?.foreground);
    assert.equal(result?.tokens.flat().map(token => token.content).join(''), 'const answer = 42;');
  }
});

test("archive highlighter produces local Shiki tokens for a supported language", async () => {
  const light = await tokensForSource("const answer = 42;", "JavaScript", { lightTheme: "github-light", darkTheme: "dracula" }, false);
  const dark = await tokensForSource("const answer = 42;", "JavaScript", { lightTheme: "github-light", darkTheme: "dracula" }, true);
  assert.ok(light); assert.ok(dark); assert.equal(light.tokens.flat().map(token => token.content).join(""), "const answer = 42;");
  assert.equal(light.theme, "github-light"); assert.equal(dark.theme, "dracula");
  assert.ok(light.foreground); assert.ok(light.background); assert.ok(dark.foreground); assert.ok(dark.background);
  assert.notEqual(light.background, dark.background);
});
