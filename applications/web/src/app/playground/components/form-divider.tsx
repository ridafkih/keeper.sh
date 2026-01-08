import type { FC } from "react";

const LateralDivider = () => (
  <div className="flex-1 h-px bg-[repeating-linear-gradient(to_right,var(--color-neutral-300),var(--color-neutral-300)_0.25rem,transparent_0.25rem,transparent_0.5rem)]" />
);

const FormDivider: FC = () => (
  <div className="flex items-center gap-2">
    <LateralDivider />
    <span className="text-xs text-neutral-400">or</span>
    <LateralDivider />
  </div>
);

export { FormDivider };
