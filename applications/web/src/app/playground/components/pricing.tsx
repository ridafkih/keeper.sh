import type { FC, PropsWithChildren } from "react";
import { Check } from "lucide-react";

import { Heading3 } from "./heading";
import { Copy } from "./copy";

const PricingGrid: FC<PropsWithChildren> = ({ children }) => (
  <ul className="grid grid-cols-2 gap-4">{children}</ul>
);

interface PricingTierProps {
  title: string;
}

const PricingTier: FC<PropsWithChildren<PricingTierProps>> = ({ title, children }) => (
  <li className="flex flex-col gap-2">
    <Heading3>{title}</Heading3>
    {children}
  </li>
);

const PricingFeatureList: FC<PropsWithChildren> = ({ children }) => (
  <ul className="flex flex-col gap-0.5">{children}</ul>
);

interface PricingFeatureProps {
  children: string;
}

const PricingFeature: FC<PricingFeatureProps> = ({ children }) => (
  <li className="flex items-center gap-1">
    <Check size={14} className="text-neutral-400" />
    <Copy>{children}</Copy>
  </li>
);

export { PricingGrid, PricingTier, PricingFeatureList, PricingFeature };
