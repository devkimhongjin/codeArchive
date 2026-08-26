import type { SolutionRecord } from "./solution";
import type { SolutionRepository } from "./solutionRepository";

export async function clearForeignSyncOwnership(
  repository: SolutionRepository,
  currentUserKey: string,
): Promise<SolutionRecord[]> {
  const records = await repository.list();
  const changed = await Promise.all(records.map(async (record) => {
    if (!record.sync?.userKey || record.sync.userKey === currentUserKey) return record;
    return repository.setSyncMetadata(record.id, undefined);
  }));
  return changed;
}
