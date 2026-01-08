import type { FC, PropsWithChildren } from "react";
import { Plus } from "lucide-react";

const List: FC<PropsWithChildren> = ({ children }) => (
  <ul className="flex flex-col">{children}</ul>
);

const ListItem: FC<PropsWithChildren> = ({ children }) => (
  <li className="flex items-center justify-between py-2 px-3 -mx-3 rounded-lg hover:bg-neutral-100 transition-colors">
    {children}
  </li>
);

const ListItemLabel: FC<PropsWithChildren> = ({ children }) => (
  <span className="text-sm text-neutral-900">{children}</span>
);

const ListItemValue: FC<PropsWithChildren> = ({ children }) => (
  <span className="text-xs text-neutral-400">{children}</span>
);

interface ListItemAddProps {
  children: string;
  onClick?: () => void;
}

const ListItemAdd: FC<ListItemAddProps> = ({ children, onClick }) => (
  <li>
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 w-full py-2 px-3 -mx-3 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
    >
      <Plus size={14} />
      <span className="text-sm">{children}</span>
    </button>
  </li>
);

export { List, ListItem, ListItemLabel, ListItemValue, ListItemAdd };
