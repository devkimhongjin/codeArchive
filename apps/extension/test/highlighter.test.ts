import assert from "node:assert/strict";
import test from "node:test";
import { DARK_THEMES, LIGHT_THEMES, highlightLanguage, tokensForSource } from "../src/highlighter";

test("archive highlighter exposes the required ten themes and plain-text fallback", () => {
  assert.equal(LIGHT_THEMES.length, 5); assert.equal(DARK_THEMES.length, 5);
  assert.equal(highlightLanguage("Scala 3"), "scala");
  assert.equal(highlightLanguage("Java 21"), "java");
  assert.equal(highlightLanguage("Unknown language"), null);
});

test("archive highlighter produces local Shiki tokens for a supported language", async () => {
  const light = await tokensForSource("const answer = 42;", "JavaScript", { lightTheme: "github-light", darkTheme: "dracula" }, false);
  const dark = await tokensForSource("const answer = 42;", "JavaScript", { lightTheme: "github-light", darkTheme: "dracula" }, true);
  assert.ok(light); assert.ok(dark); assert.equal(light.tokens.flat().map(token => token.content).join(""), "const answer = 42;");
  assert.equal(light.theme, "github-light"); assert.equal(dark.theme, "dracula");
  assert.ok(light.foreground); assert.ok(light.background); assert.ok(dark.foreground); assert.ok(dark.background);
  assert.notEqual(light.background, dark.background);
});
