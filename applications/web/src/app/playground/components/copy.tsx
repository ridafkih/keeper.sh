import type { ElementType, ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

type CopyProps<AsComponent extends ElementType = "p"> = {
  as?: AsComponent;
  className?: string;
} & ComponentPropsWithoutRef<AsComponent>;

const Copy = <AsComponent extends ElementType = "p">({
  as,
  children,
  className,
  ...props
}: CopyProps<AsComponent>) => {
  const Component = as ?? "p";

  return (
    <Component
      className={cn("text-neutral-600 text-sm leading-relaxed", className)}
      {...props}
    >
      {children}
    </Component>
  );
};

export { Copy };
