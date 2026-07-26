# ADR-0002: 플랫폼 어댑터와 합성 fixture 계약

- 상태: Accepted
- 결정일: 2026-07-26
- 작업: [TASK-0002 / GitHub Issue #2](https://github.com/devkimhongjin/codeArchive/issues/2)
- 범위: M0 플랫폼 어댑터 경계와 fixture 전략

## 맥락

CodeArchive는 여러 코딩 플랫폼에서 문제, 코드, 언어와 제출 결과를 수집해야 한다. 플랫폼
DOM은 서로 다르고 변경될 수 있으며, 공통 계층이 selector에 결합되면 플랫폼 변경이 전체
수집·저장 흐름으로 전파된다. 필수값을 읽지 못했는데 빈 문자열이나 기본값으로 저장하면
사용자 기록이 조용히 손상될 수 있다.

실제 사이트 HTML을 fixture로 복사하면 개인정보, 사용자 코드, 세션 값, 문제 원문과
저작권 대상 콘텐츠가 저장소에 들어갈 위험이 있다. 실제 SWEA DOM·로그인 세션 조사는
TASK-0002의 승인 범위가 아니며 Chrome host permission도 추가하지 않는다.

DEC-0003에서 요구한 fixture 전략을 장기적인 플랫폼 경계 결정으로 보존하기 위해 이 ADR을
작성한다.

## 결정

### 1. 플랫폼 DOM 경계

- 플랫폼별 DOM 쿼리와 `MutationObserver`는 `src/platforms/**` 안에만 둔다.
- 공통 계층은 selector와 DOM 구조를 알지 않고 URL과 어댑터 결과만 다룬다.
- 어댑터에는 전역 document가 아니라 URL과 주입된 `Document`를 전달한다.
- registry 기반 resolver가 URL 지원 여부만으로 어댑터를 선택한다.
- 지원 어댑터가 없거나 URL이 유효하지 않으면 DOM을 읽지 않고 구조화된
  `unsupported-url`을 반환한다.

### 2. 단계별 결과와 수동 fallback

- 문제, 풀이/언어, 제출 관찰은 독립 메서드와 독립 결과로 유지한다.
- 성공은 검증된 DTO와 선택적 warning을 반환한다.
- 예상 가능한 실패는 고정 실패 코드, 단계, 복구 가능 여부, fallback과 제한된
  `missingFields`를 가진 결과로 반환한다.
- 필수 문제 값, 코드, 언어 또는 DOM 계약이 없으면 자동 저장을 진행하지 않고
  `manual-entry` 신호를 반환한다.
- 알 수 없는 언어는 임의 기본값으로 바꾸지 않는다.
- 알 수 없는 제출 결과는 `accepted`로 추정하지 않고 `unknown`과 warning으로 전달한다.
- 캡처 DTO는 영구 엔터티가 아니며 저장 전에 ADR-0001 경계 검증을 거친다.

### 3. 최소 합성·비식별 fixture

- 실제 사이트 HTML 복사본을 저장하지 않는다.
- 정상, 선택 필드 누락, 코드 누락, DOM 계약 변경의 최소 합성 HTML과 비지원 URL
  메타데이터를 둔다.
- fixture 값은 `SYN-*`, `Synthetic*`처럼 합성임을 명확히 한다.
- 실제 문제 본문, 공식 해설, 전체 테스트 케이스, 실제 사용자 코드, 개인정보, 쿠키,
  세션·제출 식별자와 비밀 값은 금지한다.
- script, 외부 리소스와 네트워크 요청을 포함하지 않는다.
- `cases.json`에 합성 여부, 목적, 기대 결과와 갱신 정책을 기록한다.
- fixture는 어댑터 계약이 의도적으로 바뀔 때만 최소 범위로 갱신한다.

## 고려한 대안

### 실제 SWEA DOM 전체를 fixture로 저장

실제 selector 회귀에는 가깝지만 개인정보·저작권·세션 정보가 섞일 위험이 크고 DOM 변경
때마다 대용량 fixture를 갱신해야 한다. 별도 승인과 비식별 절차 없는 저장은 거부한다.

### 공통 content script에서 플랫폼별 selector를 직접 처리

초기 파일 수는 줄지만 플랫폼 분기와 DOM 변경이 공통 흐름에 누적되고 독립 테스트와 새
플랫폼 확장이 어려워진다. selector를 어댑터 경계에 격리한다.

### 실패 시 예외 또는 빈 DTO 반환

예외는 호출자가 단계별 복구를 판별하기 어렵고, 빈 DTO는 잘못된 자동 저장을 유발한다.
구조화된 실패와 명시적 fallback을 선택한다.

### 실제 브라우저 E2E만 사용

실제 환경 검증에는 필요하지만 로그인, 네트워크, 사이트 변경과 권한에 의존해 M0 계약
테스트가 불안정해진다. 합성 fixture 계약 테스트를 기본으로 하고 실제 사이트 검증은 M2의
별도 게이트로 둔다.

## 결과

장점:

- DOM 변경과 플랫폼 분기가 공통 계층에서 격리된다.
- 문제 성공과 풀이 실패처럼 부분 결과를 손상 없이 구분할 수 있다.
- 실패만으로 호출자가 자동 저장 중단과 수동 등록 전환을 판별할 수 있다.
- fixture가 작고 결정적이며 개인정보·저작권 노출 위험을 낮춘다.

비용과 위험:

- 합성 selector는 실제 SWEA DOM 호환성을 증명하지 않는다.
- 어댑터별 매핑표와 fixture를 계약 변경에 맞춰 함께 유지해야 한다.
- warning을 저장 허용으로 볼지 여부는 후속 orchestration 정책이 필요하다.
- Chrome unpacked extension smoke가 `Not Run`이므로 통합 전 사람 검증이 남는다.

## 구현과 검증 결과

- 공통 계약, resolver와 SWEA 최소 어댑터를 `src/platforms/**`에 구현했다.
- 합성 HTML fixture 4종과 메타데이터, 계약 테스트 11개를 추가했다.
- focused 11개 테스트와 전체 회귀 24개 테스트가 통과했다.
- lint, format, typecheck와 production build가 통과했다.
- 공통/content 계층의 DOM 접근 문자열, fixture 민감 패턴과 외부 리소스는 0건이었다.
- manifest, dependency, 저장 스키마, 마이그레이션과 외부 통신 변경은 없다.

실제 SWEA 수집 성공률, 언어 감지율과 제출 결과 감지율은 실제 표본이 없어
`Not measured`다. 합성 fixture 통과를 제품 KPI로 환산하지 않는다.

## 롤백과 재검토 조건

- SWEA 자동 수집을 비활성화하려면 registry에서 SWEA 어댑터 등록을 제거한다. resolver는
  `unsupported-url`과 수동 등록 fallback으로 돌아간다.
- 계약 회귀가 확인되면 자동 저장 연결을 중단하고 수동 등록 신호를 유지한다.
- 실제 SWEA DOM을 지원하거나 host permission을 추가할 때 재검토한다.
- 실제 DOM fixture, 네트워크 기반 E2E 또는 새 플랫폼 공통 계약 변경이 필요할 때 후속
  ADR을 작성한다.
- 저장 orchestration이 warning별 자동 저장 정책을 결정할 때 이 ADR의 실패 안전 원칙과
  충돌 여부를 검토한다.
