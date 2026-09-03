import type { SubmissionPerformance } from "../../solution";

const RESULT_GROUP_SELECTOR = ".console-content .console-test-group";
const RESULT_CELL_SELECTOR = ".result";
const RESULT_PATTERN = /^통과\s*\(\s*(\d+(?:\.\d+)?)\s*ms\s*,\s*(\d+(?:\.\d+)?)\s*MB\s*\)$/;

function normalizedText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function finiteNonNegative(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseProgrammersPerformanceGroup(group: Element): SubmissionPerformance | null {
  const cells = Array.from(group.querySelectorAll(RESULT_CELL_SELECTOR));
  if (cells.length === 0) return null;

  const metrics = cells.map((cell) => {
    if (!cell.classList.contains("passed")) return null;
    const match = normalizedText(cell.textContent).match(RESULT_PATTERN);
    if (!match) return null;
    const executionTime = finiteNonNegative(match[1]);
    const memoryUsage = finiteNonNegative(match[2]);
    return executionTime === null || memoryUsage === null ? null : { executionTime, memoryUsage };
  });
  if (metrics.some((metric) => metric === null)) return null;

  const validMetrics = metrics as Array<{ executionTime: number; memoryUsage: number }>;
  const executionTotal = validMetrics.reduce((sum, metric) => sum + metric.executionTime, 0);
  const memoryAverage = validMetrics.reduce((sum, metric) => sum + metric.memoryUsage, 0) / validMetrics.length;
  return {
    executionTime: `${executionTotal.toFixed(2)} ms`,
    memoryUsage: `${memoryAverage.toFixed(2)} MB`,
  };
}

export function findProgrammersResultGroup(document: Document): Element | null {
  const groups = Array.from(document.querySelectorAll(RESULT_GROUP_SELECTOR));
  return groups.length === 1 ? groups[0] : null;
}

function elementContainsOrIs(container: Element | null, target: Node | null): boolean {
  return !!container && !!target && (container === target || container.contains(target));
}

function nodeContainsResultGroup(node: Node, group: Element): boolean {
  return node === group || (node.nodeType === Node.ELEMENT_NODE && (node as Element).querySelector(RESULT_GROUP_SELECTOR) === group);
}

export function resultGroupMutationRelevant(document: Document, records: readonly MutationRecord[]): boolean {
  const group = findProgrammersResultGroup(document);
  if (!group) return false;

  return records.some((record) => {
    if (record.type === "characterData") {
      return elementContainsOrIs(group, record.target.parentElement);
    }
    if (record.type === "attributes") {
      const target = record.target as Element;
      return target === group || target.classList.contains("result") || group.contains(target);
    }
    if (elementContainsOrIs(group, record.target)) return true;
    return Array.from(record.addedNodes).some((node) => nodeContainsResultGroup(node, group))
      || Array.from(record.removedNodes).some((node) => node.nodeType === Node.ELEMENT_NODE && (node as Element).matches(RESULT_GROUP_SELECTOR));
  });
}
