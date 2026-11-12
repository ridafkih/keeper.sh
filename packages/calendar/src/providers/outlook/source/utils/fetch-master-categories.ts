import { outlookCategoryListSchema } from "@keeper.sh/data-schemas";
import { MICROSOFT_GRAPH_API } from "../../shared/api";
import { resolveOutlookCategoryColor } from "../../../../core/colors/normalize";
import { buildTimeoutSignal } from "../../../../core/utils/fetch-with-timeout";

const REQUEST_TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 600_000;
const FAILURE_TTL_MS = 60_000;

interface CategoryColorsCacheEntry {
  colors: Promise<ReadonlyMap<string, string> | null>;
  expiresAt: number;
}

/* Keyed by token digest: the ingest loop carries no account handle, and bearer tokens must not outlive their request. */
const categoryColorsCache = new Map<string, CategoryColorsCacheEntry>();

const hashAccessToken = (accessToken: string): string =>
  new Bun.CryptoHasher("sha256").update(accessToken).digest("hex");

const fetchMasterCategoryColors = async (
  accessToken: string,
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, string>> => {
  const colors = new Map<string, string>();
  let url: string | undefined =
    `${MICROSOFT_GRAPH_API}/me/outlook/masterCategories?$select=displayName,color`;

  while (url) {
    const timeout = buildTimeoutSignal(REQUEST_TIMEOUT_MS, signal);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: timeout.signal,
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch master categories: ${response.status}`);
    }
    const page = outlookCategoryListSchema.assert(await response.json());
    for (const category of page.value ?? []) {
      const color = resolveOutlookCategoryColor(category.color);
      if (category.displayName && color) {
        colors.set(category.displayName.toLowerCase(), color);
      }
    }
    url = page["@odata.nextLink"];
  }

  return colors;
};

const getMasterCategoryColors = (
  accessToken: string,
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, string> | null> => {
  const now = Date.now();
  for (const [key, expiring] of categoryColorsCache) {
    if (expiring.expiresAt <= now) {
      categoryColorsCache.delete(key);
    }
  }

  const cacheKey = hashAccessToken(accessToken);
  const cached = categoryColorsCache.get(cacheKey);
  if (cached) {
    return cached.colors;
  }

  /* Colors are cosmetic; a categories failure must never fail the ingest. */
  const entry: CategoryColorsCacheEntry = {
    colors: fetchMasterCategoryColors(accessToken, signal).catch(() => {
      if (signal?.aborted) {
        categoryColorsCache.delete(cacheKey);
      } else {
        entry.expiresAt = Date.now() + FAILURE_TTL_MS;
      }
      return null;
    }),
    expiresAt: now + CACHE_TTL_MS,
  };
  categoryColorsCache.set(cacheKey, entry);
  return entry.colors;
};

const clearMasterCategoryColorsCache = (): void => {
  categoryColorsCache.clear();
};

export {
  clearMasterCategoryColorsCache,
  fetchMasterCategoryColors,
  getMasterCategoryColors,
};
