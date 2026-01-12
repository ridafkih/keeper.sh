"use client";

import type { FC } from "react";
import Image from "next/image";
import clsx from "clsx";

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
    className={clsx(
      "w-full flex items-center gap-2 py-1.5 px-2 rounded-xl text-left transition-colors",
      "hover:bg-neutral-50",
      selected && "bg-neutral-100"
    )}
  >
    <div className="size-5 shrink-0 flex items-center justify-center">
      <Image src={icon} alt={name} width={20} height={20} />
    </div>
    <span className="text-sm font-medium text-neutral-900">{name}</span>
  </button>
);

export { AccountListItem };
export type { AccountListItemProps };
