export function resolveUpdatedIds(currentIds: string[], targetId: string, checked: boolean): string[] {
  if (checked) return currentIds.includes(targetId) ? currentIds : [...currentIds, targetId];
  return currentIds.filter((id) => id !== targetId);
}
