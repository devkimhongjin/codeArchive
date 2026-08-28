# CodeArchive 개발 명세서

> 코딩테스트 풀이 자동 기록·분석·외부 연동 서비스  
> 문서 버전: 2.1
> 기준 상태: SWEA local-first 베타 구현 및 Extension capture-only 구조 전환 중
> 문서 성격: 기능·기술·운영·유지보수 구현 명세서

---

## 1. 프로젝트 정의

### 1.1 프로젝트명

**CodeArchive**

### 1.2 시스템 목적

CodeArchive는 코딩테스트 플랫폼에서 사용자가 제출한 문제 정보와 정답 코드를 자동으로 수집하고, 풀이 기록을 통합 관리하는 서비스다.

수집된 기록은 다음 형태로 활용한다.

- 로컬 데이터베이스 저장
- 소스 코드 파일 다운로드
- Markdown 문서 다운로드
- ZIP 백업
- GitHub 저장소 업로드
- Notion 데이터베이스 또는 페이지 업로드
- AI 코드 리뷰
- 학습 통계 생성
- 강점·약점 분석
- 복습 문제 및 신규 문제 추천

### 1.3 개발 목표

본 프로젝트는 특정 기술 하나를 깊게 구현하는 것뿐 아니라, 하나의 서비스를 구성하는 다양한 기술 영역을 경험하는 것을 목표로 한다.

주요 기술 경험 범위는 다음과 같다.

- Chrome Extension 개발
- 웹 프론트엔드 개발
- REST API 서버 개발
- Python 기반 분석 서버 개발
- 관계형 데이터베이스 설계
- Redis 캐시 및 비동기 작업 처리
- OAuth 기반 외부 서비스 연동
- 파일 생성 및 압축 처리
- AI API 연동
- 통계 분석 및 추천 로직 구현
- CI/CD 및 자동 배포
- 모니터링·로깅·오류 추적
- 사용자 피드백 기반 유지보수
- Chrome Web Store 수정 배포

### 1.4 제외 범위

다음 항목은 본 명세의 구현 범위에서 제외한다.

- AI 에이전트의 역할 분담 전략
- 멀티 에이전트 오케스트레이션 방식
- 자율 실행형 AI 워크플로
- 문제 정답을 자동 제출하는 기능
- 플랫폼 로그인 정보 수집
- 문제 본문 전체의 무단 저장
- 공식 해설 또는 비공개 테스트 데이터 수집

AI 기능은 코드 리뷰, 분석, 문서 생성, 추천 근거 생성에 필요한 API 호출 인터페이스까지만 명세한다.

---

## 2. 지원 환경

### 2.1 지원 브라우저

| 구분 | 지원 범위 |
|---|---|
| 1차 지원 | Google Chrome 최신 안정 버전 |
| 2차 지원 | Microsoft Edge Chromium |
| 향후 검토 | Firefox WebExtension |

### 2.2 지원 플랫폼

| 우선순위 | 플랫폼 | 1차 수집 항목 |
|---:|---|---|
| 1 | SWEA | 문제 번호, 제목, 난이도, 언어, 코드, 제출 결과 |
| 2 | 프로그래머스 | 문제 ID, 제목, 레벨, 언어, 코드, 제출 결과 |
| 3 | 정올 | 문제 번호, 제목, 언어, 코드, 제출 결과 |
| 4 | LeetCode | 문제 slug, 제목, 난이도, 태그, 언어, 코드, 결과 |
| 5 | 백준 | 문제 번호, 제목, 난이도, 태그, 언어, 코드, 결과 |

### 2.3 지원 언어

- Java
- Python
- C
- C++
- JavaScript
- TypeScript
- Kotlin
- C#
- Go
- Rust
- Swift

플랫폼이 제공하는 언어 이름을 내부 표준 언어 코드로 변환하여 저장한다.

---

## 3. 전체 시스템 구성

### 3.1 구성 요소

```text
Coding Test Platform
        │
        ▼
Chrome Extension
- Content Script
- Platform Adapter
- Submission Observer
- Popup
- Local Capture Store
        │
        ├──────────────► Local Export
        │                - Source File
        │                - Markdown
        │                - JSON
        │                - ZIP
        │
        ▼ (사용자가 로그인된 Dashboard에서 가져오기 실행)
Web Dashboard
- GitHub Login
- Extension Import Bridge
- Import Preview / Management
        │
        ▼
Main API Server
- Authentication
- Problem/Solution API
- Integration API
- Statistics API
- Feedback API
        │
        ├──────────────► PostgreSQL
        ├──────────────► Redis
        ├──────────────► Object Storage
        ├──────────────► GitHub API
        ├──────────────► Notion API
        └──────────────► Analysis Service
                            - AI Review
                            - Statistics
                            - Weakness Analysis
                            - Recommendation
```

### 3.2 서비스 분리

| 서비스 | 역할 | 권장 기술 |
|---|---|---|
| Browser Extension | 플랫폼 감지, 코드·결과 수집, 로컬 저장·내보내기 | Manifest V3, TypeScript, React, Vite |
| Web Dashboard | 로그인, Extension 기록 가져오기, 서버 동기화, 기록·통계·설정·외부 연동 관리 | React, TypeScript, React Router, Zustand, TanStack Query |
| Main API | 인증, CRUD, 연동, 파일 생성 요청 | Java 21, Spring Boot 3 |
| Analysis API | AI 리뷰, 통계 분석, 문제 추천 | Python, FastAPI |
| Worker | 장시간 작업과 재시도 | Celery 또는 RQ |
| Database | 영구 데이터 저장 | PostgreSQL |
| Cache/Queue | 캐시, 세션, 작업 큐 | Redis |
| File Storage | ZIP·백업·생성 문서 저장 | S3 호환 Object Storage |
| Monitoring | 오류·성능·로그 추적 | Sentry, Prometheus, Grafana |

