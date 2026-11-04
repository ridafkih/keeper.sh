import { serializedCall } from "@/lib/serialized-mutate";
import { resolveUpdatedIds } from "@/utils/collections";

export interface MappingToggleDependencies {
  readCommittedIds: () => string[];
  applyOptimistic: (ids: string[]) => void;
  persist: (ids: string[]) => Promise<unknown>;
  onFailure: () => void;
  onSettled: () => void;
}

const pendingIdsByKey = new Map<string, string[]>();

export function toggleMappingId(
  key: string,
  targetId: string,
  checked: boolean,
  dependencies: MappingToggleDependencies,
): string[] {
  const baseIds = pendingIdsByKey.get(key) ?? dependencies.readCommittedIds();
  const updatedIds = resolveUpdatedIds(baseIds, targetId, checked);
  pendingIdsByKey.set(key, updatedIds);
  dependencies.applyOptimistic(updatedIds);

  serializedCall(key, () => {
    const latestIds = pendingIdsByKey.get(key) ?? updatedIds;
    return dependencies.persist(latestIds)
      .then(() => {
        if (pendingIdsByKey.get(key) === latestIds) {
          pendingIdsByKey.delete(key);
        }
      })
      .catch(() => {
        pendingIdsByKey.delete(key);
        dependencies.onFailure();
      })
      .finally(dependencies.onSettled);
  });

  return updatedIds;
}
