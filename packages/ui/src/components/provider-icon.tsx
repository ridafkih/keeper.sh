import type { FC } from "react";
import Image from "next/image";
import { Calendar, Link2 } from "lucide-react";
import { cn } from "../utils/cn";
import type { Provider } from "../types/provider";

interface ProviderIconProps {
  provider: Provider;
  className?: string;
}

const ProviderIcon: FC<ProviderIconProps> = ({ provider, className }) => {
  if (provider.icon) {
    return (
      <Image
        src={provider.icon}
        alt={provider.name}
        width={16}
        height={16}
        className={cn("size-4", className)}
      />
    );
  }

  if (provider.id === "ical") {
    return <Link2 size={16} className={cn("text-foreground-subtle", className)} />;
  }

  return <Calendar size={16} className={cn("text-foreground-subtle", className)} />;
};

ProviderIcon.displayName = "ProviderIcon";

export { ProviderIcon };
