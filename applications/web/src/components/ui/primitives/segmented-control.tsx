import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/utils/cn";

interface SegmentedControlProps<TValue extends string> {
  label: string;
  options: { label: ReactNode; value: TValue }[];
  value: TValue;
  onChange: (value: TValue) => void;
  disabled?: boolean;
}

const STEP_KEYS: Record<string, number> = { ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1 };

const resolveSegmentKey = (key: string, index: number, count: number): number | null => {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const step = STEP_KEYS[key];
  if (step === undefined) return null;
  return (index + step + count) % count;
};

export function SegmentedControl<TValue extends string>({ label, options, value, onChange, disabled }: SegmentedControlProps<TValue>) {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const checkedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = resolveSegmentKey(event.key, index, options.length);
    if (next === null) return;
    event.preventDefault();
    buttonsRef.current[next]?.focus();
    const option = options[next];
    if (option && option.value !== value) onChange(option.value);
  };

  return (
    <div role="radiogroup" aria-label={label} className="flex w-fit items-center rounded-lg bg-background-hover p-0.5">
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => {
            buttonsRef.current[index] = element;
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={index === checkedIndex ? 0 : -1}
          disabled={disabled}
          onClick={() => option.value !== value && onChange(option.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
          className={cn(
            "rounded-md px-2.5 py-1 text-sm font-medium tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
            option.value === value
              ? "bg-background-elevated text-foreground shadow-xs"
              : "text-foreground-muted hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
