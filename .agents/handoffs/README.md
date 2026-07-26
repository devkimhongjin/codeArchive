# 에이전트 핸드오프

이 디렉터리는 역할 간 작업 인계 문서를 보관한다.

## 파일 이름

작업별 파일 이름은 `TASK-####-<from>-to-<to>.md` 형식을 사용한다.

예시:

- `TASK-0001-planning-to-implementation.md`
- `TASK-0001-implementation-to-verification.md`
- `TASK-0001-verification-to-records.md`
- `TASK-0001-records-to-planning.md`

## 운영 규칙

1. 인계 문서는 기존 내용을 덮어쓰지 않고 단계별로 새 파일을 만든다.
2. 모든 인계에는 작업 ID, 작성 역할, 작성 시각, 입력 기준 문서와 변경 파일을 기록한다.
3. 검증 결과는 `PASS`, `FAIL`, `BLOCKED` 중 하나로 명시한다.
4. 비밀 값, API Key, 토큰, 사용자 코드 원문과 개인정보를 기록하지 않는다.
5. 작업을 종료할 때 기획 에이전트가 핸드오프 링크를 `project.md`에 연결한다.

