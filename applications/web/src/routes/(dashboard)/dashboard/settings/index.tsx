import { useCallback, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import CreditCard from "lucide-react/dist/esm/icons/credit-card";
import KeyRound from "lucide-react/dist/esm/icons/key-round";
import KeySquare from "lucide-react/dist/esm/icons/key-square";
import Lock from "lucide-react/dist/esm/icons/lock";
import Mail from "lucide-react/dist/esm/icons/mail";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import Cookie from "lucide-react/dist/esm/icons/cookie";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { pluralize } from "@/lib/pluralize";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { BackButton } from "@/components/ui/primitives/back-button";
import { useSession } from "@/hooks/use-session";
import { useApiTokens } from "@/hooks/use-api-tokens";
import { usePasskeys } from "@/hooks/use-passkeys";
import { Input } from "@/components/ui/primitives/input";
import { deleteAccount } from "@/lib/auth";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalTitle,
} from "@/components/ui/primitives/modal";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItem,
  NavigationMenuLinkItem,
  NavigationMenuToggleItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { resolveEffectiveConsent, setAnalyticsConsent } from "@/lib/analytics";
import { Text } from "@/components/ui/primitives/text";
import { resolveErrorMessage } from "@/utils/errors";
import { fetchAuthCapabilitiesWithApi } from "@/lib/auth-capabilities";
import { getCommercialMode } from "@/config/commercial";
import { useSubscription, fetchSubscriptionStateWithApi } from "@/hooks/use-subscription";
import { openCustomerPortal } from "@/utils/checkout";

async function loadSubscription(context: { runtimeConfig: { commercialMode: boolean }; fetchApi: <T>(path: string, init?: RequestInit) => Promise<T> }) {
  if (!context.runtimeConfig.commercialMode) return undefined;
  try {
    return await fetchSubscriptionStateWithApi(context.fetchApi);
  } catch {
    return undefined;
  }
}

export const Route = createFileRoute("/(dashboard)/dashboard/settings/")({
  loader: async ({ context }) => {
    const [authCapabilities, subscription] = await Promise.all([
      fetchAuthCapabilitiesWithApi(context.fetchApi),
      loadSubscription(context),
    ]);
    return { authCapabilities, subscription };
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { authCapabilities, subscription: loaderSubscription } = Route.useLoaderData();
  const { user } = useSession();
  const navigate = useNavigate();
  const passwordRef = useRef<HTMLInputElement>(null);
  const accountLabel = authCapabilities.credentialMode === "username" ? "Username" : "Email";
  const accountValue =
    authCapabilities.credentialMode === "username"
      ? (user?.username ?? user?.name ?? "")
      : (user?.email ?? "");
  const { data: apiTokens = [] } = useApiTokens();
  const { data: passkeys = [] } = usePasskeys(authCapabilities.supportsPasskeys);
  const { data: subscription, isLoading: subscriptionLoading } = useSubscription({
    fallbackData: loaderSubscription,
  });
  const isPro = subscription?.plan === "pro";
  const [isManaging, setIsManaging] = useState(false);
  const { runtimeConfig } = Route.useRouteContext();
  const [analyticsConsent, setAnalyticsConsentState] = useState(() =>
    resolveEffectiveConsent(runtimeConfig.gdprApplies),
  );
  const handleAnalyticsToggle = useCallback((checked: boolean) => {
    setAnalyticsConsent(checked);
    setAnalyticsConsentState(checked);
  }, []);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleManagePlan = async () => {
    if (!isPro) {
      navigate({ to: "/dashboard/upgrade" });
      return;
    }
    setIsManaging(true);
    try {
      await openCustomerPortal();
    } catch {
      setIsManaging(false);
    }
  };

  const handleDeleteAccount = async () => {
    const password = passwordRef.current?.value;
    if (!password) return;
    setDeleteError(null);
    setIsDeleting(true);
    try {
      await deleteAccount(password);
      setDeleteOpen(false);
      navigate({ to: "/login" });
    } catch (err) {
      setDeleteError(resolveErrorMessage(err, "Failed to delete account."));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton />
      <NavigationMenu>
        <NavigationMenuItem>
          <NavigationMenuItemIcon>
            <Mail size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>{accountLabel}</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing>
            <Text size="sm" tone="muted" className="truncate">{accountValue}</Text>
          </NavigationMenuItemTrailing>
        </NavigationMenuItem>
      </NavigationMenu>
      <NavigationMenu>
        {authCapabilities.supportsChangePassword && (
          <NavigationMenuLinkItem to="/dashboard/settings/change-password">
            <NavigationMenuItemIcon>
              <Lock size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Change Password</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuLinkItem>
        )}
        {authCapabilities.supportsPasskeys && (
          <NavigationMenuLinkItem to="/dashboard/settings/passkeys">
            <NavigationMenuItemIcon>
              <KeyRound size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Passkeys</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing>
              <Text size="sm" tone="muted">
                {pluralize(passkeys.length, "passkey", "passkeys")}
              </Text>
            </NavigationMenuItemTrailing>
          </NavigationMenuLinkItem>
        )}
        <NavigationMenuLinkItem to="/dashboard/settings/api-tokens">
          <NavigationMenuItemIcon>
            <KeySquare size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>API Tokens</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing>
            <Text size="sm" tone="muted">
              {pluralize(apiTokens.length, "token", "tokens")}
            </Text>
          </NavigationMenuItemTrailing>
        </NavigationMenuLinkItem>
      </NavigationMenu>
      <NavigationMenu>
        <NavigationMenuToggleItem checked={analyticsConsent} onCheckedChange={handleAnalyticsToggle}>
          <NavigationMenuItemIcon>
            <Cookie size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Analytics Cookies</NavigationMenuItemLabel>
        </NavigationMenuToggleItem>
      </NavigationMenu>
      {getCommercialMode() && (
        <NavigationMenu variant={isPro ? "default" : "highlight"}>
          <NavigationMenuButtonItem onClick={handleManagePlan} disabled={isManaging || subscriptionLoading}>
            <NavigationMenuItemIcon>
              {isPro ? <CreditCard size={15} /> : <Sparkles size={15} />}
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>{isPro ? "Manage Plan" : "Upgrade to Pro"}</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing />
          </NavigationMenuButtonItem>
        </NavigationMenu>
      )}
      <NavigationMenu>
        <NavigationMenuButtonItem onClick={() => setDeleteOpen(true)}>
          <NavigationMenuItemIcon>
            <Trash2 size={15} className="text-destructive" />
          </NavigationMenuItemIcon>
          <Text size="sm" tone="danger">Delete Account</Text>
        </NavigationMenuButtonItem>
      </NavigationMenu>
      <Modal open={deleteOpen} onOpenChange={setDeleteOpen}>
        <ModalContent>
          <ModalTitle>Delete account?</ModalTitle>
          <ModalDescription>
            This action is permanent and cannot be undone. All of your data, calendars, and connected accounts will be permanently deleted.
          </ModalDescription>
          <Input ref={passwordRef} type="password" placeholder="Confirm your password" />
          {deleteError && <Text size="sm" tone="danger">{deleteError}</Text>}
          <ModalFooter>
            <Button variant="destructive" className="w-full justify-center" onClick={handleDeleteAccount} disabled={isDeleting}>
              <ButtonText>{isDeleting ? "Deleting..." : "Delete my account"}</ButtonText>
            </Button>
            <Button variant="elevated" className="w-full justify-center" onClick={() => setDeleteOpen(false)}>
              <ButtonText>Cancel</ButtonText>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
