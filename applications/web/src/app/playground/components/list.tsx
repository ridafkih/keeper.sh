"use client";

import type { FC, PropsWithChildren, ReactNode } from "react";
import { createContext, useContext, useEffect, useId, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, Check, Plus } from "lucide-react";
import { tv } from "tailwind-variants";
import { cn } from "../utils/cn";

const checkboxIndicatorVariants = tv({
  base: "size-4 rounded-md border flex items-center justify-center transition-colors",
  variants: {
    checked: {
      true: "bg-neutral-800 border-neutral-800",
      false: "bg-white border-neutral-300",
    },
  },
  defaultVariants: {
    checked: false,
  },
});

interface ListContextValue {
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  indicatorLayoutId: string;
}

const ListContext = createContext<ListContextValue | null>(null);

const useListContext = (): ListContextValue => {
  const context = useContext(ListContext);
  if (!context) {
    throw new Error("List components must be used within a List");
  }
  return context;
};

interface ListProps {
  className?: string;
}

const List: FC<PropsWithChildren<ListProps>> = ({ children, className }) => {
  const indicatorLayoutId = useId();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <ListContext.Provider value={{ activeId, setActiveId, selectedId, setSelectedId, indicatorLayoutId }}>
      <ul className={cn("flex flex-col", className)}>{children}</ul>
    </ListContext.Provider>
  );
};

interface ListItemProps {
  id: string;
  children: ReactNode;
}

const ListItem: FC<ListItemProps> = ({ id, children }) => {
  const { activeId, setActiveId, indicatorLayoutId } = useListContext();
  const isActive = activeId === id;

  return (
    <li
      className="relative -mx-4 px-4 py-2 cursor-default"
      onMouseEnter={() => setActiveId(id)}
      onMouseLeave={() => setActiveId(null)}
    >
      {isActive && (
        <motion.div
          layoutId={indicatorLayoutId}
          className="absolute inset-0 bg-neutral-100 rounded-lg"
          transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
        />
      )}
      <div className="relative z-10 flex items-center justify-between">
        {children}
      </div>
    </li>
  );
};

const ListItemLabel: FC<PropsWithChildren> = ({ children }) => (
  <span className="text-xs text-neutral-900">{children}</span>
);

const ListItemValue: FC<PropsWithChildren> = ({ children }) => (
  <span className="text-xs text-neutral-400">{children}</span>
);

interface ListItemLinkProps {
  id: string;
  href: string;
  children: ReactNode;
}

const ListItemLink: FC<ListItemLinkProps> = ({ id, href, children }) => {
  const { activeId, setActiveId, indicatorLayoutId } = useListContext();
  const isActive = activeId === id;

  return (
    <li
      className="relative -mx-4 cursor-pointer"
      onMouseEnter={() => setActiveId(id)}
      onMouseLeave={() => setActiveId(null)}
    >
      {isActive && (
        <motion.div
          layoutId={indicatorLayoutId}
          className="absolute inset-0 bg-neutral-100 rounded-lg"
          transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
        />
      )}
      <Link href={href} className="relative z-10 flex items-center justify-between px-4 py-2">
        {children}
      </Link>
    </li>
  );
};

interface ListItemCheckboxProps {
  id: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  children: ReactNode;
}

const ListItemCheckbox: FC<ListItemCheckboxProps> = ({
  id,
  checked,
  defaultChecked,
  onChange,
  children,
}) => {
  const { activeId, setActiveId, indicatorLayoutId } = useListContext();
  const isActive = activeId === id;
  const [internalChecked, setInternalChecked] = useState(defaultChecked ?? false);
  const isChecked = checked ?? internalChecked;

  const handleClick = () => {
    const newValue = !isChecked;
    setInternalChecked(newValue);
    onChange?.(newValue);
  };

  return (
    <li
      className="relative -mx-4 cursor-pointer"
      onMouseEnter={() => setActiveId(id)}
      onMouseLeave={() => setActiveId(null)}
    >
      {isActive && (
        <motion.div
          layoutId={indicatorLayoutId}
          className="absolute inset-0 bg-neutral-100 rounded-lg"
          transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
        />
      )}
      <button
        type="button"
        onClick={handleClick}
        className="relative z-10 flex items-center justify-between px-4 py-2 w-full text-left"
      >
        {children}
        <div className={checkboxIndicatorVariants({ checked: isChecked })}>
          {isChecked && <Check size={10} strokeWidth={2.5} className="text-white" />}
        </div>
      </button>
    </li>
  );
};

interface ListItemButtonProps {
  id: string;
  onClick?: () => void;
  selected?: boolean;
}

const ListItemButton: FC<PropsWithChildren<ListItemButtonProps>> = ({ id, children, onClick, selected }) => {
  const { activeId, setActiveId, selectedId, setSelectedId, indicatorLayoutId } = useListContext();
  const isActive = activeId === id;
  const isSelected = selectedId === id;
  // Show indicator if: hovering this item, OR (this item is selected AND nothing is being hovered)
  const showIndicator = isActive || (isSelected && activeId === null);

  useEffect(() => {
    if (selected) {
      setSelectedId(id);
    }
  }, [selected, id, setSelectedId]);

  const handleClick = () => {
    setSelectedId(id);
    onClick?.();
  };

  return (
    <li
      className="relative -mx-4 cursor-pointer"
      onMouseEnter={() => setActiveId(id)}
      onMouseLeave={() => setActiveId(null)}
    >
      {showIndicator && (
        <motion.div
          layoutId={indicatorLayoutId}
          className="absolute inset-0 bg-neutral-100 rounded-lg"
          transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
        />
      )}
      <button
        type="button"
        onClick={handleClick}
        className="relative z-10 flex items-center gap-2 w-full px-4 py-2"
      >
        <div className="flex items-center justify-between flex-1">{children}</div>
        <ArrowRight size={14} className="text-neutral-400" />
      </button>
    </li>
  );
};

interface ListItemAddProps {
  children: string;
  onClick?: () => void;
}

const ListItemAdd: FC<ListItemAddProps> = ({ children, onClick }) => {
  const { activeId, setActiveId, indicatorLayoutId } = useListContext();
  const isActive = activeId === "add";

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setActiveId("add")}
      onMouseLeave={() => setActiveId(null)}
      className="relative -mx-4 px-4 py-2 flex items-center gap-2 text-neutral-400 hover:text-neutral-500"
    >
      {isActive && (
        <motion.div
          layoutId={indicatorLayoutId}
          className="absolute inset-0 bg-neutral-100 rounded-lg"
          transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
        />
      )}
      <Plus size={14} className="relative z-10" />
      <span className="relative z-10 text-xs">{children}</span>
    </button>
  );
};

export { List, ListItem, ListItemLink, ListItemCheckbox, ListItemButton, ListItemLabel, ListItemValue, ListItemAdd };
