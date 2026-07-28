# TASK-0004 기획 → 구현 핸드오프

## 기본 정보

- 작업 ID: `TASK-0004`
- 제목: 기존 풀이 수동 등록 최소 흐름
- GitHub Issue: [#4](https://github.com/devkimhongjin/codeArchive/issues/4)
- 상태: `Ready`
- 우선순위: `P0`
- 기획일: 2026-07-27
- 선행: TASK-0001, TASK-0003
- 착수 조건: TASK-0003 저장소 구현 완료 후 `In Progress`로 전환
- 목적: 자동 수집 전에 사용자가 기존 풀이 하나를 1분 안에 직접 등록하고 브라우저 재실행 뒤에도 조회·수정하는 프로토타입 제공

## 사용자 흐름

1. 사용자는 기존 Popup의 `대시보드 열기` 버튼으로 Dashboard에 진입한다.
2. Dashboard 한 페이지에서 저장된 풀이 목록을 보고 `풀이 추가`를 선택한다.
3. 플랫폼, 제목 또는 문제 번호, 언어를 입력한다. 코드와 풀이 날짜는 선택 입력이다.
4. AI 활용 수준은 기본 `unrecorded`이며 사용자가 다른 값을 선택할 수 있다.
5. 저장 전에 `platform + problemNumber` 또는 `platform + 정규화 title`로 중복 후보를 확인한다.
6. 후보가 없으면 새 Problem + SolutionSession + AIUsageRecord를 원자 저장한다.
7. 후보가 있으면 자동 병합하지 않고 다음 중 하나를 사용자가 선택한다.
   - 기존 Problem에 새 SolutionSession + AIUsageRecord 추가
   - 별도 Problem으로 저장
   - 취소하고 입력 수정
8. 저장 결과를 목록과 상세에서 확인하고 상세에서 수정할 수 있다.

목록, 추가, 상세, 수정은 라우터를 추가하지 않고 기존 Dashboard의 단일 페이지 상태로 전환한다.

## 입력과 생성 규칙

| 항목 | 규칙 |
| --- | --- |
| 플랫폼 | 필수. 기존 `Platform` 계약의 지원 값만 허용 |
| 제목/문제 번호 | 둘 중 하나 이상 필수. 둘 다 있으면 모두 저장 |
| 언어 | 필수. 기존 `ProgrammingLanguage` 계약 사용 |
| 코드 | 선택. 공백 문자열은 미입력으로 정규화 |
| 풀이 날짜 | 선택. 입력 시 기존 날짜 계약을 만족해야 함 |
| AI 수준 | 기본 `unrecorded`; 세션마다 독립 기록 |
| 세션 결과 | 수동 등록은 `unknown` |
| 데이터 출처 | Problem과 SolutionSession 모두 `manual` |

- 새 Problem, SolutionSession, AIUsageRecord의 ID는 TASK-0001 namespaced UUID 규칙으로 생성한다.
- 생성 시각은 같은 저장 시도의 현재 UTC 시각을 사용한다.
- AIUsageRecord는 SolutionSession과 1:1로 항상 생성한다.
- Submission은 생성하지 않는다.

## 중복 처리

- 강한 후보: 동일 플랫폼과 정규화한 `problemNumber`가 일치한다.
- 약한 후보: 동일 플랫폼과 NFKC·trim·공백 축약·소문자화한 title이 일치한다.
- 후보는 안내일 뿐 자동 동일성 판정이나 자동 덮어쓰기 근거가 아니다.
- 기존 Problem 선택 시 새 Problem을 생성하거나 기존 Problem을 수정하지 않고 새 SolutionSession + AIUsageRecord만 원자 저장한다.
- 별도 저장을 선택하면 새 세 엔터티를 생성한다. 이후 병합 기능은 후속 범위다.

## 상세·수정 규칙

- 상세는 Problem 정보와 선택한 SolutionSession, 대응 AIUsageRecord를 함께 표시한다.
- 수정 가능 항목은 수동 등록 폼과 동일한 사용자 입력 필드다.
- 수정 시 세 엔터티의 ID와 `createdAt`은 유지하고 변경된 엔터티의 `updatedAt`만 갱신한다.
- 관계 ID는 유지한다. 수정 중 관계를 다른 Problem 또는 Session으로 바꾸지 않는다.
- Problem이 여러 Session에서 공유될 수 있으므로 Problem 필드 수정 전에 공유 영향이 있음을 안내한다.
- 저장 실패 시 기존 데이터와 입력 상태를 유지하고 재시도 가능한 오류를 표시한다.

## 요구사항

| ID | 요구사항 | 우선순위 | 근거 |
| --- | --- | --- | --- |
| REQ-0004-01 | 기존 Popup → Dashboard 진입을 유지한다. | Must | 현재 확장 진입 흐름 |
| REQ-0004-02 | Dashboard 단일 페이지에서 목록·추가·상세·수정을 전환한다. | Must | 프로토타입 범위 |
| REQ-0004-03 | 플랫폼, 언어와 제목·번호 중 하나를 필수 검증한다. | Must | TASK-0001 조건부 필수 |
| REQ-0004-04 | 수동 세션은 result unknown, source manual, AI 기본 unrecorded로 생성한다. | Must | 핵심 데이터 계약 |
| REQ-0004-05 | 새 Problem과 Session, AI 기록을 단일 transaction으로 저장한다. | Must | TASK-0003 원자 저장 |
| REQ-0004-06 | 중복 후보를 안내하고 기존 Problem 추가 또는 별도 저장을 명시적으로 선택하게 한다. | Must | 데이터 손실 방지 |
| REQ-0004-07 | 저장 결과를 목록·상세에서 재조회하고 수정한다. | Must | 기존 풀이 관리 가치 |
| REQ-0004-08 | 수정 시 ID와 createdAt을 보존한다. | Must | 참조 무결성 |
| REQ-0004-09 | 권한, host permission, 외부 통신과 dependency를 추가하지 않는다. | Must | 프로토타입 보안·속도 |

## 인수 조건

| ID | Given | When | Then |
| --- | --- | --- | --- |
| AC-0004-01 | 설치된 확장의 Popup | `대시보드 열기` 선택 | 기존 Dashboard 탭을 연다. |
| AC-0004-02 | Dashboard | 목록·추가·상세·수정 동작 | 페이지 이동 없이 네 상태를 전환한다. |
| AC-0004-03 | 플랫폼 또는 언어가 비었거나 제목과 번호가 모두 빈 폼 | 저장 | 각 입력 위치에 오류를 표시하고 저장소를 호출하지 않는다. |
| AC-0004-04 | 최소 유효 입력 | 신규 저장 | Problem + SolutionSession + AIUsageRecord가 원자 저장되며 result unknown, source manual, AI level unrecorded다. |
| AC-0004-05 | 같은 플랫폼·번호 또는 플랫폼·정규화 제목의 기존 Problem | 저장 시도 | 후보를 표시하고 사용자 선택 전에는 저장하거나 덮어쓰지 않는다. |
| AC-0004-06 | 중복 후보에서 기존 Problem 선택 | 저장 | 기존 Problem은 유지하고 새 Session + AIUsageRecord를 함께 저장한다. |
| AC-0004-07 | 중복 후보에서 별도 저장 선택 | 저장 | 새 Problem + Session + AIUsageRecord를 저장한다. |
| AC-0004-08 | 저장 완료 또는 Dashboard 재실행 | 목록과 상세 조회 | 저장한 입력과 기본값을 다시 확인할 수 있다. |
| AC-0004-09 | 생성된 기록 상세 | 필드를 수정 후 저장 | ID와 createdAt은 유지되고 입력 변경과 updatedAt만 반영된다. |
| AC-0004-10 | 묶음 저장 실패 | 오류 처리 | 부분 데이터가 남지 않고 입력을 유지한 채 재시도 메시지를 표시한다. |

## 구현 경계와 소유권

- 구현 역할 소유: `src/dashboard/**`, 필요 시 Dashboard 전용 service/composable.
- Popup은 기존 `대시보드 열기` 흐름을 유지하며 변경이 불필요하면 수정하지 않는다.
- 저장은 TASK-0003 repository 공개 계약만 사용한다. Dashboard에서 IndexedDB object store를 직접 조작하지 않는다.
- 공통 데이터 타입과 validator는 TASK-0001 계약을 재사용하고 임의 변경하지 않는다.
- DOM 접근, 새 Chrome/host permission, 외부 통신을 추가하지 않는다.
- `package.json`, lockfile, manifest는 이번 범위에서 수정하지 않는다.
- 공유 파일 변경이 필요하면 구현을 멈추고 기획 변경 요청으로 반환한다.

## 제외 및 후속

- 파일, 폴더, ZIP, JSON, Markdown 일괄 가져오기
- URL 입력 분석과 플랫폼 자동 수집
- Submission 생성과 제출 이력 UI
- 삭제, cascade, 중복 병합과 병합 취소
- 검색, 필터, 정렬, 통계, 차트, 페이지네이션
- 완성형 반응형 디자인, 디자인 시스템, 라우팅
- 실사이트 DOM 연동

## 최소 확인과 기록

사용자의 프로토타입 우선 지시에 따라 구현 뒤 다음만 최소 확인한다.

- `npm run lint`
- `npm run typecheck`
- `npm run build`

정상·필수값 누락·중복 선택·원자 저장 실패·재실행·수정의 독립 검증과 전체
`npm run validate`는 프로토타입 통합 시점으로 유예한다. 그 전에는 `Done`으로 판정하지 않는다.

기록 역할은 최소한 다음을 갱신한다.

- README: Popup → Dashboard, 등록·중복 선택·상세·수정 사용 흐름과 현재 제한
- `docs/project/tech-stack.md`: Vue 단일 페이지 상태 전환, native IndexedDB repository 직접 사용 선택 이유와 검토 대안
- troubleshooting: 실제 구현 중 발생한 문제와 해결만 기록

## KPI와 위험

- KPI 시나리오: 빈 Dashboard에서 추가를 열어 플랫폼, 제목 또는 번호, 언어를 입력하고 기본 AI 수준으로 저장 완료 메시지를 확인할 때까지 측정한다.
- 목표값: 수동 등록 1분 이내. 프로토타입 통합 검증 전에는 `Not measured`로 유지한다.
- 공유 Problem 수정은 다른 Session 상세에 영향을 줄 수 있다. 프로토타입에서는 영향 안내로 제한한다.
- 중복 후보는 완전한 동일성 판정이 아니므로 false positive/negative 위험이 남는다.
- 롤백은 Dashboard 수동 등록 호출 연결을 제거하고 TASK-0003 저장 데이터와 schema version은 유지하는 방식으로 한다.

## 변경 이력

| 일시 | 변경 내용 | 사유 | 승인 |
| --- | --- | --- | --- |
| 2026-07-27 | 단일 페이지 수동 등록 프로토타입 범위 승인 | 프로토타입 우선, 자동 수집 전 사용자 가치 확인 | 사용자 지시 |
