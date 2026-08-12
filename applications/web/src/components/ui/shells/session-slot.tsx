import type { ReactNode } from "react";

interface SessionSlotProps {
  authenticated: ReactNode;
  unauthenticated: ReactNode;
}

export function SessionSlot({ authenticated, unauthenticated }: SessionSlotProps) {
  return (
    <>
      <span data-session-slot="authenticated">{authenticated}</span>
      <span data-session-slot="unauthenticated">{unauthenticated}</span>
    </>
  );
}
