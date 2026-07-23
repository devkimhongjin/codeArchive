# 개발 환경 구성

## 요구 사항

- Node.js 22 (LTS)
- npm
- Chrome
- Git

## 설치

```bash
npm ci
```

## 개발

```bash
npm run dev
```

Chrome에서 `chrome://extensions`를 열고 개발자 모드를 활성화한 뒤, `npm run build`로 생성된 `dist` 폴더를 압축 해제된 확장 프로그램으로 로드한다.

## 검증

```bash
npm run validate
```

`validate`는 ESLint, Prettier, TypeScript, Vitest, 프로덕션 빌드를 순서대로 실행한다. 개별 명령은 다음과 같다.

- `npm run lint`: 정적 분석
- `npm run format:check`: 포맷 검사
- `npm run typecheck`: TypeScript 타입 검사
- `npm test`: 단위 테스트
- `npm run build`: Chrome Extension 빌드

## Git Hook

`npm ci` 후 `prepare` 스크립트가 Husky를 설정한다.

- 커밋 전: 변경 파일에 ESLint와 Prettier 적용
- 커밋 메시지 작성 후: Conventional Commits 형식 검사

커밋 메시지 예시는 `feat(github): 업로드 미리보기 추가`이다.
