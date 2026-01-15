"use client";

import type { FC } from "react";
import { useEffect, useRef } from "react";
import { Select, Input, Button, ButtonText, FormField } from "@keeper.sh/ui";

type FilterType =
  | "contains"
  | "does_not_contain"
  | "starts_before"
  | "ends_before"
  | "starts_after"
  | "ends_after"
  | "is_on_weekends"
  | "is_on_weekdays";

interface FilterPopoverContentProps {
  isAddMode: boolean;
  filterType: FilterType;
  filterValue: string;
  timeValue: string;
  timePeriod: "AM" | "PM";
  timezone: string;
  onFilterTypeChange: (type: FilterType) => void;
  onFilterValueChange: (value: string) => void;
  onTimeValueChange: (value: string) => void;
  onTimePeriodChange: (period: "AM" | "PM") => void;
  onTimezoneChange: (timezone: string) => void;
  onSave: () => void;
}

const FilterPopoverContent: FC<FilterPopoverContentProps> = ({
  isAddMode,
  filterType,
  filterValue,
  timeValue,
  timePeriod,
  timezone,
  onFilterTypeChange,
  onFilterValueChange,
  onTimeValueChange,
  onTimePeriodChange,
  onTimezoneChange,
  onSave,
}) => {
  const selectRef = useRef<HTMLSelectElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const timeInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus first input on open
  useEffect(() => {
    if (selectRef.current) {
      selectRef.current.focus();
    }
  }, []);

  // Handle Enter key to save
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSave();
    }
  };

  const isTextFilter = filterType === "contains" || filterType === "does_not_contain";
  const isTimeFilter = ["starts_before", "starts_after", "ends_before", "ends_after"].includes(filterType);
  const needsValue = filterType !== "is_on_weekends" && filterType !== "is_on_weekdays";

  return (
    <div className="flex flex-col gap-3" onKeyDown={handleKeyDown}>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-foreground">Filter Type</label>
        <Select
          ref={selectRef}
          value={filterType}
          onChange={(event) => onFilterTypeChange(event.target.value as FilterType)}
          size="small"
        >
          <option value="contains">Event summary contains</option>
          <option value="does_not_contain">Event summary does not contain</option>
          <option value="starts_before">Event starts before</option>
          <option value="starts_after">Event starts after</option>
          <option value="ends_before">Event ends before</option>
          <option value="ends_after">Event ends after</option>
          <option value="is_on_weekends">Event is on weekends</option>
          <option value="is_on_weekdays">Event is on weekdays</option>
        </Select>
      </div>

      {needsValue && (
        <>
          {isTextFilter && (
            <FormField
              ref={textInputRef}
              label="Value"
              type="text"
              value={filterValue}
              onChange={(event) => onFilterValueChange(event.target.value)}
              placeholder="Enter text..."
              size="small"
            />
          )}

          {isTimeFilter && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-foreground">Time</label>
                <div className="flex gap-2">
                  <Input
                    ref={timeInputRef}
                    type="time"
                    value={timeValue}
                    onChange={(event) => onTimeValueChange(event.target.value)}
                    className="flex-1"
                    size="small"
                  />
                  <Select
                    value={timePeriod}
                    onChange={(event) => onTimePeriodChange(event.target.value as "AM" | "PM")}
                    className="w-20"
                    size="small"
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-foreground">Timezone</label>
                <Select
                  value={timezone}
                  onChange={(event) => onTimezoneChange(event.target.value)}
                  size="small"
                >
                  <option value="EST">EST</option>
                  <option value="CST">CST</option>
                  <option value="MST">MST</option>
                  <option value="PST">PST</option>
                  <option value="UTC">UTC</option>
                </Select>
              </div>
            </>
          )}
        </>
      )}

      <Button onClick={onSave} size="small" className="w-full">
        <ButtonText>{isAddMode ? "Add Filter" : "Save Changes"}</ButtonText>
      </Button>
    </div>
  );
};

export { FilterPopoverContent };
export type { FilterType };
