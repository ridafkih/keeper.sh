import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { useSession } from "@/hooks/use-session";
import { hasImportedLogin, markLoginImported, resolveSessionStorage, type DraftStorage } from "./setup-draft-storage";

export type LoginImportStatus = "idle" | "importing" | "failed" | "done";

export type LoginImportRequest = () => Promise<unknown>;

const requestLoginImport: LoginImportRequest = async () => {
  const response = await apiFetch("/api/accounts/import-login", { method: "POST" });
  return response.json();
};

// The server answers `{ imported: false }` for anyone who isn't a fresh signup, which imports nothing.
export const readImportedAccountIds = (data: unknown): string[] => {
  if (typeof data !== "object" || data === null || !("accountIds" in data)) return [];
  const { accountIds } = data;
  if (!Array.isArray(accountIds)) return [];
  return accountIds.filter((id): id is string => typeof id === "string");
};

// Marked done only once the server has answered, so a failed request can be tried again.
export const runLoginImport = async (
  storage: DraftStorage | null,
  userId: string,
  request: LoginImportRequest,
): Promise<string[]> => {
  const data = await request();
  markLoginImported(storage, userId);
  return readImportedAccountIds(data);
};

// A social signup already granted calendar access; this turns that grant into a connected account.
export function useLoginImport(
  enabled: boolean,
  onImported: (accountId: string) => Promise<unknown> | void,
  request: LoginImportRequest = requestLoginImport,
) {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const [status, setStatus] = useState<LoginImportStatus>("idle");
  const [attempt, setAttempt] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !userId || startedRef.current) return;
    const storage = resolveSessionStorage();
    if (hasImportedLogin(storage, userId)) return;
    startedRef.current = true;

    const run = async () => {
      setStatus("importing");
      let accountIds: string[];
      try {
        accountIds = await runLoginImport(storage, userId, request);
      } catch {
        setStatus("failed");
        return;
      }
      const [first] = accountIds;
      if (first) await onImported(first);
      setStatus("done");
    };
    void run();
  }, [enabled, userId, onImported, request, attempt]);

  const retry = useCallback(() => {
    startedRef.current = false;
    setAttempt((current) => current + 1);
  }, []);

  return { retry, status };
}
