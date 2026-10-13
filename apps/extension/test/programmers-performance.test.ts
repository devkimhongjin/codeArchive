import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { ProgrammersAdapter } from '../src/adapters/programmers';

const locationFor = () => new URL('https://school.programmers.co.kr/learn/courses/30/lessons/72413') as unknown as Location;
const row = (time = .5, memory = 80) => `<tr><th>테스트</th><td class="result passed">통과 (${time}ms, ${memory}MB)</td></tr>`;
function group(category: string, rows: string, heading = category === 'correctness' ? '정확성  테스트' : '효율성  테스트') {
  return `<div class="console-message">${heading}</div><table class="console-test-group" data-category="${category}"><tbody>${rows}</tbody></table>`;
}
const split = () => group('correctness', row().repeat(10)) + group('effectiveness', row(2, 60).repeat(30));
function fixture(baseline = '') {
  const { document } = parseHTML(`<html><body><div class="challenge-title">합성 문제</div><nav class="challenge-nav"><button class="dropdown-toggle">Java</button></nav><textarea id="code" name="code">class Synthetic {}</textarea><pre class="console-content">${baseline}</pre></body></html>`);
  const adapter = new ProgrammersAdapter(document, locationFor());
  adapter.beginSubmissionAttempt();
  const content = document.querySelector('.console-content')!;
  const replace = (html: string) => { content.innerHTML = html; };
  return { document, adapter, content, replace };
}
const expected = { executionTime: 65, memoryUsage: 65, memoryValue: 65, memoryUnit: 'MB' };

test('collects the observed 10 correctness and 30 effectiveness rows using a test-weighted memory average', () => {
  const f = fixture(); f.replace(split());
  assert.deepEqual(f.adapter.collectPerformance(), expected);
});

test('keeps one-table collection compatible with the existing sum/average contract', () => {
  const f = fixture(); f.replace(`<table class="console-test-group"><tbody>${row(1, 10)}${row(3, 30)}</tbody></table>`);
  assert.deepEqual(f.adapter.collectPerformance(), { executionTime: 4, memoryUsage: 20, memoryValue: 20, memoryUnit: 'MB' });
});

test('requires fresh results in both categories rather than mixing a new table with old metrics', () => {
  const f = fixture(split());
  assert.equal(f.adapter.collectPerformance(), null, 'unchanged prior results');
  f.document.querySelector('[data-category="correctness"] tbody')!.innerHTML = row(1, 100).repeat(10);
  assert.equal(f.adapter.collectPerformance(), null, 'effectiveness results still belong to the previous attempt');
  f.document.querySelector('[data-category="effectiveness"] tbody')!.innerHTML = row(3, 60).repeat(30);
  assert.deepEqual(f.adapter.collectPerformance(), { executionTime: 100, memoryUsage: 70, memoryValue: 70, memoryUnit: 'MB' });
});

test('allows identical reused split metrics only with a fresh exact duplicate-code notice', () => {
  const f = fixture(split());
  const oldNotice = f.document.createElement('div'); oldNotice.className = 'console-failed'; oldNotice.textContent = '같은 코드로 채점한 결과가 있습니다.';
  f.content.prepend(oldNotice); f.adapter.beginSubmissionAttempt();
  assert.equal(f.adapter.collectPerformance(), null, 'a pre-existing duplicate notice is insufficient');
  oldNotice.remove();
  const newNotice = f.document.createElement('div'); newNotice.className = 'console-failed'; newNotice.textContent = '같은 코드로 채점한 결과가 있습니다.';
  f.content.prepend(newNotice);
  assert.deepEqual(f.adapter.collectPerformance(), expected);
});

test('recognizes replacement tables and category reordering as a new complete result', () => {
  const f = fixture(split());
  f.replace(group('effectiveness', row(2, 60).repeat(30)) + group('correctness', row().repeat(10)));
  assert.deepEqual(f.adapter.collectPerformance(), expected);
});

test('rejects ambiguous category pairs, duplicate result sets and separate console containers', () => {
  for (const html of [
    group('correctness', row()) + group('correctness', row()),
    group('correctness', row()) + group('unknown', row()),
    group('correctness', row(), '다른 실행 결과') + group('effectiveness', row()),
    split() + group('correctness', row()),
    `<div>${group('correctness', row())}</div><div>${group('effectiveness', row())}</div>`,
  ]) {
    const f = fixture(); f.replace(html); assert.equal(f.adapter.collectPerformance(), null);
  }
});

test('does not aggregate an empty, failed, pending or malformed section', () => {
  for (const rows of ['', '<tr><td class="result failed">실패</td></tr>', '<tr><td class="result">채점 중</td></tr>',
    '<tr><td class="result passed">통과 (1s, 2MB)</td></tr>', '<tr><td class="result passed">통과 (1ms, 메모리 미확인)</td></tr>']) {
    const f = fixture(); f.replace(group('correctness', row()) + group('effectiveness', rows));
    assert.equal(f.adapter.collectPerformance(), null);
  }
});

test('does not downgrade an already split attempt to a partial one-table result', () => {
  const f = fixture(split()); f.replace(group('correctness', row(10, 50)));
  assert.equal(f.adapter.collectPerformance(), null);
});

test('keeps zero-valued metrics and omits metrics once the submission attempt is consumed', () => {
  const f = fixture(); f.replace(group('correctness', row(0, 0)) + group('effectiveness', row(0, 0)));
  f.document.body.insertAdjacentHTML('beforeend', '<div id="modal-dialog" class="modal show" role="dialog" aria-modal="true"><h4 class="modal-title">정답입니다!</h4></div>');
  assert.deepEqual(f.adapter.collectPerformance(), { executionTime: 0, memoryUsage: 0, memoryValue: 0, memoryUnit: 'MB' });
  const detection = f.adapter.detectSubmissionResult()!;
  assert.equal(detection.accepted, true);
  f.adapter.consumeSubmissionResult(detection);
  assert.equal(f.adapter.collectPerformance(), null);
});
