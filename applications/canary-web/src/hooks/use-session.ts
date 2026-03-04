import useSWR from "swr";
import { authClient } from "../lib/auth-client";

export interface SessionUser {
  id: string;
  email?: string;
  name?: string;
}

const fetchSession = async (): Promise<SessionUser | null> => {
  const { data } = await authClient.getSession();
  if (!data?.user) return null;
  const { id, email, name } = data.user;
  return { id, email, name };
};

export function useSession() {
  const { data: user, error, isLoading } = useSWR("auth/session", fetchSession, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  });
  return { user: user ?? null, error, isLoading };
}
