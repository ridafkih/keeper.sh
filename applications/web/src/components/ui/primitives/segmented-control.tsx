import { cn } from "@/utils/cn";

interface SegmentedControlProps<TValue extends string> {
  label: string;
  options: { label: string; value: TValue }[];
  value: TValue;
  onChange: (value: TValue) => void;
  disabled?: boolean;
}

export function SegmentedControl<TValue extends string>({ label, options, value, onChange, disabled }: SegmentedControlProps<TValue>) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-fit items-center rounded-lg bg-background-hover p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          disabled={disabled}
          onClick={() => option.value !== value && onChange(option.value)}
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