### 3.3 기술 스택 선정 원칙

프로젝트 학습 범위를 넓히기 위해 메인 API와 분석 API를 서로 다른 언어로 구성한다.

- **Java/Spring Boot**: 도메인 모델, 인증, 트랜잭션, 외부 연동, API 설계 경험
- **Python/FastAPI**: AI 연동, 데이터 분석, 추천 로직, 비동기 작업 경험
- **TypeScript/React**: 확장 프로그램과 웹 UI의 타입 안정성, 컴포넌트 재사용 및 공통 모델 활용
- **PostgreSQL**: 관계형 모델, 인덱스, 집계 쿼리, 마이그레이션 경험
- **Redis**: 캐시, 요청 제한, 분산 락, 작업 상태 저장 경험
- **Docker/CI/CD**: 로컬 환경 통일, 테스트 자동화, 배포 경험

---

## 4. Chrome Extension 명세

### 4.1 기술 구성

- Chrome Extension Manifest V3
- TypeScript
- React
- Vite
- Chrome Storage API
- IndexedDB
- Content Script
- Background Service Worker
- MutationObserver
- Web Crypto API
- Vitest
- Playwright

### 4.2 주요 모듈

```text
extension/src/
├── background/
├── content/
├── popup/
├── options/
├── adapters/
│   ├── swea/
│   ├── programmers/
│   ├── jungol/
│   ├── leetcode/
│   └── baekjoon/
├── capture/
├── storage/
├── dashboard-bridge/
├── export/
├── feedback/
├── common/
└── tests/
```

팝업과 옵션 화면은 React 컴포넌트(`.tsx`)로 구현하며, Content Script와 Background Service Worker는 프레임워크에 의존하지 않는 TypeScript 모듈로 유지한다.

### 4.3 플랫폼 어댑터 인터페이스

```ts
interface PlatformAdapter {
  platform: PlatformCode;

  matches(url: URL): boolean;

  isProblemPage(): boolean;

  getProblemInfo(): Promise<ProblemInfo>;

  getSourceCode(): Promise<string | null>;

  getLanguage(): Promise<ProgrammingLanguage | null>;

  observeSubmission(
    callback: (submission: CapturedSubmission) => void
  ): () => void;

  validateSelectors(): Promise<SelectorHealthResult>;
}
```

### 4.4 자동 수집 요구사항

확장 프로그램은 지원 플랫폼의 문제 또는 제출 페이지에서 다음 정보를 수집한다.

- 플랫폼 코드
- 문제 고유 ID
- 문제 번호 또는 slug
- 문제 제목
- 문제 URL
- 난이도
- 알고리즘 태그
- 제출 언어
- 제출 코드
- 제출 결과
- 실행 시간
- 메모리 사용량
- 제출 시각

### 4.5 제출 결과 감지

지원 결과는 내부 표준 코드로 변환한다.

| 표준 코드 | 의미 |
|---|---|
| ACCEPTED | 정답 |
| WRONG_ANSWER | 오답 |
| TIME_LIMIT_EXCEEDED | 시간 초과 |
| MEMORY_LIMIT_EXCEEDED | 메모리 초과 |
| RUNTIME_ERROR | 런타임 오류 |
| COMPILE_ERROR | 컴파일 오류 |
| OUTPUT_FORMAT_ERROR | 출력 형식 오류 |
| PARTIAL_SCORE | 부분 점수 |
| UNKNOWN | 식별 불가 |

동적으로 표시되는 결과는 `MutationObserver`로 감지한다.

### 4.6 로컬 원본 저장

Extension은 로그인이나 서버 상태와 무관하게 수집 기록을 IndexedDB에 보존한다. 이 저장소는 Dashboard 가져오기 전후 모두 사용 가능한 로컬 원본이다.

- IndexedDB에 즉시 저장
- 불변 `clientRecordId`와 코드 해시로 로컬 중복 방지
- Dashboard에 제공한 상태와 성공 acknowledge 시각 저장
- 서버 가져오기 성공 후에도 기본적으로 로컬 기록 보존
- Source·Markdown·JSON·ZIP 로컬 내보내기 지원
- Extension은 Main API를 호출하거나 CodeArchive 인증 토큰을 저장하지 않음

### 4.7 확장 프로그램 상태 표시

팝업에 다음 상태를 표시한다.

- 현재 플랫폼 지원 여부
- 문제 페이지 감지 여부
- 코드 수집 성공 여부
- 제출 결과 감지 여부
- Dashboard로 가져오지 않은 기록 수
- 마지막 Dashboard 가져오기 확인 시각
- 어댑터 오류 여부

---

## 5. 사용자 및 인증 명세

### 5.1 인증 방식

- 이메일 또는 소셜 로그인
- Google OAuth
- GitHub OAuth
- Access Token + Refresh Token
- Spring Security
- JWT
- Refresh Token Rotation

### 5.2 외부 연동 인증

| 연동 | 방식 |
|---|---|
| GitHub | OAuth App 또는 GitHub App |
| Notion | OAuth 2.0 |
| AI Provider | 사용자 API Key 또는 서버 프록시 |
| Chrome Extension | 인증하지 않음. 로그인된 Web Dashboard가 로컬 수집 기록을 가져감 |

GitHub OAuth와 CodeArchive 사용자 세션은 Web Dashboard와 Main API 사이에서만 처리한다. Extension에는 OAuth UI, access/refresh token, GitHub token을 두지 않는다.

### 5.3 보안 요구사항

- 비밀번호는 BCrypt 또는 Argon2로 해시
- Refresh Token은 서버에서 해시 저장
- 외부 서비스 토큰은 암호화 저장
- API Key 전체 값을 UI에 다시 표시하지 않음
- 로그에 토큰·코드·개인정보를 출력하지 않음
- AI 전송 전 사용자 확인 옵션 제공
- 사용자 코드 외부 전송 기본값은 비활성화
- 계정 탈퇴 시 연동 토큰 폐기
- 데이터 다운로드 및 삭제 기능 제공

