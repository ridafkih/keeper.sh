import Calendar from "lucide-react/dist/esm/icons/calendar";
import LinkIcon from "lucide-react/dist/esm/icons/link";
import type { ConnectProvider } from "@/lib/connect-providers";

export function ConnectProviderIcon({ provider, size = 15 }: { provider: ConnectProvider; size?: number }) {
  if (provider.iconSrc) return <img src={provider.iconSrc} alt="" width={size} height={size} />;
  if (provider.group === "feed") return <LinkIcon size={size} />;
  return <Calendar size={size} />;
}
