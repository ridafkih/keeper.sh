type TextElement = "span" | "p" | "div" | "h1" | "h2" | "h3" | "h4" | "label";

interface TextProps {
  as?: TextElement;
  className?: string;
  children?: React.ReactNode;
}

export function PageTitle({
  as: Component = "h1",
  className = "",
  children,
}: TextProps) {
  return (
    <Component className={`text-2xl font-bold text-zinc-900 ${className}`}>
      {children}
    </Component>
  );
}

export function SectionTitle({
  as: Component = "h2",
  className = "",
  children,
}: TextProps) {
  return (
    <Component className={`text-lg font-semibold text-zinc-900 ${className}`}>
      {children}
    </Component>
  );
}

export function TextBody({
  as: Component = "p",
  className = "",
  children,
}: TextProps) {
  return (
    <Component className={`text-sm text-zinc-500 ${className}`}>
      {children}
    </Component>
  );
}

export function TextLabel({
  as: Component = "span",
  className = "",
  children,
}: TextProps) {
  return (
    <Component className={`text-sm font-medium text-zinc-900 ${className}`}>
      {children}
    </Component>
  );
}

export function TextMeta({
  as: Component = "span",
  className = "",
  children,
}: TextProps) {
  return (
    <Component className={`text-xs font-medium text-zinc-500 ${className}`}>
      {children}
    </Component>
  );
}

export function TextMuted({
  as: Component = "span",
  className = "",
  children,
}: TextProps) {
  return (
    <Component className={`text-sm text-zinc-400 ${className}`}>
      {children}
    </Component>
  );
}

export function DangerLabel({
  as: Component = "span",
  className = "",
  children,
}: TextProps) {
  return (
    <Component className={`text-sm font-medium text-red-600 ${className}`}>
      {children}
    </Component>
  );
}

export function DangerText({
  as: Component = "span",
  className = "",
  children,
}: TextProps) {
  return (
    <Component className={`text-sm text-red-600 ${className}`}>
      {children}
    </Component>
  );
}

type BannerVariant = "warning" | "info" | "success";

const bannerVariantClasses: Record<BannerVariant, string> = {
  warning: "text-amber-800",
  info: "text-blue-800",
  success: "text-green-800",
};

interface BannerTextProps extends TextProps {
  variant?: BannerVariant;
}

export function BannerText({
  as: Component = "span",
  variant = "warning",
  className = "",
  children,
}: BannerTextProps) {
  return (
    <Component
      className={`text-sm ${bannerVariantClasses[variant]} ${className}`}
    >
      {children}
    </Component>
  );
}