---

## 6. 문제 및 풀이 기록 명세

### 6.1 Problem

```text
Problem
- id
- platform
- platformProblemId
- problemNumber
- slug
- title
- url
- difficulty
- tags
- createdAt
- updatedAt
```

### 6.2 Solution

```text
Solution
- id
- userId
- problemId
- language
- finalCode
- status
- solvedAt
- firstAttemptAt
- attemptCount
- executionTime
- memoryUsage
- source
- createdAt
- updatedAt
```

### 6.3 Submission

```text
Submission
- id
- solutionId
- sequence
- result
- language
- code
- codeHash
- executionTime
- memoryUsage
- submittedAt
```

### 6.4 풀이 메모

- 최초 접근
- 최종 접근
- 핵심 알고리즘
- 시간 복잡도
- 공간 복잡도
- 막힌 지점
- 오답 원인
- 수정 내용
- 다음 풀이 시 주의사항
- 체감 난이도
- 복습 필요 여부
- 사용자 태그

### 6.5 중복 판별

다음 순서로 중복을 판정한다.

1. 사용자 ID + 플랫폼 + 플랫폼 문제 ID
2. 사용자 ID + 플랫폼 + 문제 번호
3. 정규화된 문제 URL
4. 문제 ID + 언어 + 풀이 시각
5. 코드 해시 + 제출 시각

같은 문제라도 언어, 풀이 일자, 복습 회차가 다르면 별도 풀이 세션으로 저장할 수 있다.

---

## 7. 파일 가져오기 및 내보내기

### 7.1 가져오기

지원 입력 형식:

- 코드 붙여넣기
- 단일 소스 파일
- 여러 소스 파일
- Markdown
- JSON
- ZIP
- GitHub 저장소 경로
- Notion 데이터베이스

### 7.2 언어 자동 감지

다음 정보를 조합하여 언어를 판별한다.

- 파일 확장자
- 코드 문법
- 클래스 또는 함수 선언
- import/include 구문
- 플랫폼 제출 언어 정보

### 7.3 파일명 생성

Java 파일은 다음 순서로 결정한다.

1. `public class` 이름
2. `class Solution`
3. `class Main`
4. 플랫폼 기본 파일명
5. 사용자 지정 템플릿

### 7.4 다운로드 형식

| 형식 | 구성 |
|---|---|
| Source | 코드 파일 1개 |
| Markdown | 문제 정보, 풀이, 코드 |
| JSON | 전체 메타데이터 |
| Package | 코드 + README + metadata.json |
| ZIP Backup | 선택한 전체 기록 |

### 7.5 파일 생성 기술

- 브라우저: Blob, File API, JSZip
- 서버: Spring Resource, ZipOutputStream
- 대용량 백업: 비동기 Worker
- 임시 파일: Object Storage
- 다운로드 링크: 만료형 Signed URL

---

## 8. GitHub 연동 명세

### 8.1 기능

- OAuth 인증
- 사용자 저장소 조회
- 브랜치 조회
- 경로 지정
- 코드 파일 업로드
- README 업로드
- metadata.json 업로드
- 기존 파일 수정
- 커밋 메시지 자동 생성
- 업로드 결과 URL 저장

### 8.2 기본 경로 템플릿

```text
{platform}/{difficulty}/{problemNumber}-{title}/{filename}
```

### 8.3 커밋 메시지 예시

```text
solve(swea): 1206 View
review(swea): 1206 View AI 없이 재풀이
fix(programmers): 42842 카펫 경계값 오류 수정
docs(leetcode): 1 Two Sum 풀이 설명 추가
```

### 8.4 업로드 안전장치

- 업로드 전 파일 미리보기
- 기존 파일 존재 여부 확인
- 덮어쓰기·새 파일 생성 선택
- 대상 브랜치 확인
- 공개할 AI 활용 정보 선택
- 동일 커밋 중복 생성 방지
- API 실패 시 재시도
- 부분 성공 시 성공·실패 파일 구분

---

## 9. Notion 연동 명세

### 9.1 기능

- Notion OAuth
- 워크스페이스 연결
- 데이터베이스 검색
- 속성 매핑
- 새 페이지 생성
- 기존 페이지 업데이트
- 코드 블록 생성
- 문제 링크와 GitHub 링크 삽입
- 생성된 Notion 페이지 URL 저장

### 9.2 기본 속성

- 문제명
- 플랫폼
- 문제 번호
- 난이도
- 언어
- 알고리즘
- 풀이 일자
- 정답 여부
- 복습 상태
- AI 활용 수준
- GitHub URL
- 원본 문제 URL

### 9.3 실패 처리

- 권한이 없는 데이터베이스 안내
- 삭제된 페이지 재연결
- 속성 타입 불일치 안내
- 재인증 요청
- API Rate Limit 재시도
- 실패 데이터 로컬 보존

---

## 10. AI 코드 리뷰 명세

### 10.1 입력

- 문제 메타데이터
- 제출 코드
- 제출 결과 이력
- 언어
- 사용자 풀이 설명
- 사용자가 선택한 리뷰 항목

### 10.2 출력

- 코드 동작 요약
- 잠재 오류
- 경계값 검토
- 시간 복잡도
- 공간 복잡도
- 가독성 개선
- 네이밍 개선
- 불필요한 코드
- 대체 알고리즘
- 복습 질문
- 추천 테스트 케이스

### 10.3 구조화 응답

```json
{
  "summary": "",
  "timeComplexity": "",
  "spaceComplexity": "",
  "issues": [],
  "improvements": [],
  "testCases": [],
  "reviewQuestions": []
}
```

