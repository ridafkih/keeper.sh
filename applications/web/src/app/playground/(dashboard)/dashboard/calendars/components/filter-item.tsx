import type { FC } from "react";
import { memo } from "react";
import { X } from "lucide-react";
import { ListItem } from "@keeper.sh/ui";
import type { Filter } from "../types";

interface FilterItemProps {
  filter: Filter;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

export const FilterItem: FC<FilterItemProps> = memo(({ filter, onEdit, onRemove }) => {
  const renderFilterText = () => {
    switch (filter.type) {
      case "is_on_weekends":
        return (
          <>
            <span className="text-foreground-subtle">event is </span>
            <span className="text-foreground">on weekends</span>
          </>
        );
      case "is_on_weekdays":
        return (
          <>
            <span className="text-foreground-subtle">event is </span>
            <span className="text-foreground">on weekdays</span>
          </>
        );
      case "contains":
        return (
          <>
            <span className="text-foreground-subtle">event summary </span>
            <span className="text-foreground">contains</span>
            <span className="text-foreground-subtle"> </span>
            <span className="text-foreground">"{filter.value}"</span>
          </>
        );
      case "does_not_contain":
        return (
          <>
            <span className="text-foreground-subtle">event summary </span>
            <span className="text-foreground">does not contain</span>
            <span className="text-foreground-subtle"> </span>
            <span className="text-foreground">"{filter.value}"</span>
          </>
        );
      case "starts_before":
        return (
          <>
            <span className="text-foreground-subtle">event starts </span>
            <span className="text-foreground">before</span>
            <span className="text-foreground-subtle"> </span>
            <span className="text-foreground">{filter.value}</span>
          </>
        );
      case "starts_after":
        return (
          <>
            <span className="text-foreground-subtle">event starts </span>
            <span className="text-foreground">after</span>
            <span className="text-foreground-subtle"> </span>
            <span className="text-foreground">{filter.value}</span>
          </>
        );
      case "ends_before":
        return (
          <>
            <span className="text-foreground-subtle">event ends </span>
            <span className="text-foreground">before</span>
            <span className="text-foreground-subtle"> </span>
            <span className="text-foreground">{filter.value}</span>
          </>
        );
      case "ends_after":
        return (
          <>
            <span className="text-foreground-subtle">event ends </span>
            <span className="text-foreground">after</span>
            <span className="text-foreground-subtle"> </span>
            <span className="text-foreground">{filter.value}</span>
          </>
        );
    }
  };

  return (
    <ListItem id={filter.id}>
      <button
        type="button"
        onClick={() => onEdit(filter.id)}
        className="flex-1 text-left"
      >
        <div className="text-xs">
          {renderFilterText()}
        </div>
      </button>
      <button
        type="button"
        onClick={() => onRemove(filter.id)}
        className="text-foreground-subtle hover:text-foreground-secondary transition-colors"
      >
        <X size={14} />
      </button>
    </ListItem>
  );
});

FilterItem.displayName = "FilterItem";
