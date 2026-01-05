import { billingPeriodSchema, type BillingPeriod } from "@keeper.sh/data-schemas";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toggle } from "@base-ui/react/toggle";

export type { BillingPeriod };

interface BillingPeriodToggleProps {
  value: BillingPeriod;
  onChange: (value: BillingPeriod) => void;
}

export function BillingPeriodToggle({ value, onChange }: BillingPeriodToggleProps) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={([value]) => {
        if (!value) return;
        onChange(billingPeriodSchema.assert(value));
      }}
      className="inline-grid grid-cols-2 rounded-md border border-border p-0.5 bg-surface-subtle"
    >
      <Toggle
        value="monthly"
        className="px-3 py-1.5 text-xs font-medium tracking-tight rounded transition-colors text-foreground-secondary hover:text-foreground data-pressed:bg-surface data-pressed:text-foreground data-pressed:shadow-sm cursor-pointer"
      >
        Monthly
      </Toggle>
      <Toggle
        value="yearly"
        className="px-3 py-1.5 text-xs font-medium tracking-tight rounded transition-colors text-foreground-secondary hover:text-foreground data-pressed:bg-surface data-pressed:text-foreground data-pressed:shadow-sm cursor-pointer"
      >
        Yearly
        <span className="ml-1.5 inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-success-surface text-success-emphasis">
          -30%
        </span>
      </Toggle>
    </ToggleGroup>
  );
}