### 10.4 구현 기술

- FastAPI
- Pydantic
- AI Provider SDK
- JSON Schema 기반 응답 검증
- 요청별 Timeout
- Exponential Backoff
- Token 사용량 저장
- 사용자별 요청 제한
- Redis 캐시
- 민감 정보 마스킹

### 10.5 오류 처리

- 구조화 응답 파싱 실패 시 1회 재요청
- 공급자 장애 시 오류 코드 표준화
- 사용량 초과 시 사용자 안내
- 모델 미지원 시 대체 모델 선택 안내
- AI 결과는 자동 적용하지 않고 사용자가 저장 여부 선택

---

## 11. 학습 통계 명세

### 11.1 기본 통계

- 일별·주별·월별 풀이 수
- 플랫폼별 풀이 수
- 언어별 풀이 수
- 알고리즘별 풀이 수
- 난이도별 정답률
- 평균 제출 횟수
- 평균 해결 시간
- 오답 유형 비율
- 복습 완료율
- 연속 학습 일수
- GitHub 업로드율
- Notion 정리율

### 11.2 강점 지표

다음 조건을 조합하여 강점 점수를 계산한다.

- 최근 풀이 빈도
- 정답률
- 첫 제출 정답률
- 평균 제출 횟수
- 해결 시간
- AI 도움 없이 해결한 비율
- 복습 후 재풀이 성공률
- 난이도 상승 추세

### 11.3 약점 지표

다음 조건을 조합하여 약점 점수를 계산한다.

- 낮은 정답률
- 높은 제출 횟수
- 반복되는 오답 유형
- AI 도움 비율
- 복습 미완료율
- 같은 태그에서 반복 실패
- 최근 학습 공백
- 시간 초과 또는 메모리 초과 비율

### 11.4 분석 기술

- SQL 집계 쿼리
- PostgreSQL Window Function
- Pandas
- NumPy
- FastAPI
- Redis 캐시
- Batch Job
- Chart.js 또는 Apache ECharts

### 11.5 통계 갱신 방식

- 문제 저장 직후 핵심 지표 증분 갱신
- 상세 통계는 비동기 작업
- 일별 집계 테이블 생성
- 통계 계산 버전 저장
- 계산 로직 변경 시 재집계 지원

---

## 12. 문제 추천 명세

### 12.1 추천 목적

- 취약 알고리즘 보완
- 복습 예정 문제 재추천
- 난이도 단계 상승
- 장기간 풀지 않은 유형 보완
- 특정 언어 연습
- AI 없이 재풀이할 문제 선정

### 12.2 추천 후보 데이터

- 서비스 내부 문제 메타데이터
- 사용자의 기존 풀이 기록
- 플랫폼별 공개 문제 목록
- 난이도
- 알고리즘 태그
- 최근 풀이 일자
- 유사 문제 해결 여부

### 12.3 1차 추천 방식

초기 버전은 규칙 기반 점수 방식으로 구현한다.

```text
recommendationScore =
  weaknessScore
  + reviewUrgency
  + inactivityScore
  + difficultyFit
  + diversityScore
  - recentlySolvedPenalty
```

### 12.4 추천 결과

- 추천 문제
- 추천 이유
- 대상 알고리즘
- 권장 난이도
- 이전 관련 풀이
- 복습 또는 신규 문제 구분
- 원본 플랫폼 링크

### 12.5 추천 제외 조건

- 최근 일정 기간 내 해결한 문제
- 사용자가 숨김 처리한 문제
- 지원하지 않는 언어만 제공하는 문제
- 접근할 수 없는 비공개 문제
- 문제 정보가 불완전한 항목

---

## 13. Web Dashboard 명세

### 13.1 기술

- React
- TypeScript
- React Router
- Zustand
- TanStack Query
- Tailwind CSS
- ECharts
- Vitest
- Playwright

### 13.2 주요 화면

- 로그인
- 대시보드
- 전체 문제 목록
- 문제 상세
- 제출 이력
- 코드 비교
- 통계
- 강점·약점 분석
- 추천 문제
- 복습 목록
- GitHub 연동
- Notion 연동
- AI 설정
- 데이터 가져오기
- 데이터 내보내기
- 피드백 등록
- 서비스 상태
- Extension 연결 및 로컬 기록 가져오기
- 가져오기 미리보기·선택·부분 실패 재시도

### 13.3 Extension 기록 가져오기

- 로그인된 사용자만 서버 가져오기를 실행할 수 있다.
- Dashboard는 허용된 외부 메시지 계약으로 설치된 Extension에서 cursor 기반 페이지를 읽는다.
- API 저장 결과 중 성공·동일 사용자 중복 항목만 Extension에 acknowledge한다.
- Extension 미설치 또는 브리지 장애 시 JSON 가져오기를 대체 경로로 제공한다.
- Dashboard는 가져오기 대상 계정, 기록 수, 중복·실패 결과를 명확히 표시한다.

### 13.4 문제 목록 필터

- 플랫폼
- 난이도
- 언어
- 알고리즘 태그
- 정답 여부
- 풀이 날짜
- 복습 상태
- GitHub 업로드 여부
- Notion 업로드 여부
- AI 리뷰 여부

---

## 14. Main API 명세

### 14.1 기술

- Java 21
- Spring Boot 3
- Spring Web
- Spring Security
- Spring Data JPA
- QueryDSL
- Flyway
- PostgreSQL
- Redis
- OpenAPI/Swagger
- JUnit 5
- Mockito
- Testcontainers

### 14.2 주요 API

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh

GET    /api/v1/problems
GET    /api/v1/problems/{id}
POST   /api/v1/problems

POST   /api/v1/solutions
POST   /api/v1/solutions/import
GET    /api/v1/solutions/{id}
PATCH  /api/v1/solutions/{id}
DELETE /api/v1/solutions/{id}

