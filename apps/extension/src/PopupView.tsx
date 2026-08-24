import { useEffect, useState, type FormEvent } from "react";
import "./popup.css";
import type { AiUsage, NewSolutionInput, SolutionRecord } from "./solution";
import {
  indexedDbSolutionRepository,
  type SolutionRepository,
} from "./solutionRepository";

const EMPTY_FORM: NewSolutionInput = {
  platform: "",
  problemNumber: "",
  title: "",
  language: "",
  code: "",
  solvedAt: null,
  aiUsage: "unknown",
};

const REQUIRED_FIELDS: Array<keyof Pick<
  NewSolutionInput,
  "platform" | "problemNumber" | "title" | "language" | "code"
>> = ["platform", "problemNumber", "title", "language", "code"];

interface PopupProps {
  repository?: SolutionRepository;
}

export function Popup({ repository = indexedDbSolutionRepository }: PopupProps) {
  const [form, setForm] = useState<NewSolutionInput>(EMPTY_FORM);
  const [records, setRecords] = useState<SolutionRecord[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    repository.list().then(setRecords).catch(() => {
      setError("저장된 기록을 불러오지 못했습니다.");
    });
  }, [repository]);

  function updateField<K extends keyof NewSolutionInput>(key: K, value: NewSolutionInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing = REQUIRED_FIELDS.some((key) => !form[key].trim());
    if (missing) {
      setError("필수 입력값을 모두 입력해주세요.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await repository.create(form);
      setRecords(await repository.list());
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch {
      setError("풀이를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="popup" aria-labelledby="popup-title">
      <header className="popup-header">
        <div>
          <p className="eyebrow">CodeArchive</p>
          <h1 id="popup-title">내 풀이 기록</h1>
        </div>
        <button className="primary-button" type="button" onClick={() => setShowForm((value) => !value)}>
          {showForm ? "등록 닫기" : "새 풀이 등록"}
        </button>
      </header>

      {showForm && (
        <form className="solution-form" onSubmit={handleSubmit} noValidate>
          <div className="field-grid">
            <label>
              플랫폼 <span aria-hidden="true">*</span>
              <input value={form.platform} onChange={(event) => updateField("platform", event.target.value)} />
            </label>
            <label>
              문제 번호 <span aria-hidden="true">*</span>
              <input value={form.problemNumber} onChange={(event) => updateField("problemNumber", event.target.value)} />
            </label>
          </div>
          <label>
            제목 <span aria-hidden="true">*</span>
            <input value={form.title} onChange={(event) => updateField("title", event.target.value)} />
          </label>
          <label>
            언어 <span aria-hidden="true">*</span>
            <input value={form.language} onChange={(event) => updateField("language", event.target.value)} />
          </label>
          <label>
            코드 <span aria-hidden="true">*</span>
            <textarea rows={7} value={form.code} onChange={(event) => updateField("code", event.target.value)} />
          </label>
          <div className="field-grid">
            <label>
              풀이 날짜
              <input
                type="date"
                value={form.solvedAt ?? ""}
                onChange={(event) => updateField("solvedAt", event.target.value || null)}
              />
            </label>
            <label>
              AI 활용
              <select
                value={form.aiUsage}
                onChange={(event) => updateField("aiUsage", event.target.value as AiUsage)}
              >
                <option value="unknown">모름</option>
                <option value="not_used">사용 안 함</option>
                <option value="used">사용함</option>
              </select>
            </label>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary-button save-button" type="submit" disabled={saving}>
            {saving ? "저장 중..." : "저장"}
          </button>
        </form>
      )}

      {!showForm && error && <p className="error" role="alert">{error}</p>}

      <section className="record-section" aria-labelledby="record-list-title">
        <div className="section-heading">
          <h2 id="record-list-title">저장된 풀이</h2>
          <span>{records.length}건</span>
        </div>
        {records.length === 0 ? (
          <p className="empty-state">아직 저장된 풀이가 없습니다.</p>
        ) : (
          <ul className="record-list">
            {records.map((record) => (
              <li key={record.id} className="record-card">
                <strong>{record.title}</strong>
                <span>{record.platform} · {record.problemNumber}</span>
                <span>{record.language}{record.solvedAt ? ` · ${record.solvedAt}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="status" role="status">서버 연결 없음 · IndexedDB 로컬 저장</p>
    </main>
  );
}
