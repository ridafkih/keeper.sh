import { useSetAtom } from "jotai";
import Building2 from "lucide-react/dist/esm/icons/building-2";
import Copy from "lucide-react/dist/esm/icons/copy";
import Mail from "lucide-react/dist/esm/icons/mail";
import { LinkButton, ButtonText } from "@/components/ui/primitives/button";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { showToastAtom } from "@/state/toast";
import { OnboardingHeading } from "./onboarding-heading";

const APPROVAL_EMAIL_SUBJECT = "Approve Keeper.sh for our Microsoft 365 calendars";

const buildApprovalEmail = (approvalUrl: string): string => {
  const body = `Could you approve Keeper.sh so I can sync my work calendar? You can approve it here: ${approvalUrl}`;
  return `mailto:?subject=${encodeURIComponent(APPROVAL_EMAIL_SUBJECT)}&body=${encodeURIComponent(body)}`;
};

export function AdminApproval({ approvalUrl }: { approvalUrl: string }) {
  const showToast = useSetAtom(showToastAtom);

  const copyApprovalLink = async () => {
    await navigator.clipboard.writeText(approvalUrl);
    track(ANALYTICS_EVENTS.onboarding_admin_link_copied, { method: "copy" });
    showToast("Link copied");
  };

  const emailApprovalLink = () => {
    track(ANALYTICS_EVENTS.onboarding_admin_link_copied, { method: "email" });
    globalThis.location.href = buildApprovalEmail(approvalUrl);
  };

  return (
    <div className="flex flex-col gap-3 pt-4">
      <OnboardingHeading
        icon={{ glyph: <Building2 size={22} strokeWidth={1.75} />, tone: "caution" }}
        title="Your organisation needs to approve Keeper.sh"
        description="This work account only allows apps your IT admin has approved. Send them the approval link and you'll carry on here once they accept."
      />
      <NavigationMenu>
        <NavigationMenuButtonItem onClick={copyApprovalLink}>
          <NavigationMenuItemIcon>
            <Copy size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Copy approval link</NavigationMenuItemLabel>
        </NavigationMenuButtonItem>
        <NavigationMenuButtonItem onClick={emailApprovalLink}>
          <NavigationMenuItemIcon>
            <Mail size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Email it to your admin</NavigationMenuItemLabel>
        </NavigationMenuButtonItem>
      </NavigationMenu>
      <LinkButton to="/dashboard" variant="border" className="w-full justify-center">
        <ButtonText>Use a personal calendar</ButtonText>
      </LinkButton>
    </div>
  );
}
