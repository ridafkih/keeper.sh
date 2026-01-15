"use client";

import type { FC } from "react";
import { cn } from "../../../utils/cn";
import { Copy } from "../../../components/copy";

interface AccountListItemProps {
  icon: string;
  name: string;
  selected?: boolean;
  onSelect?: () => void;
}

const AccountListItem: FC<AccountListItemProps> = ({
  icon,
  name,
  selected,
  onSelect,
}) => (
  <button
    type="button"
    onClick={onSelect}
    className={cn(
      "w-full flex items-center gap-2 py-1.5 px-2 rounded-xl text-left transition-colors",
      "hover:bg-surface-subtle",
      selected && "bg-surface-muted"
    )}
  >
    <div className="size-5 shrink-0 flex items-center justify-center">
      <img src={icon} alt={name} className="size-5" />
    </div>
    <Copy as="span" size="sm" weight="medium" color="primary">{name}</Copy>
  </button>
);

export { AccountListItem };
export type { AccountListItemProps };
