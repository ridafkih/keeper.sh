import type { PropsWithChildren } from "react";
import { tv, type VariantProps } from "tailwind-variants/lite";
import { Heading2, Heading3 } from "../../../components/ui/primitives/heading";
import { Text } from "../../../components/ui/primitives/text";
import { ButtonText, LinkButton } from "../../../components/ui/primitives/button";
import CheckIcon from "lucide-react/dist/esm/icons/check";
import InfinityIcon from "lucide-react/dist/esm/icons/infinity";
import MinusIcon from "lucide-react/dist/esm/icons/minus";

type ClassNameProps = PropsWithChildren<{ className?: string }>;
type MarketingPricingCardProps = ClassNameProps & VariantProps<typeof marketingPricingCard>;
export type MarketingPricingFeatureValueKind =
  | "check"
  | "minus"
  | "infinity"
  | (string & {});

type MarketingPricingPlanCardProps = {
  tone?: "default" | "inverse";
  name: string;
  price: string;
  period: string;
  description: string;
  ctaLabel: string;
};

const marketingPricingCard = tv({
  base: "border rounded-2xl p-3 pt-5 flex flex-col shadow-xs",
  variants: {
    tone: {
      default: "border-interactive-border bg-background",
      inverse: "border-transparent bg-background-inverse",
    },
  },
  defaultVariants: {
    tone: "default",
  },
});

export function MarketingPricingSection({ children, id }: PropsWithChildren<{ id?: string }>) {
  return <section id={id} className="w-full md:px-0 pt-16 pb-4">{children}</section>;
}

export function MarketingPricingIntro({ children }: PropsWithChildren) {
  return <div className="max-w-[44ch] mx-auto flex flex-col gap-2">{children}</div>;
}

export function MarketingPricingComparisonGrid({ children }: PropsWithChildren) {
  return (
    <div className="mt-8 grid grid-cols-1 xs:grid-cols-2 md:grid-cols-[min-content_repeat(2,auto)] gap-x-2">{children}</div>
  );
}

export function MarketingPricingComparisonSpacer() {
  return <div className="hidden md:block" />;
}

export function MarketingPricingCard({
  children,
  className,
  tone,
}: MarketingPricingCardProps) {
  return (
    <article
      className={marketingPricingCard({ tone, className })}
    >
      {children}
    </article>
  );
}

export function MarketingPricingCardBody({ children }: PropsWithChildren) {
  return <div className="flex flex-col px-2">{children}</div>;
}

export function MarketingPricingCardCopy({ children }: PropsWithChildren) {
  return <div className="py-4">{children}</div>;
}

export function MarketingPricingCardAction({ children }: PropsWithChildren) {
  return <div className="mt-auto">{children}</div>;
}

const pricingPlanHeading = tv({
  variants: {
    tone: {
      default: "",
      inverse: "text-foreground-inverse",
    },
  },
  defaultVariants: {
    tone: "default",
  },
});

const pricingPlanButton = tv({
  base: "w-full justify-center",
  variants: {
    tone: {
      default: "",
      inverse: "border-transparent",
    },
  },
  defaultVariants: {
    tone: "default",
  },
});

const pricingFeatureValueDisplay = tv({
  variants: {
    tone: {
      default: "text-foreground",
      muted: "text-foreground-muted",
    },
  },
  defaultVariants: {
    tone: "default",
  },
});

function resolveCopyTone(tone: "default" | "inverse"): "inverseMuted" | "muted" {
  if (tone === "inverse") return "inverseMuted";
  return "muted";
}

export function MarketingPricingPlanCard({
  tone = "default",
  name,
  price,
  period,
  description,
  ctaLabel,
}: MarketingPricingPlanCardProps) {
  const copyTone = resolveCopyTone(tone);

  return (
    <MarketingPricingCard tone={tone}>
      <MarketingPricingCardBody>
        <Heading3 className={pricingPlanHeading({ tone })}>{name}</Heading3>
        <div className="flex items-baseline gap-1">
          <Heading2 className={pricingPlanHeading({ tone })}>{price}</Heading2>
          <Text size="sm" tone={copyTone} align="left">
            {period}
          </Text>
        </div>
        <MarketingPricingCardCopy>
          <Text size="sm" tone={copyTone} align="left">
            {description}
          </Text>
        </MarketingPricingCardCopy>
      </MarketingPricingCardBody>
      <MarketingPricingCardAction>
        <LinkButton variant="border" className={pricingPlanButton({ tone })} to="/register">
          <ButtonText>{ctaLabel}</ButtonText>
        </LinkButton>
      </MarketingPricingCardAction>
    </MarketingPricingCard>
  );
}

export function MarketingPricingFeatureMatrix({ children }: PropsWithChildren) {
  return <div className="hidden md:grid col-span-3 grid-cols-subgrid">{children}</div>;
}

export function MarketingPricingFeatureRow({ children }: PropsWithChildren) {
  return (
    <div className="col-span-3 grid grid-cols-subgrid border-b border-interactive-border">
      {children}
    </div>
  );
}

export function MarketingPricingFeatureLabel({ children }: PropsWithChildren) {
  return <div className="px-2 py-4 text-left">{children}</div>;
}

export function MarketingPricingFeatureValue({ children }: PropsWithChildren) {
  return <div className="flex justify-center py-4 tabular-nums">{children}</div>;
}

export function MarketingPricingFeatureDisplay({
  value,
  tone = "default",
}: {
  value: MarketingPricingFeatureValueKind;
  tone?: "muted" | "default";
}) {
  const className = pricingFeatureValueDisplay({ tone });

  if (value === "check") {
    return <CheckIcon size={16} className={className} />;
  }

  if (value === "minus") {
    return <MinusIcon size={16} className={className} />;
  }

  if (value === "infinity") {
    return <InfinityIcon size={16} className={className} />;
  }

  return (
    <Text size="sm" tone={tone} align="center">
      {value}
    </Text>
  );
}
