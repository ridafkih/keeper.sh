import {
  billingPeriodSchema,
  type BillingPeriod,
} from "@keeper.sh/data-schemas";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toggle } from "@base-ui/react/toggle";

export type { BillingPeriod };

interface BillingPeriodToggleProps {
  value: BillingPeriod;
  onChange: (value: BillingPeriod) => void;
}

export function BillingPeriodToggle({
  value,
  onChange,
}: BillingPeriodToggleProps) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(values) => {
        if (values.length > 0) {
          onChange(billingPeriodSchema.assert(values[0]));
        }
      }}
      className="inline-grid grid-cols-2 rounded-md border border-zinc-200 p-0.5 bg-zinc-50"
    >
      <Toggle
        value="monthly"
        className="px-3 py-1.5 text-xs font-medium tracking-tight rounded transition-colors text-zinc-600 hover:text-zinc-900 data-pressed:bg-white data-pressed:text-zinc-900 data-pressed:shadow-sm cursor-pointer"
      >
        Monthly
      </Toggle>
      <Toggle
        value="yearly"
        className="px-3 py-1.5 text-xs font-medium tracking-tight rounded transition-colors text-zinc-600 hover:text-zinc-900 data-pressed:bg-white data-pressed:text-zinc-900 data-pressed:shadow-sm cursor-pointer"
      >
        Yearly
        <span className="ml-1.5 inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
          -50%
        </span>
      </Toggle>
    </ToggleGroup>
  );
}
