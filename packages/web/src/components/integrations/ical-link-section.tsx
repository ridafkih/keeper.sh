"use client";

import type { FC } from "react";
import { useState } from "react";
import { Button } from "@base-ui/react/button";
import { Toast } from "@/components/toast-provider";
import { Section } from "@/components/section";
import { SectionHeader } from "@/components/section-header";
import { useIcalToken } from "@/hooks/use-ical-token";
import { button, input } from "@/styles";
import { track } from "@/lib/analytics";
import { Check } from "lucide-react";
import { TOOLTIP_CLEAR_DELAY_MS } from "@keeper.sh/constants";

const getCopyButtonVisibility = (isCopied: boolean): string => {
  if (isCopied) {
    return "invisible";
  }
  return "";
};

const ICalLinkSkeleton: FC = () => (
  <div className="flex gap-1.5">
    <div
      className={input({
        className: "flex flex-1 items-center animate-pulse",
        readonly: true,
        size: "sm",
      })}
    >
      <div className="h-lh bg-surface-skeleton rounded max-w-1/2 w-full" />
    </div>
    <div className="h-9 min-w-[6ch] px-1.5 bg-surface-muted rounded-md animate-pulse" />
  </div>
);

export const ICalLinkSection: FC = () => {
  const toastManager = Toast.useToastManager();
  const { icalUrl, isLoading } = useIcalToken();
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async (): Promise<void> => {
    if (!icalUrl) {
      return;
    }
    await navigator.clipboard.writeText(icalUrl);
    track("ical_link_copied");
    toastManager.add({ title: "Copied to clipboard" });
    setCopied(true);
    setTimeout(() => setCopied(false), TOOLTIP_CLEAR_DELAY_MS);
  };

  return (
    <Section>
      <SectionHeader
        title="Your iCal Link"
        description="Subscribe to this link to view your aggregated events"
      />
      {(isLoading || !icalUrl) && <ICalLinkSkeleton />}
      {!isLoading && icalUrl && (
        <div className="flex gap-1.5">
          <input
            type="text"
            value={icalUrl}
            readOnly
            className={input({
              className: "flex-1",
              readonly: true,
              size: "sm",
            })}
          />
          <Button
            onClick={copyToClipboard}
            className={button({
              className: "relative",
              size: "sm",
              variant: "secondary",
            })}
          >
            <span className={getCopyButtonVisibility(copied)}>Copy</span>
            {copied && <Check size={16} className="absolute inset-0 m-auto" />}
          </Button>
        </div>
      )}
    </Section>
  );
};
