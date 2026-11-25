# 백준(acmicpc.net) 지원

백준 온라인 저지(BOJ)를 네 번째 플랫폼 `BAEKJOON`으로 지원한다. 정답 자동 수집, 과거 풀이 수집, 채점 현황의 행별 동기화·커밋, 로그인 상태 카드, solved.ac 난이도를 포함한다.

## 사이트에서 확인한 사실 (2026-11-23)

- 사이트는 `https://acmicpc.net`으로 서비스하며 `www.acmicpc.net`은 그쪽으로 이동한다. 두 origin을 모두 받는다.
- 페이지 안 스크립트의 `fetch`/XHR 요청에는 `200`과 빈 본문(`content-length: 0`)을 돌려준다. 그래서 `/source/download/{id}`나 문제 페이지를 백그라운드 요청으로 읽을 수 없고, 모든 읽기는 실제 페이지 로드에서 한다. 서버의 차단 조건은 조사하지 않았다.
- 2026-11-20 시행 이용약관(운영사 데이원컴퍼니)은 사전 허용 범위를 벗어난 자동화 도구의 **과도한** 부하(제11조 2항)와 과도한 자동화 접근(제23조)을 금지한다. `robots.txt`는 `/status`, `/source`, `/submit`을 막는다. 과거 수집은 사용자가 직접 시작하는 본인 제출만 대상으로 하며, 페이지를 간격을 두고 하나씩 연다.
- 제출 폼: `#submit_form`(POST), `legend`(문제 제목), `input[name=problem_id]`, `select#language`(chosen), CodeMirror 5가 덮은 `textarea#source`, `button#submit_button`. 제출하면 `/status?problem_id=&user_id={id}&language_id=-1&result_id=-1&from_mine=1`로 이동한다.
- 채점 현황 행: `tr#solution-{id}`, 아이디 `a[href="/user/{id}"]`, 문제 `a.problem_title[data-original-title]`, 결과 `td.result span.result-text[data-color]`, `td.memory`(KB), `td.time`(ms), 언어 칸(본인 행은 `a[href="/source/{id}"]`), 코드 길이(바이트), 제출 시각 `[data-timestamp]`(Unix 초). `채점 서버` 열이 새로 생겨 열 위치가 아니라 한국어 머리글로 칸을 찾는다.
- 결과는 Pusher로 같은 행이 바뀐다(`status.js`의 `display_solution`). 결과 코드 4가 정답이며 색은 `ac`, 문구는 `맞았습니다!!`. 서브태스크 문제는 `100점`, 부분 점수는 다른 색이다.
- 본인 `/source/{id}` 페이지: 읽기 전용 `textarea.codemirror-textarea[name=source]`와 한 줄짜리 제출 표(문제 제목 포함).
- 로그인 상태는 상단 `.loginbar a.username`(`/user/{id}`)으로 알 수 있다.

## 정답 자동 수집

1. `/submit/{n}`에서 `#submit_button`을 누르면 MAIN world가 CodeMirror 내용을 `textarea#source`에 옮기고(`editor-sync` 표시), isolated 스크립트가 문제·제목·언어·코드·로그인 아이디·클릭 시각을 그 탭의 `sessionStorage`에 기록한다.
2. 이동한 `/status`에서 기록을 이어받아, 본인 행 중 문제·언어·UTF-8 코드 길이(앞뒤 공백 제거본 포함)가 같고 서버 제출 시각이 클릭 ±2분 안인 행을 찾는다. 이런 행이 둘 이상이면(예: 두 탭 동시 제출) 어느 제출인지 알 수 없어 저장하지 않고 채점 현황의 동기화에 맡긴다. 이 탭에서 오답으로 끝난 행은 후보에서 뺀다.
3. 그 행이 `맞았습니다!!`가 되면 저장하고, `solvedAt`은 서버 제출 시각을 쓴다. 오답·컴파일 에러면 기록을 지우고, 15분이 지나면 버린다. 이미 저장한 제출 번호는 다시 저장하지 않는다.
4. 라이브 수집은 다른 플랫폼처럼 사이트 제출 번호를 싣지 않는다. 채점 현황·과거 수집은 같은 문제·언어·제출 시각(2분 안)으로 이미 있는 라이브 풀이를 찾는다.

## 과거 풀이 수집 (서비스 워커)

- 확장이 연 비활성 탭 하나에서 `/`(로그인 아이디 확인) → `/status?user_id={id}&result_id=4`(20건씩, `#next_page`의 `top`) → 선택한 각 `/source/{id}` 순서로 연다. 목록은 3초, 소스는 3~5초 간격이다. 최대 250페이지(5,000건).
- 각 페이지는 정확히 요청한 주소로 로드가 끝난 뒤에만 읽는다. 로그인 페이지 등으로 이동하면 그 항목은 실패로 남는다. 사용자가 그 탭을 닫으면 수집을 멈추고 다시 열지 않는다.
- 소스 페이지는 목록 행과 제출 번호·아이디·문제·언어·제출 시각·코드 길이가 모두 같고 정답일 때만 받는다. 등록은 다른 플랫폼과 같은 서버 수집 실행(`SERVER_HISTORY_RUN`)으로 한다.
- 채점 현황의 `동기화`는 누를 때마다 그 제출의 소스 페이지를 비활성 탭에서 한 번 열고 닫는다.

## 난이도·로그인

- solved.ac `GET /api/v3/problem/show?problemId={n}`의 `level` 1–30 → Bronze V–Ruby I. 문제 번호만 보내고 쿠키를 보내지 않으며 6시간 캐시한다. 실패하면 비워 둔다. 서버(`ProblemDifficulty`)도 같은 출처만 받는다.
- 백준은 로그인 확인 요청을 보내지 않는다. 백준 페이지를 열 때 보인 로그인 아이디(또는 로그아웃)를 기록해 대시보드 카드에 보여 주고, 7일이 지나면 미확인으로 돌린다.

## 제한과 실제 확인 항목

- 한국어 화면 기준이다. 영어 화면은 머리글이 달라 읽지 않는다(수집 안 됨).
- 실제 확인한 것: 공개 채점 현황 행 구조, 로그인 상태의 제출 폼·본인 행·`/source` 페이지 구조(컴파일 에러 제출로 확인). 아직 확인하지 않은 것: 실제 정답 제출의 라이브 수집 전 과정, 과거 수집·행별 동기화의 실제 실행, solved.ac 응답의 확장 내 호출. 정답 제출 1건으로 [#456](https://github.com/devkimhongjin/codeArchive/issues/456) 방식의 실제 검증이 필요하다.
- 사용자의 컴퓨터 시계가 백준 서버와 2분 넘게 다르면 라이브 수집이 되지 않는다. 그때는 채점 현황의 `동기화`로 등록한다.
