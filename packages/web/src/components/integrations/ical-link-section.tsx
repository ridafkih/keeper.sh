"use client";

import type { FC } from "react";
import { useState } from "react";
import { Button } from "@base-ui/react/button";
import { Toast } from "@/components/toast-provider";
import { Section } from "@/components/section";
import { SectionHeader } from "@/components/section-header";
import { useIcalToken } from "@/hooks/use-ical-token";
import { button, input } from "@/styles";
import { Check } from "lucide-react";

const ICalLinkSkeleton: FC = () => (
  <div className="flex gap-1.5">
    <div
      className={input({
        readonly: true,
        size: "sm",
        className: "flex flex-1 items-center animate-pulse",
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

  const copyToClipboard = async () => {
    if (!icalUrl) return;
    await navigator.clipboard.writeText(icalUrl);
    toastManager.add({ title: "Copied to clipboard" });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Section>
      <SectionHeader
        title="Your iCal Link"
        description="Subscribe to this link to view your aggregated events"
      />
      {isLoading || !icalUrl ? (
        <ICalLinkSkeleton />
      ) : (
        <div className="flex gap-1.5">
          <input
            type="text"
            value={icalUrl}
            readOnly
            className={input({
              readonly: true,
              size: "sm",
              className: "flex-1",
            })}
          />
          <Button
            onClick={copyToClipboard}
            className={button({
              variant: "secondary",
              size: "sm",
              className: "relative",
            })}
          >
            <span className={copied ? "invisible" : ""}>Copy</span>
            {copied && <Check size={16} className="absolute inset-0 m-auto" />}
          </Button>
        </div>
      )}
    </Section>
  );
};
