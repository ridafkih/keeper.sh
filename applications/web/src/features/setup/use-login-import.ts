import { useEffect } from "react";
import { apiFetch } from "@/lib/fetcher";
import { hasSessionFlag, resolveSessionStorage, setSessionFlag } from "./setup-draft-storage";

const LOGIN_IMPORT_KEY = "keeper.login_import_done";

const readFirstAccountId = (data: unknown): string | null => {
  if (typeof data !== "object" || data === null || !("accountIds" in data)) return null;
  const { accountIds } = data;
  if (!Array.isArray(accountIds)) return null;
  const [first] = accountIds;
  return typeof first === "string" ? first : null;
};

// A social signup already granted calendar access; this turns that grant into a connected account once.
export function useLoginImport(enabled: boolean, onImported: (accountId: string) => void) {
  useEffect(() => {
    if (!enabled) return;
    const storage = resolveSessionStorage();
    if (hasSessionFlag(storage, LOGIN_IMPORT_KEY)) return;
    setSessionFlag(storage, LOGIN_IMPORT_KEY);

    let cancelled = false;
    apiFetch("/api/accounts/import-login", { method: "POST" })
      .then((response) => response.json())
      .then((data) => {
        const accountId = readFirstAccountId(data);
        if (!cancelled && accountId) onImported(accountId);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [enabled, onImported]);
}
