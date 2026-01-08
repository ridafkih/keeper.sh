import type { FC, PropsWithChildren } from "react";
import { ArrowRight, Plus } from "lucide-react";

const List: FC<PropsWithChildren> = ({ children }) => (
  <ul className="flex flex-col">{children}</ul>
);

interface ListItemProps {
  color?: string;
  title?: string;
}

const ListItem: FC<PropsWithChildren<ListItemProps>> = ({ children, color, title }) => (
  <li title={title} className="group flex items-center gap-2 py-1.5 px-3 -mx-3 rounded-lg hover:bg-neutral-100 transition-colors">
    {color && <span className="size-1 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
    <div className="flex items-center justify-between flex-1">
      {children}
    </div>
    <ArrowRight size={14} className="text-neutral-400" />
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
  <button
    type="button"
    onClick={onClick}
    className="flex items-center gap-2 py-1.5 px-3 -mx-3 rounded-lg hover:bg-neutral-100 transition-colors text-neutral-400 hover:text-neutral-500"
  >
    <span className="w-3.5 flex items-center justify-center shrink-0">
      <Plus size={14} />
    </span>
    <span className="text-sm flex-1 text-left">{children}</span>
    <ArrowRight size={14} />
  </button>
);

export { List, ListItem, ListItemLabel, ListItemValue, ListItemAdd };
