import type { Solution } from './types'

/** Deliberately isolated fixture data. It is only shown while the dashboard is in demo mode. */
export const demoSolutions: Solution[] = [
  {
    captureId: 'demo-swea-1208',
    platform: 'SWEA',
    problemNumber: '1208',
    title: 'Flatten',
    problemUrl: 'https://swexpertacademy.com/main/code/problem/problemDetail.do?problemLevel=1&contestProbId=AV139geKAA4CFAYh',
    language: 'Python',
    result: 'ACCEPTED',
    observedAt: '2026-09-14T13:22:00+09:00',
    solvedAt: '2026-09-14T13:24:18+09:00',
    executionTime: 124,
    memoryUsage: 38.2,
    sourceCode: `def solve():
    for _ in range(10):
        n = int(input())
        boxes = list(map(int, input().split()))

        for _ in range(n):
            boxes[boxes.index(max(boxes))] -= 1
            boxes[boxes.index(min(boxes))] += 1

        print(f"#{_ + 1} {max(boxes) - min(boxes)}")

if __name__ == "__main__":
    solve()`,
  },
  {
    captureId: 'demo-programmers-42586',
    platform: 'PROGRAMMERS',
    problemNumber: '42586',
    title: '기능개발',
    problemUrl: 'https://school.programmers.co.kr/learn/courses/30/lessons/42586',
    language: 'JavaScript',
    result: 'ACCEPTED',
    observedAt: '2026-09-13T21:05:00+09:00',
    solvedAt: '2026-09-13T21:09:42+09:00',
    executionTime: 0.31,
    memoryUsage: 38.8,
    sourceCode: `function solution(progresses, speeds) {
  const days = progresses.map((progress, index) =>
    Math.ceil((100 - progress) / speeds[index])
  );
  const releases = [];
  let cursor = 0;

  while (cursor < days.length) {
    const deployDay = days[cursor];
    let count = 0;
    while (days[cursor + count] <= deployDay) count += 1;
    releases.push(count);
    cursor += count;
  }
  return releases;
}`,
  },
  {
    captureId: 'demo-swea-1210',
    platform: 'SWEA',
    problemNumber: '1210',
    title: 'Ladder1',
    problemUrl: 'https://swexpertacademy.com/main/code/problem/problemDetail.do?problemLevel=1&contestProbId=AV14ABYKADACFAYh',
    language: 'Java',
    result: 'ACCEPTED',
    observedAt: '2026-09-12T18:30:00+09:00',
    solvedAt: '2026-09-12T18:38:11+09:00',
    executionTime: 6,
    memoryUsage: 26.5,
    sourceCode: `static int climb(int[][] ladder, int start) {
    int row = 99;
    int col = start;
    while (row > 0) {
        if (col > 0 && ladder[row][col - 1] == 1) {
            while (col > 0 && ladder[row][col - 1] == 1) col--;
        } else if (col < 99 && ladder[row][col + 1] == 1) {
            while (col < 99 && ladder[row][col + 1] == 1) col++;
        }
        row--;
    }
    return col;
}`,
  },
  {
    captureId: 'demo-programmers-12909',
    platform: 'PROGRAMMERS',
    problemNumber: '12909',
    title: '올바른 괄호',
    problemUrl: 'https://school.programmers.co.kr/learn/courses/30/lessons/12909',
    language: 'Python',
    result: 'ACCEPTED',
    observedAt: '2026-09-10T11:40:00+09:00',
    solvedAt: '2026-09-10T11:43:03+09:00',
    executionTime: 1.2,
    memoryUsage: 16.1,
    sourceCode: `def solution(s):
    balance = 0
    for char in s:
        balance += 1 if char == "(" else -1
        if balance < 0:
            return False
    return balance == 0`,
  },
  {
    captureId: 'demo-swea-1989',
    platform: 'SWEA',
    problemNumber: '1989',
    title: '초심자의 회문 검사',
    problemUrl: 'https://swexpertacademy.com/main/code/problem/problemDetail.do?problemLevel=1&contestProbId=AV5Pq-4qAaUDFAUq',
    language: 'Kotlin',
    result: 'ACCEPTED',
    observedAt: '2026-09-08T20:10:00+09:00',
    solvedAt: '2026-09-08T20:11:09+09:00',
    executionTime: 118,
    memoryUsage: 21.7,
    sourceCode: `fun main() {
    val t = readln().toInt()
    repeat(t) { testCase ->
        val word = readln()
        val answer = if (word == word.reversed()) 1 else 0
        println("#\${testCase + 1} $answer")
    }
}`,
  },
]
