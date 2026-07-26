# TASK-0002 구현 → 검증 핸드오프

- 작업: TASK-0002 — 플랫폼 어댑터 계약과 fixture 전략
- GitHub Issue: [#2](https://github.com/devkimhongjin/codeArchive/issues/2)
- 구현 역할 상태: 제품 코드 구현 완료, 독립 검증 대기
- 구현 기준 저장소: `C:\workspace\personalPJT\codeArchive`
- 구현 범위: `src/platforms/**`만 변경

## 1. 변경 요약

- 공통 `PlatformAdapter`, `AdapterContext`, 캡처 DTO, observer, 성공·경고·실패 결과 계약을
  추가했다.
- URL만으로 등록 어댑터를 선택하는 resolver와 기본 SWEA registry를 추가했다.
- 주입된 `Document`만 읽는 최소 SWEA 어댑터를 구현했다.
- SWEA DOM 계약은 실제 사이트 selector가 아니라 검증 역할이 작성할 합성 fixture용
  `data-codearchive-*` 속성으로 한정했다.
- 문제, 풀이/언어, 제출 관찰 단계를 서로 독립된 메서드와 결과로 유지했다.
- 예상 가능한 URL, DOM, 코드, 언어와 observer 실패는 throw하지 않고 구조화된 실패와
  `manual-entry` 또는 `retry` fallback으로 반환한다.
- 네트워크, 전역 `document`, 저장, 권한, 외부 통신과 로그를 추가하지 않았다.

## 2. 변경 파일

- `src/platforms/common/PlatformAdapter.ts`
- `src/platforms/common/resolvePlatformAdapter.ts`
- `src/platforms/common/index.ts`
- `src/platforms/swea/SweaAdapter.ts`
- `src/platforms/swea/index.ts`
- `src/platforms/index.ts`

공유 설정, `src/common/**`, `src/content/**`, `tests/**`, fixture, 문서, project, package,
lockfile와 manifest는 수정하지 않았다.

## 3. 인수 조건별 구현 위치

| 인수 조건 | 구현 위치와 증거 |
| --- | --- |
| AC-0002-01 | `PlatformAdapter.ts`의 공통 계약, `resolvePlatformAdapter.ts`의 URL-only resolver |
| AC-0002-02 | `SweaAdapter.captureProblem`, `captureSolution`; HTTPS URL 정규화와 필수값 확인 |
| AC-0002-03 | `captureProblem`의 optional difficulty/tags warning과 빈 값 제거 |
| AC-0002-04 | `captureSolution`의 `code-unavailable`, solution 단계, recoverable/manual-entry |
| AC-0002-05 | 계약 root 부재 시 `dom-contract-changed`, 필수 문제 필드 부재 시 `missing-required-element` |
| AC-0002-06 | resolver와 SWEA 메서드의 `unsupported-url`, recoverable false/manual-entry |
| AC-0002-07 | Java/Python을 포함한 명시적 언어 표, 제출 결과 표, unknown warning, idempotent disconnect |
| AC-0002-08 | 문제·풀이·제출 메서드가 결과를 합치지 않는 독립 계약 |
| AC-0002-09 | 제품 코드에 실제 DOM/문제 원문/개인정보/토큰/쿠키/사용자 코드를 포함하지 않음 |
| AC-0002-10 | manifest와 설정 무변경; 전체 validate와 Chrome smoke는 독립 검증 역할 담당 |

## 4. 공개 계약과 정책

실패 코드는 기획의 최소 목록을 그대로 제공한다.

- `unsupported-url`
- `missing-required-element`
- `code-unavailable`
- `language-unresolved`
- `submission-observer-unavailable`
- `dom-contract-changed`
- `invalid-captured-data`

warning은 선택 필드 부재에 `optional-field-missing`, 알 수 없는 제출 결과에
`unknown-submission-result`를 사용한다. 오류와 warning은 허용된 필드명만 노출하고 selector,
DOM 원문, 문제 원문과 코드 원문을 포함하지 않는다.

지원 SWEA URL은 HTTPS와 다음 합성 계약 경로로 제한한다.

- `/main/code/problem/problemDetail.do`
- `/main/talk/solvingClub/problemView.do`

SWEA selector 계약:

- root: `data-codearchive-swea`
- 문제: `data-codearchive-problem-number`, `data-codearchive-problem-title`
- 선택 문제 필드: `data-codearchive-problem-difficulty`, `data-codearchive-problem-tags`
- 풀이: `data-codearchive-solution-code`, `data-codearchive-solution-language`
- 제출: `data-codearchive-submission-result`, 선택적 `data-codearchive-submission-language`

## 5. 검증 역할이 소유할 fixture와 기대 결과

구현 역할은 파일 소유권에 따라 fixture를 작성하지 않았다. 다음 네 종류를
`tests/fixtures/platforms/swea/**`에 합성·비식별 값으로 작성해야 한다.

1. 정상: 문제 번호·제목·선택 메타·코드·언어·제출 표식 → 단계별 성공
2. 부분 누락: 유효한 문제와 빈/없는 코드 → 문제 성공, 풀이 `code-unavailable`
3. DOM 변경: 지원 URL이나 root/필수 문제 계약 변경 → `dom-contract-changed` 또는
   `missing-required-element`
4. 비지원 URL: 다른 도메인 또는 미지원 SWEA 경로 → resolver `unsupported-url`, DOM 미접근

추가 경계 테스트:

- optional difficulty/tags 누락 warning과 빈 값 비반환
- Java/Python 매핑, 알 수 없는 언어 실패
- accepted, wrong-answer와 알 수 없는 제출 결과
- observer 콜백과 `disconnect()` 중복 호출
- resolver의 잘못된 URL 문자열
- 캡처 전후 fixture DOM 불변
- 문제 성공 후 풀이 실패가 문제 결과를 바꾸지 않음

## 6. 구현 역할 focused 검사

2026-07-26 canonical 저장소에서 실행:

```text
pnpm dlx npm@11.9.0 run lint
```

결과: PASS, ESLint warning 0.

```text
pnpm dlx npm@11.9.0 run typecheck
```

결과: PASS, `vue-tsc -b --noEmit`.

구현 역할은 검증 소유권을 지키기 위해 테스트/fixture를 추가하거나 최종 PASS를 선언하지
않았다. `npm ci`, `npm run validate`, 테스트 수 확인과 Chrome unpacked smoke는 검증 역할이
수행해야 한다.

## 7. 정적 DOM 경계와 보안 영향

- `querySelector`와 `MutationObserver` 사용은 `src/platforms/swea/SweaAdapter.ts`에만 있다.
- resolver와 공통 계약은 selector 및 SWEA DOM을 참조하지 않는다.
- `MutationObserver`는 주입된 `Document.defaultView`에서 얻으며 전역 브라우저 객체에
  결합하지 않는다.
- 네트워크 요청과 외부 전송: 없음.
- 데이터 저장과 마이그레이션: 없음.
- Chrome 권한 및 host permission 변경: 없음.
- 로그와 분석 이벤트: 없음.
- 비밀, 개인정보, DOM/코드 원문 오류 노출: 없음.

## 8. 제한과 수동 확인

- selector는 실제 SWEA DOM 지원이 아니라 합성 fixture 계약이다.
- 실제 SWEA 로그인, 편집기와 제출 UI는 접근하거나 검증하지 않았다.
- 알 수 없는 제출 결과는 성공 값 `unknown`과 warning으로 전달한다. 자동 저장 여부는
  호출자가 warning 정책에 따라 결정해야 한다.
- observer는 결과 요소가 이미 존재할 때만 설치하며 없으면 수동 fallback을 반환한다.
- 실제 사이트 조사는 M2의 별도 승인·보안 검토 전까지 수행하지 않는다.

검증 역할의 수동 smoke:

1. 전체 품질 게이트 후 `dist`를 Chrome unpacked extension으로 로드한다.
2. 기존 popup, options와 dashboard가 열리는지 확인한다.
3. manifest/host permission diff가 없는지 확인한다.
4. 실제 SWEA 사이트에는 접근하지 말고 합성 fixture 계약만 검증한다.

## 9. 기록 역할 반영 요청

독립 검증 PASS 후 `docs/platform-adapter.md`, `docs/architecture.md`,
`docs/security-policy.md`, ADR-0002, ADR index와 decision log에 실제 계약, 합성 fixture,
fallback, 제한과 보안 영향을 기록한다. KPI는 실제 표본이 없으므로 `Not measured`를
유지한다.

## 10. 검증 결함 해결

### BUG-TASK-0002-01

- 검증 결과: `src/platforms/common/PlatformAdapter.ts`와
  `src/platforms/swea/SweaAdapter.ts`의 Prettier 불일치로 전체 검증이 중단됨.
- 조치: 두 제품 파일에만 저장소의 Prettier 설정을 적용함.
- 재검증:
  - 두 파일 대상 `prettier --check`: PASS
  - `pnpm dlx npm@11.9.0 run lint`: PASS, warning 0
  - `pnpm dlx npm@11.9.0 run typecheck`: PASS
- 다른 제품·테스트·fixture·설정 파일은 결함 해결 범위에서 수정하지 않음.
- 상태: 해결, 독립 전체 검증 재실행 요청.
