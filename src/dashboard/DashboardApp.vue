<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  AI_USAGE_LEVELS,
  PLATFORMS,
  PROGRAMMING_LANGUAGES,
  createEntityId,
  createUtcTimestamp,
  type AIUsageLevel,
  type AIUsageRecord,
  type Platform,
  type Problem,
  type ProgrammingLanguage,
  type SolutionSession,
} from '../common/types'
import { compareProblems } from '../common/validators'
import { CodeArchiveRepository, type CoreRecordBundle } from '../storage'

type View = 'list' | 'create' | 'detail' | 'edit'

interface RecordView {
  problem: Problem
  session: SolutionSession
  aiUsage: AIUsageRecord
}

interface RecordForm {
  platform: Platform
  problemNumber: string
  title: string
  language: ProgrammingLanguage
  code: string
  solvedDate: string
  aiLevel: AIUsageLevel
}

const repository = new CodeArchiveRepository()
const view = ref<View>('list')
const records = ref<RecordView[]>([])
const selectedSessionId = ref<SolutionSession['id']>()
const duplicateCandidates = ref<Problem[]>([])
const isLoading = ref(true)
const isSaving = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

const form = reactive<RecordForm>(emptyForm())

const platformLabels: Record<Platform, string> = {
  swea: 'SWEA',
  programmers: 'Programmers',
  jungol: 'Jungol',
  leetcode: 'LeetCode',
}

const languageLabels: Record<ProgrammingLanguage, string> = {
  java: 'Java',
  python: 'Python',
  c: 'C',
  cpp: 'C++',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  kotlin: 'Kotlin',
  csharp: 'C#',
  go: 'Go',
  swift: 'Swift',
  rust: 'Rust',
}

const aiLevelLabels: Record<AIUsageLevel, string> = {
  none: '사용하지 않음',
  'concept-only': '개념만 질문',
  'partial-hint': '부분 힌트',
  'solution-direction': '풀이 방향',
  'partial-code': '부분 코드',
  'full-solution': '전체 풀이',
  'ai-led-study': 'AI 주도 학습',
  unrecorded: '기록하지 않음',
}

const selectedRecord = computed(() =>
  records.value.find((record) => record.session.id === selectedSessionId.value),
)

const selectedProblemSessionCount = computed(() => {
  const selected = selectedRecord.value
  if (!selected) return 0
  return records.value.filter(
    (record) => record.problem.id === selected.problem.id,
  ).length
})

function emptyForm(): RecordForm {
  return {
    platform: 'swea',
    problemNumber: '',
    title: '',
    language: 'java',
    code: '',
    solvedDate: '',
    aiLevel: 'unrecorded',
  }
}

function resetMessages(): void {
  errorMessage.value = ''
  successMessage.value = ''
}

function resetForm(): void {
  Object.assign(form, emptyForm())
  duplicateCandidates.value = []
}

function toOptional(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function solvedAtFromDate(value: string): string | undefined {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : undefined
}

function dateFromTimestamp(value?: string): string {
  return value?.slice(0, 10) ?? ''
}

function userFacingError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `저장소 작업에 실패했습니다. ${error.message}`
  }
  return '저장소 작업에 실패했습니다. 입력 내용을 유지했으니 다시 시도해 주세요.'
}

async function loadRecords(): Promise<void> {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [problems, sessions, aiUsageRecords] = await Promise.all([
      repository.listProblems(),
      repository.listSolutionSessions(),
      repository.listAIUsageRecords(),
    ])
    const problemById = new Map(
      problems.map((problem) => [problem.id, problem]),
    )
    const aiBySessionId = new Map(
      aiUsageRecords.map((record) => [record.solutionSessionId, record]),
    )
    records.value = sessions
      .flatMap((session) => {
        const problem = problemById.get(session.problemId)
        const aiUsage = aiBySessionId.get(session.id)
        return problem && aiUsage ? [{ problem, session, aiUsage }] : []
      })
      .sort((left, right) =>
        right.session.createdAt.localeCompare(left.session.createdAt),
      )
  } catch (error) {
    errorMessage.value = userFacingError(error)
  } finally {
    isLoading.value = false
  }
}

function openCreate(): void {
  resetMessages()
  resetForm()
  selectedSessionId.value = undefined
  view.value = 'create'
}

function openDetail(record: RecordView): void {
  resetMessages()
  duplicateCandidates.value = []
  selectedSessionId.value = record.session.id
  view.value = 'detail'
}

