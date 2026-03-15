import useSWR from "swr";
import { authClient } from "../lib/auth-client";

export interface SessionUser {
  id: string;
  email?: string;
  name?: string;
  username?: string;
}

const fetchSession = async (): Promise<SessionUser | null> => {
  const { data } = await authClient.getSession();
  if (!data?.user) return null;
  const username =
    "username" in data.user && typeof data.user.username === "string"
      ? data.user.username
      : undefined;
  const { id, email, name } = data.user;
  return { id, email, name, username };
};

export function useSession() {
  const { data: user, error, isLoading } = useSWR("auth/session", fetchSession, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  });
  return { user: user ?? null, error, isLoading };
}
