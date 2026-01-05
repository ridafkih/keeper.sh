"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence } from "motion/react";
import { hasConsentChoice, setAnalyticsConsent, track } from "@/lib/analytics";
import { button } from "@/styles";
import { TextBody } from "@/components/typography";
import { clsx } from "clsx";

const getConsentEventName = (consent: boolean): string => {
  if (consent) {
    return "consent_granted";
  }
  return "consent_denied";
};

export const CookieConsent = (): ReactNode => {
  const [showBanner, setShowBanner] = useState((): boolean => !hasConsentChoice());

  const handleChoice = (consent: boolean): void => {
    const eventName = getConsentEventName(consent);
    track(eventName);
    setAnalyticsConsent(consent);
    setShowBanner(false);
  };

  return (
    <AnimatePresence>
      <div className="sticky bottom-3 w-full flex justify-end max-w-3xl mx-auto px-3 pt-3">
        {showBanner && (
          <div className="grid mr-2 pointer-events-auto w-fit">
            <div className="overflow-hidden min-h-0 bg-background border border-border rounded-lg shadow-lg p-2 pl-4">
              <div className="flex items-center gap-2 whitespace-nowrap">
                <TextBody className="text-xs">
                  Can Keeper{" "}
                  <Link
                    href="/privacy"
                    className="underline text-foreground opacity-75 hover:opacity-100"
                  >
                    use cookies for analytics?
                  </Link>
                </TextBody>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => handleChoice(true)}
                    className={clsx(button({ size: "xs", variant: "secondary" }), "text-nowrap")}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChoice(false)}
                    className={clsx(button({ size: "xs", variant: "secondary" }), "text-nowrap")}
                  >
                    No
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AnimatePresence>
  );
};
