export function pluralize(count: number, singular: string, plural: string = `${singular}s`): string {
  if (count === 1) return `${count} ${singular}`;
  return `${count.toLocaleString()} ${plural}`;
}
