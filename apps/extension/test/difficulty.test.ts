import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseHTML } from 'linkedom'
import { normalizeDifficulty } from '../../../shared/difficulty'
import { programmersListingDifficulty, sweaDifficulty } from '../src/problemDifficulty'

test('uses the verified Programmers problem link and Lv cell together', () => {
  const { document } = parseHTML('<table><tr><td class="title"><a href="/learn/courses/30/lessons/389481">봉인된 주문</a></td><td class="level"><span class="level-3">Lv. 3</span></td></tr></table>')
  const row = document.querySelector('tr')!
  assert.equal(programmersListingDifficulty(row, '389481', 'https://school.programmers.co.kr/learn/courses/30/lessons/389481')?.label, 'Lv. 3')
  assert.equal(programmersListingDifficulty(row, '299310', 'https://school.programmers.co.kr/learn/courses/30/lessons/299310'), undefined)
  row.querySelector('span')!.className = 'level-2'
  assert.equal(programmersListingDifficulty(row, '389481', 'https://school.programmers.co.kr/learn/courses/30/lessons/389481'), undefined)
})
test('binds a single SWEA title badge to the verified problem', () => {
  const { document } = parseHTML('<div class="problem_box"><h1 class="problem_title">123. Title<span class="badge">D3</span></h1></div>')
  const url = 'https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=VerifiedKey'
  assert.equal(sweaDifficulty(document, '123', url)?.label, 'D3')
  assert.equal(sweaDifficulty(document, '124', url), undefined)
  document.querySelector('h1')!.innerHTML += '<span class="badge">D5</span>'
  assert.equal(sweaDifficulty(document, '123', url), undefined)
})
test('leaves absent/invalid/unofficial scales and Jungol tiers unknown', () => {
  const url = 'https://school.programmers.co.kr/learn/courses/30/lessons/123'
  assert.equal(normalizeDifficulty('PROGRAMMERS', '123', url, { label: 'Lv. 6', problemNumber: '123', sourceUrl: 'https://school.programmers.co.kr/learn/challenges' }), undefined)
  assert.equal(normalizeDifficulty('PROGRAMMERS', '123', url, { label: 'Lv. 3', problemNumber: '123', sourceUrl: 'https://evil.test/learn/challenges' }), undefined)
  assert.equal(normalizeDifficulty('JUNGOL', '123', 'https://jungol.co.kr/problem/123', { label: 'Gold I', problemNumber: '123', sourceUrl: 'https://solved.ac/problem/123' }), undefined)
})
