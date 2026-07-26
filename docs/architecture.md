# CodeArchive 아키텍처

## 구성 요소

- Popup: 빠른 상태 확인과 사용자 진입점
- Dashboard: 저장된 문제·풀이·복습 기록 관리
- Options: 확장 프로그램 설정
- Content Script: 현재 페이지 컨텍스트를 플랫폼 경계에 전달
- Background Service Worker: 확장 프로그램 수명 주기와 이후 저장·메시징 조정
- Platform Resolver: URL만으로 등록 어댑터를 선택
- Platform Adapter: 플랫폼별 DOM 접근과 캡처 DTO 생성
- Local Database: 검증된 핵심 엔터티의 로컬 저장소

TASK-0002는 Platform Resolver와 SWEA Platform Adapter 계약까지만 구현한다. Content
Script, Background와 Local Database를 연결하는 수집·저장 흐름은 아직 구현하지 않았다.

## 경계와 의존 방향

```text
Content Script
    │ URL + injected Document
    ▼
Platform Resolver
    │ selected adapter
    ▼
Platform Adapter ── DOM query / MutationObserver
    │
    ├── CapturedProblem
    ├── CapturedSolution
    ├── CapturedSubmission
    └── AdapterFailure / AdapterWarning
             │
             ▼
      수동 등록 또는 후속 저장 경계
```

- 공통 계층과 content script는 selector, 플랫폼 DOM 클래스명이나 `MutationObserver`를
  참조하지 않는다.
- DOM 쿼리는 `src/platforms/**`에만 둔다.
- resolver는 URL 지원 여부만 판단하며 DOM을 읽지 않는다.
- 어댑터는 전역 document 대신 `AdapterContext.document`를 사용한다.
- 캡처 DTO는 영구 엔터티가 아니다. 저장 전 ADR-0001 런타임 파서를 통과해야 한다.
- 예상 가능한 실패는 throw가 아니라 구조화된 결과로 전달한다.

## Resolver와 registry

`src/platforms/index.ts`의 `platformAdapters`가 등록 어댑터 목록의 단일 진입점이다. 현재
registry에는 SWEA만 있다. `resolveRegisteredPlatformAdapter(url)`은 첫 지원 어댑터를
반환하고, 없으면 DOM 접근 없이 `unsupported-url`과 수동 등록 fallback을 반환한다.

새 플랫폼은 독립 어댑터를 구현하고 registry에 명시적으로 등록한다. 공통 계약 변경,
새 Chrome host permission 또는 외부 통신이 필요하면 별도 작업 브리프와 ADR·보안 검토를
먼저 수행한다.

## 단계별 캡처

문제, 풀이와 제출 관찰은 서로 분리된다.

- 문제 캡처 성공 후 풀이 캡처가 실패해도 이미 검증된 문제 DTO는 유지한다.
- 필수 문제 번호·제목, 코드 또는 언어가 없으면 빈 값이나 기본값을 만들지 않는다.
- 알 수 없는 제출 결과는 `unknown`과 warning으로 전달하며 `accepted`로 추정하지 않는다.
- 제출 observer는 설치 직후 현재 값을 전달하고, 반환된 `disconnect()`는 중복 호출에도
  안전하다.
- 호출자는 실패 결과로 자동 저장을 중단하고 수동 입력으로 전환할 수 있다.

## 보안·데이터 영향

TASK-0002는 네트워크, 외부 전송, 로그, 저장 스키마, 마이그레이션, dependency,
`manifest.json` 권한과 host permission을 변경하지 않는다. 테스트 입력은 합성·비식별
fixture이며 실제 사이트 DOM과 사용자 세션을 보존하지 않는다.

## 현재 제한

- SWEA selector는 실제 사이트 계약이 아니라 합성 fixture 계약이다.
- content script에서 resolver·저장소까지 이어지는 완전한 수집 파이프라인은 비범위다.
- Chrome unpacked extension에서 popup/options/dashboard를 여는 수동 smoke는 `Not Run`이다.
- 실제 SWEA DOM 호환성과 제품 KPI는 `Not measured`이며 M2에서 검증한다.

관련 결정은 [ADR-0002](adr/ADR-0002-platform-adapter-fixtures.md)를 따른다.
