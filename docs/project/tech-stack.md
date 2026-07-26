# 기술 스택과 선택 근거

이 문서는 실제 저장소 설정과 CodeArchive 제안서에서 확인된 기술만 기록한다. 도입 예정 도구는 현재 사용 중인 도구와 구분한다.

## 현재 확인된 스택

| 영역            | 기술                                            | 근거                                               | 선택 이유                                           | 주의점                                                             |
| --------------- | ----------------------------------------------- | -------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| 런타임          | Node.js 22                                      | `.node-version`, `.nvmrc`                          | 최신 프런트엔드 도구 체인과 CI 환경 통일            | 정확한 최소 minor와 지원 종료일을 릴리스 시 확인                   |
| 패키지 관리     | npm, `package-lock.json`                        | `npm ci` 및 CI 설정                                | 재현 가능한 의존성 설치                             | CI는 반드시 `npm ci` 사용                                          |
| 언어            | TypeScript 6                                    | `package.json`, tsconfig                           | 확장 프로그램 메시지와 데이터 모델의 정적 검증      | 브라우저/Node 설정 분리 필요                                       |
| UI              | Vue 3                                           | Vue SFC와 `@vitejs/plugin-vue`                     | popup, dashboard, options UI 구성                   | 컴포넌트 테스트 도구는 아직 없음                                   |
| 빌드            | Vite 8/Rollup                                   | `vite.config.ts`                                   | 다중 HTML과 background/content entry 빌드           | manifest 참조 경로 자동 검증 필요                                  |
| 플랫폼          | Chrome Extension Manifest V3                    | `public/manifest.json`                             | popup, service worker, storage 기반 제품 요구       | content script 등록 및 최소 권한 검토 필요                         |
| 단위 테스트     | Vitest 4                                        | `package.json`, `tests/unit/data-contract.test.ts` | Vite/TypeScript와 통합된 빠른 테스트                | TASK-0001 데이터 계약 13개 테스트가 있으며 coverage는 미측정       |
| 데이터 검증     | 순수 TypeScript 런타임 파서                     | `src/common/validators/index.ts`, ADR-0001         | 의존성 추가 없이 외부·저장 경계의 unknown 입력 검증 | 타입과 수동 파서의 동기화를 회귀 테스트로 유지                     |
| 정적 분석       | ESLint 10, typescript-eslint, eslint-plugin-vue | `eslint.config.js`                                 | TS/Vue 오류와 컨벤션 검사                           | 현재 type-aware 규칙이 아니어서 floating Promise 등을 놓칠 수 있음 |
| 포맷            | Prettier 3                                      | `prettier.config.js`                               | 일관된 포맷과 리뷰 노이즈 감소                      | 생성물/문서 제외 범위 관리                                         |
| Git 품질 게이트 | Husky, lint-staged, commitlint                  | `.husky`, `commitlint.config.js`                   | 커밋 전 변경 파일과 메시지 검사                     | Hook 우회 가능하므로 CI가 최종 게이트                              |
| CI              | GitHub Actions                                  | `.github/workflows/validate.yml`                   | PR과 보호 브랜치의 재현 가능한 검증                 | 브랜치 보호와 배포 workflow는 별도 설정 필요                       |
| 저장소 API      | Chrome storage/downloads                        | manifest 권한                                      | 로컬 기록과 파일 내보내기 요구                      | 권한 사용 근거와 데이터 보존 정책 필요                             |

## 검증을 위해 도입 제안된 스택

아래 항목은 승인·설치 전까지 “현재 스택”으로 기록하지 않는다.

| 후보                          | 목적                               | 도입 조건                                | 결정 기록               |
| ----------------------------- | ---------------------------------- | ---------------------------------------- | ----------------------- |
| `@vitest/coverage-v8`         | coverage 및 임계치 강제            | 실제 테스트 추가와 함께 도입             | 의존성 변경 PR 또는 ADR |
| `@vue/test-utils` + jsdom     | Vue 컴포넌트 테스트                | popup/options/dashboard 동작 구현 시     | 의존성 변경 PR          |
| Playwright                    | MV3 확장 E2E 및 설치 smoke test    | 안정적인 Chromium extension fixture 확보 | ADR 권장                |
| artifact 검증 Node 스크립트   | manifest 경로, 버전, ZIP 구조 검증 | 패키징 단계 도입 전 필수                 | 구현 작업               |
| dependency review/secret scan | 공급망·비밀정보 점검               | GitHub 보안 정책 승인                    | CI/보안 ADR             |

## 스택 변경 규칙

1. 기술 추가·교체 전 해결할 문제와 비기능 요구사항을 명시한다.
2. 유지보수성, 번들 크기, MV3 호환성, 테스트 가능성, 라이선스를 비교한다.
3. 아키텍처나 운영 방식에 장기 영향을 주면 ADR을 작성한다.
4. 승인된 변경 후 이 문서, lockfile, 개발 환경 문서를 같은 작업에서 갱신한다.
5. 버전 숫자는 저장소 설정을 근거로 갱신하며 추측하지 않는다.