POST   /api/v1/solutions/{id}/submissions
GET    /api/v1/solutions/{id}/submissions

POST   /api/v1/exports
GET    /api/v1/exports/{id}

POST   /api/v1/integrations/github/connect
POST   /api/v1/integrations/github/upload
POST   /api/v1/integrations/notion/connect
POST   /api/v1/integrations/notion/pages

POST   /api/v1/reviews
GET    /api/v1/reviews/{id}

GET    /api/v1/statistics/summary
GET    /api/v1/statistics/weaknesses
GET    /api/v1/recommendations

POST   /api/v1/feedback
GET    /api/v1/service-status
```

### 14.3 API 공통 응답

```json
{
  "success": true,
  "data": {},
  "error": null,
  "requestId": "uuid"
}
```

### 14.4 API 오류 코드

- AUTH_REQUIRED
- ACCESS_DENIED
- INVALID_REQUEST
- DUPLICATE_SOLUTION
- PLATFORM_NOT_SUPPORTED
- CAPTURE_DATA_INVALID
- EXTERNAL_API_ERROR
- RATE_LIMITED
- AI_RESPONSE_INVALID
- EXPORT_FAILED
- INTERNAL_ERROR

---

## 15. 데이터베이스 명세

### 15.1 주요 테이블

- users
- external_accounts
- problems
- problem_tags
- solutions
- submissions
- solution_notes
- ai_reviews
- review_jobs
- statistics_daily
- weakness_profiles
- recommendations
- review_schedules
- github_uploads
- notion_pages
- export_jobs
- feedback
- feedback_attachments
- release_versions
- adapter_health_logs
- audit_logs

### 15.2 인덱스

- `problems(platform, platform_problem_id)` unique
- `solutions(user_id, solved_at desc)`
- `solutions(user_id, problem_id)`
- `submissions(solution_id, sequence)`
- `problem_tags(problem_id, tag)`
- `feedback(status, created_at)`
- `adapter_health_logs(platform, checked_at desc)`
- `recommendations(user_id, generated_at desc)`

### 15.3 마이그레이션

- Flyway 사용
- 운영 DB 수동 수정 금지
- 마이그레이션 파일 버전 관리
- 하위 호환 가능한 변경 우선
- 컬럼 삭제는 2단계 배포
- 롤백 SQL 또는 복구 절차 문서화

---

## 16. 비동기 작업 명세

### 16.1 비동기 대상

- AI 코드 리뷰
- 대량 ZIP 생성
- GitHub 다중 파일 업로드
- Notion 대량 페이지 생성
- 통계 재집계
- 추천 결과 생성
- 사용자 전체 데이터 내보내기
- 오래된 임시 파일 정리

### 16.2 작업 상태

- PENDING
- RUNNING
- SUCCEEDED
- FAILED
- RETRYING
- CANCELLED

### 16.3 재시도 정책

- 네트워크 오류: 최대 3회
- Rate Limit: 응답 헤더 기준 지연
- 인증 오류: 재시도하지 않음
- 데이터 검증 오류: 재시도하지 않음
- 지수 백오프 적용
- 최종 실패 시 사용자 알림

---

## 17. 테스트 명세

### 17.1 테스트 종류

| 종류 | 대상 |
|---|---|
| Unit Test | 파서, 서비스, 점수 계산, 파일명 생성 |
| Integration Test | DB, Redis, 외부 API Adapter |
| Contract Test | Extension ↔ Dashboard, Dashboard ↔ Main API, Main API ↔ Analysis API |
| E2E Test | 자동 수집 → Dashboard 사용자 승인 가져오기 → 사용자별 서버 저장 |
| Regression Test | 기존 플랫폼 선택자와 핵심 기능 |
| Security Test | 인증, 권한, 토큰 노출 |
| Performance Test | 대량 기록 조회, 통계 집계, ZIP 생성 |

### 17.2 플랫폼 어댑터 테스트

각 플랫폼별로 HTML Fixture를 저장하여 DOM이 변경되지 않은 상태에서 파싱 결과를 검증한다.

테스트 항목:

- 문제 번호 추출
- 제목 추출
- 난이도 추출
- 코드 추출
- 언어 추출
- 제출 결과 추출
- 선택자 누락 시 오류 처리
- 지원하지 않는 페이지 처리

### 17.3 테스트 도구

- Vitest
- Playwright
- JUnit 5
- Mockito
- Testcontainers
- Pytest
- HTTPX
- Newman 또는 Bruno
- k6

### 17.4 배포 차단 기준

다음 조건 중 하나라도 발생하면 운영 배포를 차단한다.

- 핵심 E2E 테스트 실패
- 플랫폼 어댑터 회귀 테스트 실패
- DB 마이그레이션 검증 실패
- 보안 취약점 Critical 발생
- API Contract Test 실패
- 코드 커버리지 기준 미달
- 빌드 산출물 생성 실패

---

## 18. CI/CD 및 배포 명세

### 18.1 저장소 구성

Monorepo 예시:

```text
codearchive/
├── apps/
│   ├── extension/
│   ├── web/
│   ├── api/
│   └── analysis/
├── packages/
│   ├── shared-types/
│   ├── eslint-config/
│   └── api-client/
├── infra/
├── docs/
└── .github/workflows/
```

### 18.2 브랜치 전략

- `master`: 운영 배포
- `develop`: 통합 개발
- `feature/*`: 기능 개발
- `fix/*`: 버그 수정
- `hotfix/*`: 긴급 수정
- `release/*`: 배포 준비

기능·수정 브랜치는 Pull Request를 통해 `develop`에 통합한다. 배포 후보는 `develop`에서 `master`로 향하는 release Pull Request만 허용하며, 승인된 병합 후 `master`의 정확한 commit을 수동 배포한다. `master` 병합과 외부 배포는 각각 별도의 즉시 승인 단계로 관리한다.

### 18.3 Pull Request 검사

- Lint
- Format
- Type Check
- Unit Test
- Integration Test
- Build
- Dependency Scan
- Secret Scan
- Docker Image Build
- API Schema 변경 검사

### 18.4 배포 환경

| 환경 | 용도 |
|---|---|
| Local | 개인 개발 |
| Dev | 기능 통합 |
| Staging | 운영과 유사한 검증 |
| Production | 실제 사용자 |

### 18.5 배포 방식

- Web: Vercel, Netlify 또는 CloudFront
- API: Docker 기반 Cloud Run, ECS 또는 Render
- Analysis: Docker 기반 별도 서비스
- DB: Managed PostgreSQL
- Redis: Managed Redis
- File: S3 호환 Storage
- Extension: Chrome Web Store

### 18.6 배포 절차

```text
PR 병합
→ 자동 테스트
→ Dev 자동 배포
→ Staging 배포
→ 회귀 테스트
→ 릴리스 노트 작성
→ 운영 승인
→ Production 배포
→ Smoke Test
→ 모니터링 확인
```

---

## 19. 유지보수 및 운영 명세

### 19.1 유지보수 범위

- 사용자 피드백 처리
- 오류 수정
- 플랫폼 DOM 변경 대응
- 외부 API 변경 대응
- 브라우저 정책 변경 대응
- 의존성 업데이트
- 보안 패치
- DB 마이그레이션
- 성능 개선
- 기능 개선
- Chrome Web Store 재배포
- 운영 장애 대응
- 문서 업데이트

### 19.2 사용자 피드백 접수

서비스 내 피드백 화면에서 다음 유형을 접수한다.

- 자동 수집 실패
- 잘못된 문제 정보
- 코드 누락
- 제출 결과 오인식
- GitHub 업로드 실패
- Notion 업로드 실패
- AI 리뷰 오류
- 통계 오류
- 추천 부정확
- 기능 요청
- UI·사용성 개선
- 보안 또는 개인정보 문의

### 19.3 피드백 데이터

```text
Feedback
- id
- userId
- category
- title
- description
- platform
- extensionVersion
- browserVersion
- operatingSystem
- currentUrl
- requestId
- logReference
- attachmentUrl
- status
- priority
- createdAt
- resolvedAt
```

민감 정보와 전체 코드는 사용자의 명시적 동의 없이 첨부하지 않는다.

### 19.4 피드백 상태

- RECEIVED
- TRIAGED
- NEEDS_INFORMATION
- PLANNED
- IN_PROGRESS
- FIXED
- RELEASED
- REJECTED
- DUPLICATE

### 19.5 우선순위 기준

| 우선순위 | 기준 | 처리 방식 |
|---|---|---|
| P0 | 보안 사고, 데이터 손실, 전체 서비스 장애 | 즉시 핫픽스 |
| P1 | 핵심 자동 수집 또는 로그인 불가 | 가장 빠른 수정 배포 |
| P2 | 일부 플랫폼·기능 오류 | 다음 패치 배포 |
| P3 | UI 오류, 편의성 개선 | 정기 배포 |
| P4 | 신규 기능 제안 | 로드맵 검토 |

### 19.6 오류 재현 정보

오류 신고 시 자동 수집 가능한 정보:

- 확장 프로그램 버전
- 웹 앱 버전
- API 버전
- 브라우저 버전
- 운영체제
- 플랫폼 코드
- 현재 페이지 유형
- 어댑터 버전
- 오류 코드
- 요청 ID
- 발생 시각

수집 금지 정보:

- 플랫폼 비밀번호
- 세션 쿠키
- 전체 API Key
- 전체 OAuth Token
- 사용자가 동의하지 않은 전체 코드

### 19.7 수정 절차

```text
피드백 접수
→ 중복 여부 확인
→ 우선순위 분류
→ 재현
→ 원인 분석
→ 테스트 케이스 추가
→ 코드 수정
→ 회귀 테스트
→ Staging 검증
→ 릴리스 노트 작성
→ 재배포
→ 사용자 확인
→ 이슈 종료
```

버그 수정은 반드시 실패를 재현하는 테스트를 먼저 추가한 후 진행한다.

### 19.8 플랫폼 DOM 변경 대응

플랫폼별 DOM 변경은 가장 빈번한 유지보수 항목으로 관리한다.

구현 항목:

- 선택자를 설정 파일로 분리
- 어댑터별 버전 관리
- `validateSelectors()` 상태 검사
- 자동 주기 점검
- 수집 성공률 모니터링
- 특정 플랫폼 기능 원격 비활성화
- 수동 입력 대체 경로 제공
- HTML Fixture 업데이트
- 회귀 테스트 후 배포

### 19.9 원격 기능 제어

확장 프로그램 전체 재배포 없이 일부 기능을 제어할 수 있도록 Feature Flag를 사용한다.

제어 대상:

- 플랫폼별 자동 수집 활성화
- 특정 선택자 버전
- AI 리뷰 제공자
- 신규 통계 화면
- 추천 기능
- 실험 기능
- 장애 기능 임시 비활성화

보안상 중요한 코드와 권한 변경은 반드시 확장 프로그램 재배포로 처리한다.

### 19.10 버전 정책

Semantic Versioning을 적용한다.

- Major: 호환되지 않는 구조 변경
- Minor: 하위 호환 신규 기능
- Patch: 버그 수정 및 선택자 수정

예시:

```text
2.1.0  GitHub 직접 업로드 추가
2.1.1  SWEA 제출 결과 감지 수정
3.0.0  데이터 스키마 비호환 변경
```

### 19.11 릴리스 노트

릴리스마다 다음 내용을 기록한다.

- 버전
- 배포 일자
- 신규 기능
- 수정된 오류
- 지원 플랫폼 변경
- DB 마이그레이션
- 사용자 조치 필요 여부
- 알려진 문제
- 롤백 방법

### 19.12 Chrome Web Store 재배포

확장 프로그램 변경 시 다음 절차를 수행한다.

1. 버전 증가
2. 권한 변경 여부 검토
3. 개인정보처리방침 확인
4. Production 빌드
5. 확장 프로그램 E2E 테스트
6. ZIP 패키지 생성
7. Chrome Web Store 업로드
8. 변경 사항 제출
9. 심사 상태 확인
10. 승인 후 점진적 배포
11. 오류율 확인
12. 문제 발생 시 이전 버전 또는 긴급 패치 준비

스토어 심사 시간이 발생할 수 있으므로 서버 측 Feature Flag와 수동 입력 기능을 장애 완화 수단으로 유지한다.

### 19.13 웹·서버 재배포

- 무중단 배포 우선
- Health Check 필수
- 신규 인스턴스 준비 후 트래픽 전환
- DB 마이그레이션 선행 검증
- 배포 직후 Smoke Test
- 오류율 상승 시 자동 중단
- 이전 Docker Image 보존
- 즉시 롤백 명령 준비

### 19.14 롤백 기준

다음 조건 발생 시 롤백한다.

- 로그인 실패율 급증
- 저장 실패율 급증
- 데이터 손상 가능성
- 외부 연동 실패율 급증
- API 5xx 오류율 임계치 초과
- 핵심 플랫폼 자동 수집 실패
- 보안 취약점 확인

### 19.15 의존성 유지보수

- Dependabot 또는 Renovate 사용
- 주간 의존성 업데이트 확인
- Critical 보안 패치는 즉시 적용
- Major 업데이트는 별도 브랜치에서 검증
- Lock File 커밋
- 미사용 의존성 제거
- 라이선스 검토

### 19.16 데이터 유지보수

- 일일 자동 백업
- 백업 복구 훈련
- Object Storage 수명 주기 설정
- 삭제 요청 처리
- 오래된 임시 파일 제거
- 통계 집계 데이터 재생성 기능
- 무결성 검사 작업
- 데이터 스키마 버전 저장

---

## 20. 모니터링 및 장애 대응

### 20.1 관측 항목

- API 요청 수
- API 응답 시간
- 4xx·5xx 비율
- 로그인 성공률
- 자동 수집 성공률
- 플랫폼별 파싱 실패율
- Dashboard 가져오기·서버 저장 실패 수
- GitHub API 실패율
- Notion API 실패율
- AI 요청 실패율
- Worker 대기열 길이
- DB 연결 수
- Redis 상태
- 배포 버전별 오류율

### 20.2 도구

- Sentry
- Spring Boot Actuator
- Micrometer
- Prometheus
- Grafana
- OpenTelemetry
- Loki 또는 ELK
- Uptime Robot 또는 Better Stack

### 20.3 로그 정책

모든 요청 로그에 `requestId`를 포함한다.

로그에 포함하지 않는 항목:

- 전체 코드
- Access Token
- Refresh Token
- API Key
- 쿠키
- 비밀번호
- 개인정보 원문

### 20.4 장애 대응 문서

운영 Runbook에 다음 내용을 작성한다.

- API 장애
- DB 장애
- Redis 장애
- Object Storage 장애
- GitHub API 장애
- Notion API 장애
- AI Provider 장애
- 특정 플랫폼 DOM 변경
- Chrome Extension 배포 오류
- 데이터 복구 절차

---

## 21. 성능 요구사항

### 21.1 목표

- 일반 목록 API: P95 500ms 이하
- 상세 조회 API: P95 700ms 이하
- 확장 프로그램 자동 수집: 제출 결과 표시 후 2초 이내 로컬 저장 시도
- 대시보드 초기 로딩: 3초 이내
- 통계 요약: 캐시 사용 시 1초 이내
- ZIP 생성: 비동기 처리
- 추천 생성: 10초 초과 시 비동기 처리

### 21.2 최적화

- 목록 Cursor Pagination
- 필요한 컬럼만 Projection
- 통계 사전 집계
- Redis 캐시
- 외부 API 호출 비동기화
- 코드 본문 지연 로딩
- 대용량 파일 Object Storage 분리
- N+1 쿼리 방지

---

## 22. 개인정보 및 저작권 요구사항

### 22.1 저장 대상

- 문제 제목
- 문제 번호
- 난이도
- 문제 URL
- 사용자가 작성한 코드
- 사용자가 작성한 풀이
- 제출 결과
- 학습 통계
- 외부 업로드 링크

### 22.2 기본 미저장 대상

- 문제 원문 전체
- 공식 해설
- 비공개 테스트 케이스
- 플랫폼 로그인 정보
- 플랫폼 세션 쿠키
- 사용자가 동의하지 않은 AI 대화 원문

### 22.3 사용자 권리

- 데이터 조회
- 데이터 수정
- 데이터 다운로드
- 특정 기록 삭제
- 전체 계정 삭제
- 외부 연동 해제
- AI 전송 동의 철회

---

## 23. 단계별 구현 계획

### 23.0 현재 구현 우선순위

초기 기반 구성 이후에는 API와 외부 연동보다 사용자가 직접 확인할 수 있는 로컬 프로토타입 완성을 우선한다.

현재 실행 순서:

1. React 기반 Chrome Extension 기본 실행
2. 수동 풀이 등록
3. Chrome Storage 또는 IndexedDB 로컬 저장
4. 팝업에서 저장 기록 조회
5. Source·Markdown·JSON 내보내기
6. SWEA 문제 페이지 감지 및 문제 정보 수집
7. 제출 코드와 결과 감지
8. 자동 수집 기록을 로컬 저장소에 통합
9. Web Dashboard 로그인·관리 프로토타입
10. Extension → Dashboard 기록 가져오기
11. Dashboard → Main API·PostgreSQL 동기화 및 외부 서비스 연동
12. AI 리뷰·통계·추천

프로토타입 단계에서는 서버 연결 실패나 서버 미실행 상태에서도 핵심 기록·조회·내보내기 기능이 동작해야 한다. API, 데이터베이스, 인증은 로컬 사용자 흐름이 검증된 이후 연결한다.

### Phase 1. 공통 모델 및 개발 환경

- Monorepo 구성
- TypeScript 공통 타입
- Spring Boot 프로젝트
- FastAPI 프로젝트
- PostgreSQL·Redis Docker Compose
- CI 기본 파이프라인
- OpenAPI 문서
- 공통 오류 코드

완료 기준:

- 모든 서비스 로컬 실행
- Health Check 성공
- 공통 모델 빌드
- 기본 테스트 통과

### Phase 2. React 기반 로컬 프로토타입

- Chrome Extension React 팝업 실행
- 문제 직접 등록
- 코드 붙여넣기
- 파일 가져오기
- 문제 목록·상세
- Source·Markdown·JSON 다운로드
- Chrome Storage 또는 IndexedDB 저장
- 최근 저장 기록 팝업 조회

완료 기준:

- API 서버 없이 하나의 풀이를 등록·조회하고 Source·Markdown·JSON 파일로 다운로드 가능

### Phase 3. SWEA Chrome Extension

- 페이지 감지
- 문제 정보 수집
- 코드 수집
- 제출 결과 감지
- 로컬 원본 저장
- 어댑터 테스트

완료 기준:

- SWEA 정답 제출 후 기록이 자동 저장됨

### Phase 4. 프로그래머스 및 공통 어댑터

- 프로그래머스 지원
- 어댑터 인터페이스 정리
- 다국어 코드 처리
- 플랫폼별 Fixture 테스트
- 원격 기능 제어

완료 기준:

- 두 플랫폼에서 동일한 내부 데이터 모델로 저장됨

### Phase 5. Dashboard 인증 및 서버 저장

- Web Dashboard 사용자 인증
- Extension 기록 가져오기 UI
- Extension ↔ Dashboard paginated read/ack bridge contract 및 구현
- Solution·Submission API
- DB 마이그레이션
- Dashboard import 중복·부분 실패 처리
- 데이터 백업

완료 기준:

- Extension이 로그인 없이 계속 수집하고, 로그인된 Dashboard가 기록을 가져온 뒤 여러 웹 브라우저 세션에서 동일 기록을 조회할 수 있음

### Phase 6. GitHub·Notion 연동

- GitHub OAuth
- 저장소·브랜치 선택
- 코드·README 업로드
- Notion OAuth
- 데이터베이스 매핑
- 페이지 생성
- 실패 재시도

완료 기준:

- 문제 상세 화면에서 두 외부 서비스로 직접 업로드 가능

### Phase 7. AI 코드 리뷰

- 사용자 API Key 관리
- FastAPI Review Endpoint
- 구조화 출력
- Worker
- 결과 저장
- 사용량 제한
- 오류 처리

완료 기준:

- 저장된 코드에 대해 리뷰를 요청하고 구조화된 결과를 확인 가능

### Phase 8. 통계·강점·약점

- 일별 통계
- 알고리즘별 정답률
- 오답 유형 통계
- 강점·약점 점수
- 대시보드 차트
- 통계 재집계

완료 기준:

- 최소 20개 기록으로 사용자별 분석 결과 생성 가능

### Phase 9. 문제 추천

- 추천 후보 수집
- 규칙 기반 점수
- 추천 이유 생성
- 복습 추천
- 추천 숨김
- 추천 결과 평가

완료 기준:

- 약점과 최근 풀이를 근거로 중복되지 않는 문제 추천 가능

### Phase 10. 유지보수 체계

- 서비스 내 피드백
- Sentry 연동
- 플랫폼 수집 성공률
- Feature Flag
- Release Version 저장
- Chrome Web Store 배포 문서
- Runbook
- 자동 백업·복구 테스트

완료 기준:

- 오류 접수부터 수정·테스트·재배포·종료까지 이슈 1건을 전체 절차로 처리

---

## 24. MVP 범위

### 24.1 포함

- SWEA, 프로그래머스
- Chrome Extension 자동 수집
- Web Dashboard GitHub 로그인 및 Extension 기록 가져오기
- 수동 기록
- 문제 목록·상세
- Source·Markdown·JSON 다운로드
- GitHub 업로드
- Notion 페이지 생성
- AI 코드 리뷰
- 기본 통계
- 규칙 기반 약점 분석
- 복습 문제 추천
- 피드백 등록
- 오류 추적
- CI/CD
- Staging·Production 배포

### 24.2 MVP 이후

- 정올, LeetCode, 백준
- 대량 가져오기
- 다중 AI 제공자
- 고급 추천 모델
- 팀 스터디
- 모바일 앱
- 공개 프로필
- 브라우저 추가 지원

---

## 25. 완료 정의

기능은 다음 조건을 모두 만족해야 완료로 처리한다.

- 요구사항 구현
- 타입 검사 통과
- 단위 테스트 작성
- 통합 테스트 통과
- API 문서 반영
- 오류 처리 구현
- 로깅 및 모니터링 추가
- 보안 검토
- 사용자 문서 수정
- Staging 검증
- 릴리스 노트 작성
- 운영 배포 후 Smoke Test 통과

---

## 26. 프로젝트 산출물

- 개발 명세서
- ERD
- API 명세서
- Chrome Extension 어댑터 명세
- 화면 설계서
- 테스트 계획서
- 배포 구성도
- 운영 Runbook
- 개인정보 처리 문서
- 릴리스 노트
- 사용자 가이드
- 장애 보고서 템플릿
- 피드백 처리 이력
