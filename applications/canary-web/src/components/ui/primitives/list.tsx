import type { ComponentPropsWithoutRef, PropsWithChildren } from "react";

type ListProps = PropsWithChildren<ComponentPropsWithoutRef<"ul">>;
type OrderedListProps = PropsWithChildren<ComponentPropsWithoutRef<"ol">>;
type ListItemProps = PropsWithChildren<ComponentPropsWithoutRef<"li">>;

export function UnorderedList({ children, className, ...props }: ListProps) {
  return (
    <ul
      className={[
        "my-4 list-disc space-y-1.5 pl-6 text-base leading-7 tracking-tight text-foreground-muted marker:text-foreground-muted",
        className,
      ].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </ul>
  );
}

export function OrderedList({ children, className, ...props }: OrderedListProps) {
  return (
    <ol
      className={[
        "my-4 list-decimal space-y-1.5 pl-6 text-base leading-7 tracking-tight text-foreground-muted marker:text-foreground-muted",
        className,
      ].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </ol>
  );
}

export function ListItem({ children, className, ...props }: ListItemProps) {
  return (
    <li
      className={[
        "pl-1 leading-7 [&>ol]:mt-2 [&>p]:my-0 [&>ul]:mt-2",
        className,
      ].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </li>
  );
}
