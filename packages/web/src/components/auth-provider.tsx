"use client";

import type { FC, PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import { userSchema, type User } from "@keeper.sh/data-schemas";
import { authClient } from "@/lib/auth-client";
import { protectedRoutes } from "@/config/routes";
import { identify, track } from "@/lib/analytics";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const isProtectedRoute = (pathname: string): boolean =>
  protectedRoutes.some((route) => pathname.startsWith(route));

const fetchSession = async (): Promise<User | null> => {
  const { data } = await authClient.getSession();
  if (!data?.user) return null;
  return userSchema.assert(data.user);
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: FC<PropsWithChildren> = ({ children }) => {
  const router = useRouter();
  const pathname = usePathname();
  const { data: user, isLoading, mutate } = useSWR("session", fetchSession);
  const identifiedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (user) return;
    if (!isProtectedRoute(pathname)) return;

    router.replace("/login");
  }, [user, isLoading, pathname, router]);

  useEffect(() => {
    if (isLoading || !user) return;
    if (identifiedUserId.current === user.id) return;

    identifiedUserId.current = user.id;
    identify({ id: user.id, email: user.email, name: user.name });
  }, [user, isLoading]);

  const refresh = async () => {
    await mutate();
  };

  return (
    <AuthContext.Provider value={{ user: user ?? null, isLoading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
