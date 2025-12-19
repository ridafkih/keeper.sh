import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toggle } from "@base-ui/react/toggle";
import {
  billingToggleGroup,
  billingToggle,
  billingSavingsBadge,
} from "@/styles";

export type BillingPeriod = "monthly" | "yearly";

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
          onChange(values[0] as BillingPeriod);
        }
      }}
      className={billingToggleGroup()}
    >
      <Toggle value="monthly" className={billingToggle()}>
        Monthly
      </Toggle>
      <Toggle value="yearly" className={billingToggle()}>
        Yearly
        <span className={billingSavingsBadge()}>-50%</span>
      </Toggle>
    </ToggleGroup>
  );
}
