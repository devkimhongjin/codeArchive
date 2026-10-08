# 실행 없는 로컬 정적 분석

확장 대시보드의 전체 풀이 → 코드 상세 → **기본 정적 검사**에서 실행합니다. 원본을 브라우저 worker 안에서 파싱하며 제출 코드는 실행하지 않고 서버로 전송하지 않습니다.

지원 범위는 Java, JavaScript/TypeScript, Python의 문법 검사와 기본 규칙입니다. 빈 catch, JavaScript의 var·느슨한 동등 비교·debugger·eval, Python의 유형 없는 except를 확인합니다. Checkstyle/PMD/ESLint/Ruff 전체 규칙이나 컴파일·실행 결과를 제공하는 기능은 아닙니다. 파서가 지원하지 않는 최신 문법은 문법 확인 필요로 표시될 수 있습니다.

- 입력 최대 262,144자, 파싱 후 순회 최대 100,000개 노드, 진단 최대 200개, worker 최대 5초입니다. 시간 초과·사용자 중단·풀이 선택 변경 시 worker를 종료합니다.
- 언어·코드·파서/규칙 버전의 SHA-256을 키로 결과만 캐시합니다. 원본 코드와 파서의 원문 포함 오류 메시지는 캐시에 저장하지 않습니다. **분석 캐시 지우기**로 삭제할 수 있습니다.
- 외부 스크립트 다운로드, AI 제공자/API, 사용자 파일 접근은 없습니다.
- 파서는 번들에 포함됩니다: [Babel parser](https://babeljs.io/docs/babel-parser), [java-parser](https://github.com/jhipster/prettier-java/tree/main/packages/java-parser), [Lezer Python](https://code.haverbeke.berlin/lezer/python).

관련 이슈 #250. #251 AI 분석은 사용자 요청으로 제외했습니다.
