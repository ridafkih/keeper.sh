import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { providerIcons } from "@/lib/providers";
import type { CalendarConsentProvider } from "@/lib/sign-up-continuation";
import { useOpenCalendarConsent } from "../use-open-calendar-consent";
import { ProviderIconPair } from "./oauth-preamble";

const PROVIDER_COMPANIES: Record<CalendarConsentProvider, string> = {
  google: "Google",
  outlook: "Microsoft",
};

export function CalendarConsentContinuation({ provider }: { provider: CalendarConsentProvider }) {
  useOpenCalendarConsent(provider);

  return (
    <div className="flex flex-col items-center gap-4" role="status">
      <ProviderIconPair>
        <img
          src={providerIcons[provider]}
          alt={PROVIDER_COMPANIES[provider]}
          width={40}
          height={40}
          className="size-full rounded-lg p-3"
        />
      </ProviderIconPair>
      <LoaderCircle size={16} className="animate-spin text-foreground-muted" />
      <span className="sr-only">Opening {PROVIDER_COMPANIES[provider]}</span>
    </div>
  );
}
