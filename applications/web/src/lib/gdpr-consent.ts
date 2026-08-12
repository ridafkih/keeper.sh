const GDPR_COOKIE = "keeper.gdpr";
const GDPR_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const GDPR_ENDPOINT = "/internal/geo";
const GDPR_PROMISE_KEY = "__KEEPER_GDPR__";

type GdprListener = () => void;

const listeners = new Set<GdprListener>();
let resolution: Promise<unknown> | null = null;

function readCookieSource(): string {
  if (typeof document === "undefined") return "";
  return document.cookie;
}

function readGdprCookie(): boolean | null {
  const prefix = `${GDPR_COOKIE}=`;
  const match = readCookieSource()
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix));

  if (!match) return null;

  const value = match.slice(prefix.length);
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

const gdprApplies = (): boolean => readGdprCookie() ?? true;

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

async function fetchGdprApplies(): Promise<boolean> {
  const response = await fetch(GDPR_ENDPOINT, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Region lookup failed with status ${response.status}.`);
  }

  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Region lookup returned a non-object payload.");
  }

  const applies = Reflect.get(payload, "gdprApplies");
  if (typeof applies !== "boolean") {
    throw new Error("Region lookup returned no boolean gdprApplies field.");
  }

  document.cookie = `${GDPR_COOKIE}=${applies ? "1" : "0"}; path=/; max-age=${GDPR_COOKIE_MAX_AGE}; samesite=lax`;
  return applies;
}

function pendingLookup(): Promise<unknown> {
  const documentLookup = window[GDPR_PROMISE_KEY];
  if (documentLookup) return documentLookup;
  return fetchGdprApplies();
}

function resolveGdprApplies(): void {
  if (typeof window === "undefined") return;
  if (readGdprCookie() !== null) return;
  if (resolution) return;

  resolution = pendingLookup()
    .then(notifyListeners)
    .catch((error: unknown) => {
      console.error(`[gdpr] ${GDPR_ENDPOINT} lookup failed, keeping the consent banner visible:`, error);
    });
}

function subscribeToGdprChanges(listener: GdprListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

declare global {
  interface Window {
    [GDPR_PROMISE_KEY]?: Promise<boolean>;
  }
}

export {
  GDPR_COOKIE,
  GDPR_COOKIE_MAX_AGE,
  GDPR_ENDPOINT,
  GDPR_PROMISE_KEY,
  gdprApplies,
  resolveGdprApplies,
  subscribeToGdprChanges,
};
