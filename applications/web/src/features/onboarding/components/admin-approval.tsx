import { useSetAtom } from "jotai";
import Copy from "lucide-react/dist/esm/icons/copy";
import Mail from "lucide-react/dist/esm/icons/mail";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { LinkButton, ButtonText } from "@/components/ui/primitives/button";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { showToastAtom } from "@/state/toast";

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
      <div className="flex flex-col gap-1 px-0.5">
        <Heading2 as="h1">Your organisation needs to approve Keeper.sh</Heading2>
        <Text size="sm" tone="muted">
          This work account only allows apps your IT admin has approved. Send them the approval link and you&apos;ll carry on here once they accept.
        </Text>
      </div>
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
          <NavigationMenuItemTrailing />
        </NavigationMenuButtonItem>
      </NavigationMenu>
      <LinkButton to="/dashboard" variant="border" className="w-full justify-center">
        <ButtonText>Use a personal calendar</ButtonText>
      </LinkButton>
    </div>
  );
}
