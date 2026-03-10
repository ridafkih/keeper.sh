import { type ReactNode, useSyncExternalStore } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { hasSessionCookie } from "../../../lib/session-cookie";

interface SessionSlotProps {
  authenticated: ReactNode;
  unauthenticated: ReactNode;
}

const subscribe = () => () => {};
const getSnapshot = () => hasSessionCookie();

export function SessionSlot({ authenticated, unauthenticated }: SessionSlotProps) {
  const { auth } = useRouteContext({ strict: false });
  const getServerSnapshot = () => auth?.hasSession() ?? false;
  const isAuthenticated = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return isAuthenticated ? authenticated : unauthenticated;
}
