export const SWEA_EDITOR_SELECTORS = {
  code: ["textarea#textSource", "textarea[name='textSource']"],
  languageSelect: [
    "select#selectCodeLang",
    "select[name='selectCodeLang']",
    "select#codeLanguage",
    "select[name='codeLanguage']",
    "select[id*='lang' i]",
    "select[name*='lang' i]",
  ],
  languageValue: [
    "input#selectCodeLang",
    "input[name='selectCodeLang']",
    "input#codeLanguage",
    "input[name='codeLanguage']",
  ],
} as const;
