import Calendar from "lucide-react/dist/esm/icons/calendar";
import LinkIcon from "lucide-react/dist/esm/icons/link";
import { providerIcons } from "../../../lib/providers";

interface ProviderIconProps {
  provider?: string;
  calendarType?: string;
  size?: number;
}

function resolveIconPath(provider: string | undefined): string | undefined {
  if (provider) return providerIcons[provider];
  return undefined;
}

function ProviderIcon({ provider, calendarType, size = 15 }: ProviderIconProps) {
  if (calendarType === "ical" || provider === "ics") {
    return <LinkIcon className="shrink-0" size={size} />;
  }

  const iconPath = resolveIconPath(provider);

  if (!iconPath) {
    return <Calendar className="shrink-0" size={size} />;
  }

  return <img className="shrink-0" src={iconPath} alt="" width={size} height={size} />;
}

export { ProviderIcon };
