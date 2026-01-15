import type { FC } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "../utils/cn";
import type { Provider } from "../types/provider";
import { ProviderIcon } from "./provider-icon";
import { Heading3 } from "./heading";
import { Copy } from "./copy";
import { Button, ButtonText } from "./button";

interface ProviderDetailsProps {
  provider: Provider;
  onConnect: () => void;
  className?: string;
}

const ProviderDetails: FC<ProviderDetailsProps> = ({ provider, onConnect, className }) => (
  <div className={cn("flex flex-col justify-between gap-12 h-full p-4 pt-2", className)}>
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <ProviderIcon provider={provider} />
          <Heading3>{provider.name}</Heading3>
        </div>
        <Copy className="text-xs">{provider.description}</Copy>
      </div>

      <div className="flex flex-col gap-3">
        {provider.steps.map((step, index) => (
          <div key={step.title} className="flex gap-3">
            <div className="flex items-center justify-center size-5 shrink-0 rounded-full bg-surface-muted text-xs font-medium text-foreground-secondary">
              {index + 1}
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">{step.title}</span>
              <span className="text-xs text-foreground-muted">{step.description}</span>
            </div>
          </div>
        ))}
      </div>
    </div>

    <Button className="w-full" onClick={onConnect}>
      <ButtonText>{provider.connectLabel}</ButtonText>
      <ExternalLink size={14} />
    </Button>
  </div>
);

ProviderDetails.displayName = "ProviderDetails";

export { ProviderDetails };
