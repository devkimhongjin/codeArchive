import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseHTML } from 'linkedom'
import { normalizeDifficulty } from '../../../shared/difficulty'
import { JungolAdapter } from '../src/adapters/jungol'
import { collectAcceptedCapture } from '../src/capture'
import { jungolDifficulty, programmersListingDifficulty, sweaDifficulty } from '../src/problemDifficulty'

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
test('leaves absent/invalid/unofficial scales and BOJ tiers of Jungol numbers unknown', () => {
  const url = 'https://school.programmers.co.kr/learn/courses/30/lessons/123'
  assert.equal(normalizeDifficulty('PROGRAMMERS', '123', url, { label: 'Lv. 6', problemNumber: '123', sourceUrl: 'https://school.programmers.co.kr/learn/challenges' }), undefined)
  assert.equal(normalizeDifficulty('PROGRAMMERS', '123', url, { label: 'Lv. 3', problemNumber: '123', sourceUrl: 'https://evil.test/learn/challenges' }), undefined)
  assert.equal(normalizeDifficulty('JUNGOL', '123', 'https://jungol.co.kr/problem/123', { label: 'Gold I', problemNumber: '123', sourceUrl: 'https://solved.ac/problem/123' }), undefined)
})
// Heading shape read from the live problem page on 2026-11-25.
const tier = (file: string, host = 's.jungol.co.kr') => `<span class="tier S-1kjq00h"><div class="trigger"><main style="--t: #ec9a00;"><span class="tier-image"><img src="https://${host}/solved/${file}?dm=jungol.co.kr" alt=""></span></main></div></span>`
const heading = (slot: string) => `<h1><span class="heading-text"><span class="head">${slot} <span class="name">로봇</span><span class="limit">1s</span></span></span></h1>`
const page = (html: string) => parseHTML(`<html><body>${html}</body></html>`).document
test('reads Jungol own tier only from the single problem heading', () => {
  const url = 'https://jungol.co.kr/problem/1006'
  assert.deepEqual(jungolDifficulty(page(heading(tier('14.svg'))), '1006', url), { label: 'Gold II', problemNumber: '1006', sourceUrl: url })
  assert.equal(jungolDifficulty(page(heading(tier('1.svg'))), '1006', url)?.label, 'Bronze V')
  assert.equal(jungolDifficulty(page(heading(tier('30.svg'))), '1006', url)?.label, 'Ruby I')
  for (const [name, html] of [
    ['an unrated problem has no tier slot', heading('')],
    ["a member's tier elsewhere on the page", heading('') + '<td data-col="제출자"><img src="https://s.jungol.co.kr/solved/6.svg"></td>'],
    ['a sprout badge', heading(tier('sprout-1.svg'))],
    ['an unrated image', heading(tier('0.svg'))],
    ['outside the 30 steps', heading(tier('31.svg'))],
    ['another host', heading(tier('14.svg', 'evil.test'))],
    ['two tiers', heading(tier('14.svg') + tier('15.svg'))],
    ['an image outside the tier slot', heading('<img src="https://s.jungol.co.kr/solved/14.svg">')],
    ['two headings', heading(tier('14.svg')) + heading(tier('14.svg'))]
  ] as const) assert.equal(jungolDifficulty(page(html), '1006', url), undefined, name)
})
test('accepts a Jungol tier only with that problem page as its source', () => {
  const url = 'https://jungol.co.kr/problem/1006', value = { label: 'Gold II', problemNumber: '1006', sourceUrl: url }
  assert.deepEqual(normalizeDifficulty('JUNGOL', '1006', url, value), value)
  assert.equal(normalizeDifficulty('JUNGOL', '1006', url, { ...value, label: 'Gold 2' }), undefined)
  assert.equal(normalizeDifficulty('JUNGOL', '1006', url, { ...value, sourceUrl: 'https://jungol.co.kr/problem/1007' }), undefined)
  assert.equal(normalizeDifficulty('JUNGOL', '1006', url, { ...value, sourceUrl: 'https://solved.ac/api/v3/problem/show?problemId=1006' }), undefined)
  assert.equal(normalizeDifficulty('JUNGOL', '1006', url, { ...value, sourceUrl: `${url}?cursor=x` }), undefined)
  assert.equal(normalizeDifficulty('BAEKJOON', '1006', 'https://acmicpc.net/problem/1006', value), undefined)
})
test('a Jungol capture carries the tier shown when it was submitted', () => {
  let now = Date.now()
  const document = page(heading(tier('14.svg')) + '<button id="submit">제출</button><textarea data-codearchive-jungol-source data-codearchive-jungol-problem="1006" data-codearchive-jungol-language="Java 8"></textarea>')
  const source = document.querySelector('textarea') as HTMLTextAreaElement
  source.value = 'class Main {}'
  document.documentElement.setAttribute('data-codearchive-editor-sync', `synced:${now}`)
  const adapter = new JungolAdapter(document, new URL('https://jungol.co.kr/problem/1006?cursor=x') as unknown as Location, 120_000, () => now)
  adapter.beginSubmissionAttempt(new Date(now))
  now += 250
  document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true" aria-labelledby="dialog-title-0" aria-describedby="dialog-desc-0"><h2 id="dialog-title-0">정답이에요!</h2><div id="dialog-desc-0">정답 100점 474ms 34,544MB</div><button>닫기</button></div>')
  const capture = collectAcceptedCapture(adapter, new Date(now))
  assert.equal(capture?.problemUrl, 'https://jungol.co.kr/problem/1006')
  assert.equal(capture?.difficulty?.label, 'Gold II')
})
