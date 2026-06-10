import { useCallback, useState } from "react";
import type { PropsWithChildren } from "react";
import { AnimatePresence, LazyMotion } from "motion/react";
import * as m from "motion/react-m";
import { loadMotionFeatures } from "@/lib/motion-features";
import { Text } from "@/components/ui/primitives/text";
import { TextLink } from "@/components/ui/primitives/text-link";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { hasConsentChoice, setAnalyticsConsent, track } from "@/lib/analytics";

const CARD_ENTER = { opacity: 0, y: 10, filter: "blur(4px)" };
const CARD_VISIBLE = { opacity: 1, y: 0, filter: "blur(0px)" };
const CARD_EXIT = { opacity: 0, y: 10, filter: "blur(4px)" };
const COLLAPSE_ANIMATE = { height: "auto" };
const COLLAPSE_EXIT = { height: 0 };
const CARD_TRANSITION = { duration: 0.2 };
const COLLAPSE_TRANSITION = { duration: 0.2, delay: 0.15 };

function resolveConsentEventName(consent: boolean): string {
  if (consent) return "consent_granted";
  return "consent_denied";
}

function ConsentBannerContent({ children }: PropsWithChildren) {
  return (
    <div className="flex items-center gap-3">
      {children}
    </div>
  );
}

function ConsentBannerActions({ children }: PropsWithChildren) {
  return (
    <div className="flex gap-1 shrink-0">
      {children}
    </div>
  );
}

function ConsentBannerCard({ children }: PropsWithChildren) {
  return (
    <div className="rounded-2xl bg-background border border-interactive-border shadow-xs px-3 py-2 pointer-events-auto">
      {children}
    </div>
  );
}

function CookieConsent() {
  const [visible, setVisible] = useState(() => !hasConsentChoice());

  const handleChoice = useCallback((consent: boolean): void => {
    track(resolveConsentEventName(consent));
    setAnalyticsConsent(consent);
    setVisible(false);
  }, []);

  return (
    <div className="sticky bottom-0 z-50 px-4 pb-4 pointer-events-none">
      <div className="mx-auto flex max-w-3xl justify-end">
        <LazyMotion features={loadMotionFeatures}>
          <AnimatePresence>
            {visible && (
              <m.div
                className="flex flex-col items-start overflow-visible"
                initial={false}
                animate={COLLAPSE_ANIMATE}
                exit={COLLAPSE_EXIT}
                transition={COLLAPSE_TRANSITION}
              >
                <m.div
                  initial={CARD_ENTER}
                  animate={CARD_VISIBLE}
                  exit={CARD_EXIT}
                  transition={CARD_TRANSITION}
                >
                  <ConsentBannerCard>
                    <ConsentBannerContent>
                      <Text as="span" size="sm">
                        Can Keeper{" "}
                        <TextLink to="/privacy" size="sm">
                          use cookies for analytics?
                        </TextLink>
                      </Text>
                      <ConsentBannerActions>
                        <Button size="compact" variant="border" onClick={() => handleChoice(true)}>
                          <ButtonText>Yes</ButtonText>
                        </Button>
                        <Button size="compact" variant="border" onClick={() => handleChoice(false)}>
                          <ButtonText>No</ButtonText>
                        </Button>
                      </ConsentBannerActions>
                    </ConsentBannerContent>
                  </ConsentBannerCard>
                </m.div>
              </m.div>
            )}
          </AnimatePresence>
        </LazyMotion>
      </div>
    </div>
  );
}

export { CookieConsent };
