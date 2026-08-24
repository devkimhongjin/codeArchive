export const SWEA_PROBLEM_DETAIL_PATH = "/main/code/problem/problemDetail.do";

export const SWEA_SELECTORS = {
  heading: [
    ".problem_name",
    ".problem-title",
    ".problem_detail .tit",
    ".problem_detail h3",
    ".problem_detail h2",
  ],
  difficulty: [
    ".problem_level",
    ".problem-level",
    ".problem_detail .difficulty",
    ".problem_detail .level",
  ],
} as const;
