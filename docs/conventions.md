# 개발 컨벤션

## TypeScript와 Vue

- 변수와 함수는 `camelCase`를 사용한다.
- 클래스, 타입, Vue 컴포넌트는 `PascalCase`를 사용한다.
- 상수는 `UPPER_SNAKE_CASE`를 사용한다.
- 플랫폼 DOM 접근은 `src/platforms` 하위 어댑터에 한정한다.
- `any`, 사용하지 않는 import와 변수, 민감 정보 로깅을 피한다.
- ESLint와 Prettier의 결과를 기준으로 한다.

## 커밋 메시지

기본 형식은 `<type>(<scope>): <subject>`이다. `scope`는 선택 사항이다.

허용 타입:

- `feat`, `fix`, `refactor`, `perf`, `style`
- `test`, `docs`, `build`, `ci`, `chore`
- `solve`, `review`

제목은 72자 이내로 작성하며 마침표를 붙이지 않는다.

```text
feat(github): 업로드 미리보기 추가
solve(swea): 1206 View
review(programmers): 42842 카펫 AI 없이 재풀이
```
