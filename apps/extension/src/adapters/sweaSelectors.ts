export const SWEA_ORIGIN = "https://swexpertacademy.com";
export const SWEA_SOLVING_PATH = "/main/solvingProblem/solvingProblem.do";
export const SWEA_PROBLEM_DETAIL_PATHS = [
  "/main/code/problem/problemDetail.do",
  "/main/code/userProblem/userProblemDetail.do"
] as const;

/** The solving page has a stable problem heading and source field. */
export const SWEA_SOLVING_HEADING_SELECTOR = "div.problem_box > h3";
export const SWEA_CONTEST_PROBLEM_ID_SELECTOR = "#contestProbId, input[name='contestProbId']";
export const SWEA_RESULT_SELECTOR = "div.popup_layer.show > div > p.txt";

export const SWEA_EDITOR_SELECTORS = {
  code: ["textarea#textSource", "textarea[name='textSource']"],
  language: [
    "select#sel_lang",
    "select#selectCodeLang",
    "select[name='selectCodeLang']",
    "select#codeLanguage",
    "select[name='codeLanguage']"
  ]
} as const;

/**
 * SWEA has used a few submit controls across the solving page revisions. Keep
 * this list finite and platform-scoped so a generic page button cannot start a
 * capture attempt.
 */
export const SWEA_SUBMIT_SELECTORS = [
  "a#btnf_proposal",
  "#submit",
  "#submitButton",
  "button[name='submit']",
  "input[name='submit']",
  ".btn_submit",
  ".btn-submit"
] as const;
