import type { FC, PropsWithChildren, AnchorHTMLAttributes } from "react";
import type { VariantProps } from "tailwind-variants";
import { tv } from "tailwind-variants";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

const linkOutVariants = tv({
  base: "font-medium",
  variants: {
    variant: {
      default: "flex items-center gap-1 hover:underline",
      inline: "underline text-blue-500",
    },
    size: {
      default: "text-sm",
      small: "text-xs",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

type LinkOutVariantProps = VariantProps<typeof linkOutVariants>;

interface LinkOutBaseProps extends LinkOutVariantProps {
  className?: string;
}

interface LinkOutProps
  extends
    LinkOutBaseProps,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkOutBaseProps | "href"> {
  href: string;
}

const getArrowSize = (size: LinkOutVariantProps["size"]) => {
  if (size === "small") {
    return 12;
  }
  return 14;
};

interface LinkOutContentProps {
  variant: LinkOutVariantProps["variant"];
  size: LinkOutVariantProps["size"];
  children: React.ReactNode;
}

const LinkOutContent: FC<LinkOutContentProps> = ({ variant, size, children }) => {
  if (variant === "inline") {
    return children;
  }

  return (
    <>
      <span>{children}</span>
      <ArrowRight size={getArrowSize(size)} />
    </>
  );
};

const LinkOut: FC<PropsWithChildren<LinkOutProps>> = ({
  children,
  variant,
  size,
  className,
  href,
  ...linkProps
}) => {
  const resolvedClassName = linkOutVariants({ variant, size, className });

  return (
    <Link href={href} className={resolvedClassName} {...linkProps}>
      <LinkOutContent variant={variant} size={size}>
        {children}
      </LinkOutContent>
    </Link>
  );
};

export { LinkOut };
