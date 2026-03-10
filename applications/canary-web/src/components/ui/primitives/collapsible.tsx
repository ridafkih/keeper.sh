import { type PropsWithChildren, type ReactNode } from "react";
import { tv } from "tailwind-variants/lite";

const collapsible = tv({
  base: "group",
});

const collapsibleTrigger = tv({
  base: "flex w-full items-center justify-between gap-8 px-4 py-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden text-foreground hover:text-foreground-muted",
});

const collapsibleIcon = tv({
  base: "size-4 text-foreground-muted group-open:rotate-180 flex-shrink-0",
});

const collapsibleContent = tv({
  base: "px-4 pb-4",
});

type CollapsibleProps = PropsWithChildren<{
  trigger: ReactNode;
  className?: string;
}>;

export function Collapsible({ trigger, children, className }: CollapsibleProps) {
  return (
    <details
      className={collapsible({ className })}
    >
      <summary className={collapsibleTrigger()}>
        {trigger}
        <svg
          className={collapsibleIcon()}
          width="16"
          height="16"
          viewBox="0 0 15 15"
          fill="none"
        >
          <path
            d="M3.13523 6.15803C3.3241 5.95657 3.64052 5.94637 3.84197 6.13523L7.5 9.56464L11.158 6.13523C11.3595 5.94637 11.6759 5.95657 11.8648 6.15803C12.0536 6.35949 12.0434 6.67591 11.842 6.86477L7.84197 10.6148C7.64964 10.7951 7.35036 10.7951 7.15803 10.6148L3.15803 6.86477C2.95657 6.67591 2.94637 6.35949 3.13523 6.15803Z"
            fill="currentColor"
            fillRule="evenodd"
            clipRule="evenodd"
          />
        </svg>
      </summary>
      <div className={collapsibleContent()}>{children}</div>
    </details>
  );
}
