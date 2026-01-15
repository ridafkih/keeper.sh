import type { FC } from "react";

const LateralDivider = () => (
  <div className="flex-1 h-px bg-[repeating-linear-gradient(to_right,var(--color-border-input),var(--color-border-input)_0.25rem,transparent_0.25rem,transparent_0.5rem)]" />
);

const FormDivider: FC = () => (
  <div className="flex items-center gap-2">
    <LateralDivider />
    <span className="text-xs text-foreground-subtle">or</span>
    <LateralDivider />
  </div>
);

const Divider: FC = () => (
  <div className="border-t border-border" />
);

FormDivider.displayName = "FormDivider";
Divider.displayName = "Divider";
LateralDivider.displayName = "LateralDivider";

export { FormDivider, Divider, LateralDivider };
