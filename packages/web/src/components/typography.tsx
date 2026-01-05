import type { FC, PropsWithChildren } from "react";
import { tv } from "tailwind-variants";

type TextElement = "span" | "p" | "div" | "h1" | "h2" | "h3" | "h4" | "label";

interface TextProps {
  as?: TextElement;
  className?: string;
}

const _pageTitle = tv({ base: "text-2xl font-bold text-foreground" });
const _sectionTitle = tv({ base: "text-lg font-semibold text-foreground" });
const cardTitle = tv({
  base: "text-sm font-semibold text-foreground tracking-tight",
});
const subsectionTitle = tv({
  base: "text-md font-semibold text-foreground tracking-tighter",
});
const textBody = tv({ base: "text-sm text-foreground-muted" });
const textLabel = tv({ base: "text-sm font-medium text-foreground" });
const textMeta = tv({
  base: "text-xs font-medium text-foreground-muted tracking-tight",
});
const textCaption = tv({
  base: "text-xs text-foreground-muted tracking-tight",
});
const fieldLabel = tv({
  base: "text-xs font-medium text-foreground-secondary tracking-tight",
});
const fieldValue = tv({ base: "text-sm text-foreground tracking-tight" });
const textMuted = tv({ base: "text-sm text-foreground-subtle" });
const _dangerLabel = tv({ base: "text-sm font-medium text-destructive" });
const dangerText = tv({ base: "text-sm text-destructive" });
const dangerFieldLabel = tv({
  base: "text-xs font-medium text-destructive tracking-tight",
});
const dangerFieldValue = tv({
  base: "text-sm text-destructive tracking-tight",
});
const bannerText = tv({
  base: "text-sm",
  defaultVariants: {
    variant: "warning",
  },
  variants: {
    variant: {
      info: "text-info",
      success: "text-success-emphasis",
      warning: "text-warning",
    },
  },
});

const CardTitle: FC<PropsWithChildren<TextProps>> = ({
  as: Component = "h3",
  className,
  children,
}) => <Component className={cardTitle({ className })}>{children}</Component>;

const SubsectionTitle: FC<PropsWithChildren<TextProps>> = ({
  as: Component = "h2",
  className,
  children,
}) => <Component className={subsectionTitle({ className })}>{children}</Component>;

const TextBody: FC<PropsWithChildren<TextProps>> = ({
  as: Component = "p",
  className,
  children,
}) => <Component className={textBody({ className })}>{children}</Component>;

const TextLabel: FC<PropsWithChildren<TextProps>> = ({
  as: Component = "span",
  className,
  children,
}) => <Component className={textLabel({ className })}>{children}</Component>;

const TextMeta: FC<PropsWithChildren<TextProps>> = ({
  as: Component = "span",
  className,
  children,
}) => <Component className={textMeta({ className })}>{children}</Component>;

const TextCaption: FC<PropsWithChildren<TextProps>> = ({
  as: Component = "span",
  className,
  children,
}) => <Component className={textCaption({ className })}>{children}</Component>;

interface FieldLabelProps extends TextProps {
  htmlFor?: string;
}

const FieldLabel: FC<PropsWithChildren<FieldLabelProps>> = ({
  as: Component = "label",
  className,
  htmlFor,
  children,
}) => (
  <Component htmlFor={htmlFor} className={fieldLabel({ className })}>
    {children}
  </Component>
);

const FieldValue: FC<PropsWithChildren<TextProps>> = ({
  as: Component = "span",
  className,
  children,
}) => <Component className={fieldValue({ className })}>{children}</Component>;

const TextMuted: FC<PropsWithChildren<TextProps>> = ({
  as: Component = "span",
  className,
  children,
}) => <Component className={textMuted({ className })}>{children}</Component>;

const DangerText: FC<PropsWithChildren<TextProps>> = ({
  as: Component = "span",
  className,
  children,
}) => <Component className={dangerText({ className })}>{children}</Component>;

const DangerFieldLabel: FC<PropsWithChildren<TextProps>> = ({
  as: Component = "span",
  className,
  children,
}) => <Component className={dangerFieldLabel({ className })}>{children}</Component>;

const DangerFieldValue: FC<PropsWithChildren<TextProps>> = ({
  as: Component = "span",
  className,
  children,
}) => <Component className={dangerFieldValue({ className })}>{children}</Component>;

type BannerVariant = "warning" | "info" | "success";

interface BannerTextProps extends TextProps {
  variant?: BannerVariant;
}

const BannerText: FC<PropsWithChildren<BannerTextProps>> = ({
  as: Component = "span",
  variant = "warning",
  className,
  children,
}) => <Component className={bannerText({ className, variant })}>{children}</Component>;

export {
  CardTitle,
  SubsectionTitle,
  TextBody,
  TextLabel,
  TextMeta,
  TextCaption,
  FieldLabel,
  FieldValue,
  TextMuted,
  DangerText,
  DangerFieldLabel,
  DangerFieldValue,
  BannerText,
};
