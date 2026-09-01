export const PROGRAMMERS_ORIGIN = "https://school.programmers.co.kr";
export const PROGRAMMERS_LESSON_PATH = /^\/learn\/courses\/30\/lessons\/(\d+)\/?$/;

export const PROGRAMMERS_SELECTORS = {
  title: [".challenge-title"],
  language: [".challenge-nav .dropdown-toggle"],
  code: ["textarea#code[name='code']"],
} as const;
