import { type ReactNode, useSyncExternalStore } from "react";
import { hasSessionCookie } from "../../../lib/session-cookie";

interface SessionSlotProps {
  authenticated: ReactNode;
  unauthenticated: ReactNode;
}

const subscribe = () => () => {};
const getSnapshot = () => hasSessionCookie();
const getServerSnapshot = () => false;

export function SessionSlot({ authenticated, unauthenticated }: SessionSlotProps) {
  const isAuthenticated = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return isAuthenticated ? authenticated : unauthenticated;
}