function openEdit(): void {
  const record = selectedRecord.value
  if (!record) return
  resetMessages()
  duplicateCandidates.value = []
  Object.assign(form, {
    platform: record.problem.platform,
    problemNumber: record.problem.problemNumber ?? '',
    title: record.problem.title ?? '',
    language: record.session.language,
    code: record.session.code ?? '',
    solvedDate: dateFromTimestamp(record.session.solvedAt),
    aiLevel: record.aiUsage.level,
  })
  view.value = 'edit'
}

function showList(): void {
  resetMessages()
  duplicateCandidates.value = []
  view.value = 'list'
}

function validateForm(): boolean {
  errorMessage.value = ''
  if (!form.platform) {
    errorMessage.value = '플랫폼을 선택해 주세요.'
    return false
  }
  if (!form.language) {
    errorMessage.value = '언어를 선택해 주세요.'
    return false
  }
  if (!form.title.trim() && !form.problemNumber.trim()) {
    errorMessage.value = '문제 제목 또는 문제 번호 중 하나를 입력해 주세요.'
    return false
  }
  return true
}

function draftProblem(now: string): Problem {
  return {
    schemaVersion: 1,
    id: createEntityId('problem'),
    platform: form.platform,
    problemNumber: toOptional(form.problemNumber),
    title: toOptional(form.title),
    tags: [],
    source: 'manual',
    createdAt: now,
    updatedAt: now,
  }
}

function createSession(problemId: Problem['id'], now: string): SolutionSession {
  return {
    schemaVersion: 1,
    id: createEntityId('solutionSession'),
    problemId,
    language: form.language,
    result: 'unknown',
    code: toOptional(form.code),
    solvedAt: solvedAtFromDate(form.solvedDate),
    mistakes: [],
    reviewRequired: false,
    source: 'manual',
    createdAt: now,
    updatedAt: now,
  }
}

