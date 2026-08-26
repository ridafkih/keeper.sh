import { outlookCategoryListSchema } from "@keeper.sh/data-schemas";
import { MICROSOFT_GRAPH_API } from "../../shared/api";
import { resolveOutlookCategoryColor } from "../../../../core/colors/normalize";
import { buildTimeoutSignal } from "../../../../core/utils/fetch-with-timeout";

const REQUEST_TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 600_000;

interface CategoryColorsCacheEntry {
  colors: ReadonlyMap<string, string>;
  expiresAt: number;
}

/*
 * Keyed by access token: the per-calendar ingest loop carries no account
 * handle, and one token identifies one account for the length of a run.
 */
const categoryColorsCache = new Map<string, CategoryColorsCacheEntry>();

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

const getMasterCategoryColors = async (
  accessToken: string,
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, string> | null> => {
  const now = Date.now();
  for (const [token, entry] of categoryColorsCache) {
    if (entry.expiresAt <= now) {
      categoryColorsCache.delete(token);
    }
  }

  const cached = categoryColorsCache.get(accessToken);
  if (cached) {
    return cached.colors;
  }

  try {
    const colors = await fetchMasterCategoryColors(accessToken, signal);
    categoryColorsCache.set(accessToken, { colors, expiresAt: now + CACHE_TTL_MS });
    return colors;
  } catch {
    /* Colors are cosmetic; a categories failure must never fail the ingest. */
    return null;
  }
};

const clearMasterCategoryColorsCache = (): void => {
  categoryColorsCache.clear();
};

export {
  clearMasterCategoryColorsCache,
  fetchMasterCategoryColors,
  getMasterCategoryColors,
};
