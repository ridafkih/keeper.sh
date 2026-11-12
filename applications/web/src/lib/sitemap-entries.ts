export interface SitemapEntry {
  path: string;
  lastmod?: string;
}

export function dedupeSitemapEntries(entries: SitemapEntry[]): SitemapEntry[] {
  const byPath = new Map<string, SitemapEntry>();
  for (const entry of entries) byPath.set(entry.path, entry);
  return [...byPath.values()];
}
