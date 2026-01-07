"use client";

import type { FC, PropsWithChildren } from "react";

import { useSyncHoverSetter } from "../contexts/sync-hover-context";
import { Button } from "../../../components/button";

const SyncCalendarsButton: FC<PropsWithChildren> = ({ children }) => {
  const setIsSyncHovered = useSyncHoverSetter();

  return (
    <Button
      variant="primary"
      onMouseEnter={() => setIsSyncHovered(true)}
      onMouseLeave={() => setIsSyncHovered(false)}
    >
      {children}
    </Button>
  );
};

export { SyncCalendarsButton };
