"use client";

import type { FC, PropsWithChildren } from "react";

import { useSyncHoverSetter } from "../contexts/sync-hover-context";
import { ButtonLink } from "../../../components/button-link";

const SyncCalendarsButton: FC<PropsWithChildren> = ({ children }) => {
  const setIsSyncHovered = useSyncHoverSetter();

  return (
    <ButtonLink
      href="/playground/register"
      variant="primary"
      onMouseEnter={() => setIsSyncHovered(true)}
      onMouseLeave={() => setIsSyncHovered(false)}
    >
      {children}
    </ButtonLink>
  );
};

export { SyncCalendarsButton };