function createAIUsage(
  solutionSessionId: SolutionSession['id'],
  now: string,
): AIUsageRecord {
  return {
    schemaVersion: 1,
    id: createEntityId('aiUsageRecord'),
    solutionSessionId,
    level: form.aiLevel,
    purposes: [],
    reviewRequired: false,
    recordedAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

function createBundle(problem: Problem, now: string): CoreRecordBundle {
  const solutionSession = createSession(problem.id, now)
  return {
    problem,
    solutionSession,
    aiUsageRecord: createAIUsage(solutionSession.id, now),
  }
}

async function beginCreate(): Promise<void> {
  if (!validateForm()) return
  resetMessages()

  const candidate = draftProblem(createUtcTimestamp())
  const knownProblems = new Map(
    records.value.map((record) => [record.problem.id, record.problem]),
  )
  duplicateCandidates.value = [...knownProblems.values()].filter(
    (problem) => compareProblems(candidate, problem).kind !== 'none',
  )

  if (duplicateCandidates.value.length > 0) return
  await saveNewProblem()
}

async function saveNewProblem(): Promise<void> {
  if (!validateForm()) return
  isSaving.value = true
  errorMessage.value = ''
  try {
    const now = createUtcTimestamp()
    await repository.createCoreRecordBundle(
      createBundle(draftProblem(now), now),
    )
    await finishSave('새 풀이가 저장되었습니다.')
  } catch (error) {
    errorMessage.value = userFacingError(error)
  } finally {
    isSaving.value = false
  }
}

async function saveForExistingProblem(problem: Problem): Promise<void> {
  if (!validateForm()) return
  isSaving.value = true
  errorMessage.value = ''
  try {
    const now = createUtcTimestamp()
    await repository.createSolutionBundle(createBundle(problem, now))
    await finishSave('기존 문제에 새 풀이 세션을 추가했습니다.')
  } catch (error) {
    errorMessage.value = userFacingError(error)
  } finally {
    isSaving.value = false
  }
}

async function updateRecord(): Promise<void> {
  if (!validateForm()) return
  const current = selectedRecord.value
  if (!current) {
    errorMessage.value = '수정할 기록을 찾지 못했습니다.'
    return
  }

  isSaving.value = true
  errorMessage.value = ''
  try {
    const now = createUtcTimestamp()
    await repository.updateCoreRecordBundle({
      problem: {
        ...current.problem,
        platform: form.platform,
        problemNumber: toOptional(form.problemNumber),
        title: toOptional(form.title),
        updatedAt: now,
      },
      solutionSession: {
        ...current.session,
        language: form.language,
        code: toOptional(form.code),
        solvedAt: solvedAtFromDate(form.solvedDate),
        updatedAt: now,
      },
      aiUsageRecord: {
        ...current.aiUsage,
        level: form.aiLevel,
        purposes:
          form.aiLevel === 'none' || form.aiLevel === 'unrecorded'
            ? []
            : current.aiUsage.purposes,
        updatedAt: now,
      },
    })
    await loadRecords()
    successMessage.value = '풀이 기록을 수정했습니다.'
    view.value = 'detail'
  } catch (error) {
    errorMessage.value = userFacingError(error)
  } finally {
    isSaving.value = false
  }
}

async function finishSave(message: string): Promise<void> {
  await loadRecords()
  resetForm()
  successMessage.value = message
  view.value = 'list'
}

onMounted(loadRecords)
</script>

<template>
  <main class="shell">
    <header class="page-header">
      <div>
        <p class="eyebrow">LOCAL FIRST · MANUAL ARCHIVE</p>
        <h1>CodeArchive</h1>
        <p class="subtitle">
          문제 풀이와 AI 활용 수준을 브라우저에 기록합니다.
        </p>
      </div>
      <button
        v-if="view !== 'create'"
        class="primary"
        type="button"
        @click="openCreate"
      >
        풀이 추가
      </button>
    </header>

    <p v-if="errorMessage" class="notice error" role="alert">
      {{ errorMessage }}
    </p>
    <p v-if="successMessage" class="notice success" role="status">
      {{ successMessage }}
    </p>

    <section v-if="view === 'list'" aria-labelledby="archive-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">ARCHIVE</p>
          <h2 id="archive-heading">저장된 풀이</h2>
        </div>
        <span class="count">{{ records.length }}개</span>
      </div>

      <p v-if="isLoading" class="empty-state">
        저장된 풀이를 불러오는 중입니다.
      </p>
      <div v-else-if="records.length === 0" class="empty-state">
        <strong>아직 저장된 풀이가 없습니다.</strong>
        <span>첫 풀이를 직접 추가해 아카이브를 시작하세요.</span>
        <button class="primary" type="button" @click="openCreate">
          첫 풀이 추가
        </button>
      </div>
      <ul v-else class="record-list">
        <li v-for="record in records" :key="record.session.id">
          <button class="record-card" type="button" @click="openDetail(record)">
            <span class="platform">
              {{ platformLabels[record.problem.platform] }}
            </span>
            <strong>
              {{
                record.problem.title || `문제 ${record.problem.problemNumber}`
              }}
            </strong>
            <span class="metadata">
              {{ languageLabels[record.session.language] }}
              · {{ aiLevelLabels[record.aiUsage.level] }} ·
              {{ dateFromTimestamp(record.session.solvedAt) || '날짜 미기록' }}
            </span>
          </button>
        </li>
      </ul>
    </section>

    <section
      v-else-if="view === 'create' || view === 'edit'"
      aria-labelledby="form-heading"
    >
      <div class="section-heading">
        <div>
          <p class="eyebrow">{{ view === 'create' ? 'NEW RECORD' : 'EDIT' }}</p>
          <h2 id="form-heading">
            {{ view === 'create' ? '풀이 추가' : '풀이 수정' }}
          </h2>
        </div>
        <button
          class="text-button"
          type="button"
          @click="view === 'edit' ? openDetail(selectedRecord!) : showList()"
        >
          취소
        </button>
      </div>

      <form
        class="record-form"
        @submit.prevent="view === 'create' ? beginCreate() : updateRecord()"
      >
        <div class="field-grid">
          <label>
            플랫폼 <span aria-hidden="true">*</span>
            <select v-model="form.platform" required>
              <option
                v-for="platform in PLATFORMS"
                :key="platform"
                :value="platform"
              >
                {{ platformLabels[platform] }}
              </option>
            </select>
          </label>
          <label>
            언어 <span aria-hidden="true">*</span>
            <select v-model="form.language" required>
              <option
                v-for="language in PROGRAMMING_LANGUAGES"
                :key="language"
                :value="language"
              >
                {{ languageLabels[language] }}
              </option>
            </select>
          </label>
          <label>
            문제 번호
            <input
              v-model="form.problemNumber"
              type="text"
              placeholder="예: 1206"
            />
          </label>
          <label>
            문제 제목
            <input
              v-model="form.title"
              type="text"
              placeholder="번호 또는 제목 중 하나는 필수"
            />
          </label>
          <label>
            풀이 날짜
            <input v-model="form.solvedDate" type="date" />
          </label>
          <label>
            AI 활용 수준
            <select v-model="form.aiLevel">
              <option
                v-for="level in AI_USAGE_LEVELS"
                :key="level"
                :value="level"
              >
                {{ aiLevelLabels[level] }}
              </option>
            </select>
          </label>
        </div>
        <label>
          풀이 코드
          <textarea
            v-model="form.code"
            rows="12"
            spellcheck="false"
            placeholder="선택 입력"
          />
        </label>

        <p
          v-if="view === 'edit' && selectedProblemSessionCount > 1"
          class="notice warning"
        >
          문제 정보는 {{ selectedProblemSessionCount }}개 풀이가 공유합니다.
          플랫폼·번호·제목 변경은 다른 풀이 상세에도 반영됩니다.
        </p>

        <aside
          v-if="duplicateCandidates.length > 0"
          class="duplicate-panel"
          aria-labelledby="duplicate-heading"
        >
          <h3 id="duplicate-heading">중복 가능성이 있는 문제가 있습니다</h3>
          <p>자동으로 합치지 않습니다. 저장 방식을 직접 선택해 주세요.</p>
          <ul>
            <li v-for="candidate in duplicateCandidates" :key="candidate.id">
              <div>
                <strong>{{
                  candidate.title || `문제 ${candidate.problemNumber}`
                }}</strong>
                <span>
                  {{ platformLabels[candidate.platform] }}
                  <template v-if="candidate.problemNumber">
                    · {{ candidate.problemNumber }}</template
                  >
                </span>
              </div>
              <button
                class="secondary"
                type="button"
                :disabled="isSaving"
                @click="saveForExistingProblem(candidate)"
              >
                이 문제에 풀이 추가
              </button>
            </li>
          </ul>
          <div class="actions">
            <button
              class="secondary"
              type="button"
              :disabled="isSaving"
              @click="saveNewProblem"
            >
              별도 문제로 저장
            </button>
            <button
              class="text-button"
              type="button"
              :disabled="isSaving"
              @click="duplicateCandidates = []"
            >
              취소하고 입력 수정
            </button>
          </div>
        </aside>

        <div v-else class="actions">
          <button class="primary" type="submit" :disabled="isSaving">
            {{
              isSaving ? '저장 중…' : view === 'create' ? '저장' : '변경 저장'
            }}
          </button>
          <button
            class="text-button"
            type="button"
            :disabled="isSaving"
            @click="view === 'edit' ? openDetail(selectedRecord!) : showList()"
          >
            취소
          </button>
        </div>
      </form>
    </section>

    <section
      v-else-if="view === 'detail' && selectedRecord"
      aria-labelledby="detail-heading"
    >
      <div class="section-heading">
        <div>
          <p class="eyebrow">
            {{ platformLabels[selectedRecord.problem.platform] }}
          </p>
          <h2 id="detail-heading">
            {{
              selectedRecord.problem.title ||
              `문제 ${selectedRecord.problem.problemNumber}`
            }}
          </h2>
        </div>
        <button class="text-button" type="button" @click="showList">
          목록
        </button>
      </div>

      <dl class="detail-grid">
        <div>
          <dt>문제 번호</dt>
          <dd>{{ selectedRecord.problem.problemNumber || '미기록' }}</dd>
        </div>
        <div>
          <dt>언어</dt>
          <dd>{{ languageLabels[selectedRecord.session.language] }}</dd>
        </div>
        <div>
          <dt>풀이 날짜</dt>
          <dd>
            {{ dateFromTimestamp(selectedRecord.session.solvedAt) || '미기록' }}
          </dd>
        </div>
        <div>
          <dt>결과</dt>
          <dd>{{ selectedRecord.session.result }}</dd>
        </div>
        <div>
          <dt>AI 활용</dt>
          <dd>{{ aiLevelLabels[selectedRecord.aiUsage.level] }}</dd>
        </div>
        <div>
          <dt>데이터 출처</dt>
          <dd>{{ selectedRecord.session.source }}</dd>
        </div>
      </dl>

      <div class="code-block">
        <h3>풀이 코드</h3>
        <pre>{{
          selectedRecord.session.code || '저장된 코드가 없습니다.'
        }}</pre>
      </div>
      <button class="primary" type="button" @click="openEdit">수정</button>
    </section>
  </main>
</template>

<style scoped>
:global(*) {
  box-sizing: border-box;
}

:global(body) {
  margin: 0;
  min-width: 320px;
  background: #f4f1ea;
  color: #1d2926;
  font-family:
    Inter,
    Pretendard,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: wait;
  opacity: 0.6;
}

.shell {
  width: min(960px, calc(100% - 32px));
  margin: 0 auto;
  padding: 48px 0 80px;
}

.page-header,
.section-heading,
.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.page-header {
  padding-bottom: 28px;
  border-bottom: 1px solid #c9c5bb;
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 6px;
  font-family: Georgia, serif;
  font-size: clamp(2.5rem, 7vw, 4.5rem);
  line-height: 0.95;
}

h2 {
  margin-bottom: 0;
  font-size: 1.75rem;
}

.subtitle,
.metadata,
.duplicate-panel span {
  color: #5d6864;
}

.subtitle {
  margin-bottom: 0;
}

.eyebrow {
  margin-bottom: 8px;
  color: #1c6b57;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.14em;
}

section {
  padding-top: 36px;
}

.count {
  padding: 5px 10px;
  border: 1px solid #b8b4a9;
  border-radius: 999px;
  font-size: 0.85rem;
}

.primary,
.secondary,
.text-button {
  min-height: 42px;
  border-radius: 6px;
  padding: 10px 16px;
  font-weight: 700;
}

.primary {
  border: 1px solid #174f42;
  background: #174f42;
  color: white;
}

.secondary {
  border: 1px solid #78827e;
  background: transparent;
  color: #1d2926;
}

.text-button {
  border: 0;
  background: transparent;
  color: #174f42;
}

.empty-state {
  display: grid;
  justify-items: start;
  gap: 10px;
  margin-top: 24px;
  padding: 40px;
  border: 1px dashed #aaa69d;
  border-radius: 10px;
  background: #faf8f2;
}

.record-list {
  display: grid;
  gap: 12px;
  margin: 24px 0 0;
  padding: 0;
  list-style: none;
}

.record-card {
  display: grid;
  width: 100%;
  gap: 7px;
  padding: 20px;
  border: 1px solid #d1cdc3;
  border-radius: 8px;
  background: #faf8f2;
  color: inherit;
  text-align: left;
}

.record-card:hover,
.record-card:focus-visible {
  border-color: #1c6b57;
  box-shadow: 0 4px 16px rgb(23 79 66 / 10%);
}

.platform {
  color: #1c6b57;
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
}

.record-form {
  display: grid;
  gap: 22px;
  margin-top: 28px;
  padding: 28px;
  border: 1px solid #d1cdc3;
  border-radius: 10px;
  background: #faf8f2;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

label {
  display: grid;
  gap: 7px;
  font-size: 0.88rem;
  font-weight: 700;
}

input,
select,
textarea {
  width: 100%;
  border: 1px solid #aaa69d;
  border-radius: 5px;
  background: white;
  padding: 10px 12px;
  color: #1d2926;
}

input:focus,
select:focus,
textarea:focus {
  border-color: #1c6b57;
  outline: 3px solid rgb(28 107 87 / 14%);
}

textarea,
pre {
  font-family: 'Cascadia Code', Consolas, monospace;
}

.notice {
  margin: 20px 0 0;
  border-radius: 6px;
  padding: 12px 14px;
}

.error {
  background: #fee8e5;
  color: #84291f;
}

.success {
  background: #dff3e9;
  color: #15543f;
}

.warning {
  margin: 0;
  background: #fff0c9;
  color: #6f4b00;
}

.duplicate-panel {
  border: 1px solid #d19a28;
  border-radius: 8px;
  padding: 20px;
  background: #fff8e6;
}

.duplicate-panel ul {
  display: grid;
  gap: 10px;
  margin: 16px 0;
  padding: 0;
  list-style: none;
}

.duplicate-panel li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-top: 1px solid #e4cc91;
  padding-top: 10px;
}

.duplicate-panel li div {
  display: grid;
  gap: 3px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin: 28px 0;
  overflow: hidden;
  border: 1px solid #d1cdc3;
  border-radius: 8px;
  background: #d1cdc3;
}

.detail-grid div {
  padding: 18px;
  background: #faf8f2;
}

dt {
  margin-bottom: 5px;
  color: #66706c;
  font-size: 0.75rem;
}

dd {
  margin: 0;
  font-weight: 700;
}

.code-block {
  margin-bottom: 20px;
}

pre {
  min-height: 180px;
  overflow: auto;
  border-radius: 8px;
  background: #17211f;
  padding: 20px;
  color: #edf5f1;
  white-space: pre-wrap;
}

@media (max-width: 640px) {
  .shell {
    width: min(100% - 20px, 960px);
    padding-top: 28px;
  }

  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .field-grid,
  .detail-grid {
    grid-template-columns: 1fr;
  }

  .record-form {
    padding: 18px;
  }

  .duplicate-panel li,
  .actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
