import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { useSWRConfig } from "swr";
import { Calendar, LoaderCircle } from "lucide-react";
import { BackButton } from "../../../../components/ui/back-button";
import { Button, ButtonText } from "../../../../components/ui/button";
import { Text } from "../../../../components/ui/text";
import { getAccountLabel } from "../../../../utils/accounts";
import {
  NavigationMenu,
  NavigationMenuEmptyItem,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "../../../../components/ui/navigation-menu";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalTitle,
} from "../../../../components/ui/modal";

export const Route = createFileRoute(
  "/(dashboard)/dashboard/accounts/$accountId/",
)({
  component: RouteComponent,
});

interface CalendarAccount {
  id: string;
  provider: string;
  displayName: string | null;
  email: string | null;
  authType: string;
  needsReauthentication: boolean;
  calendarCount: number;
  createdAt: string;
}

interface CalendarSource {
  id: string;
  name: string;
  calendarType: string;
  capabilities: string[];
  accountId: string;
  provider: string;
  email: string | null;
  needsReauthentication: boolean;
}

function RouteComponent() {
  const { accountId } = Route.useParams();
  const navigate = useNavigate();
  const { mutate: globalMutate } = useSWRConfig();
  const { data: account, isLoading: accountLoading, error: accountError } = useSWR<CalendarAccount>(
    `/api/accounts/${accountId}`,
  );
  const { data: allCalendars, isLoading: calendarsLoading, error: calendarsError } = useSWR<CalendarSource[]>(
    "/api/sources",
  );

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isLoading = accountLoading || calendarsLoading;
  const error = accountError || calendarsError;
  const calendars = (allCalendars ?? []).filter(
    (calendar) => calendar.accountId === accountId,
  );

  if (error) {
    return (
      <div className="flex flex-col gap-1.5">
        <BackButton />
        <Text size="sm" tone="danger">Something went wrong. Please try again.</Text>
      </div>
    );
  }

  if (isLoading || !account) {
    return (
      <div className="flex flex-col gap-1.5">
        <BackButton />
        <div className="flex justify-center py-6">
          <LoaderCircle
            size={20}
            className="animate-spin text-foreground-muted"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton />
      <NavigationMenu>
        {calendars.length === 0 ? (
          <NavigationMenuEmptyItem>No calendars</NavigationMenuEmptyItem>
        ) : (
          calendars.map((calendar) => (
            <NavigationMenuItem key={calendar.id} to={`/dashboard/accounts/${accountId}/${calendar.id}`}>
              <NavigationMenuItemIcon>
                <Calendar size={15} />
                <NavigationMenuItemLabel>
                  {calendar.name}
                </NavigationMenuItemLabel>
              </NavigationMenuItemIcon>
              <NavigationMenuItemTrailing />
            </NavigationMenuItem>
          ))
        )}
      </NavigationMenu>
      <NavigationMenu>
        <NavigationMenuItem>
          <Text size="sm" tone="muted" className="shrink-0">Resource Type</Text>
          <div className="min-w-0">
            <Text size="sm" tone="muted" className="truncate">Account</Text>
          </div>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <Text size="sm" tone="muted" className="shrink-0">Calendar Count</Text>
          <div className="min-w-0">
            <Text size="sm" tone="muted" className="truncate">{calendars.length}</Text>
          </div>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <Text size="sm" tone="muted" className="shrink-0">Identifier</Text>
          <div className="min-w-0">
            <Text size="sm" tone="muted" className="truncate">{getAccountLabel(account)}</Text>
          </div>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <Text size="sm" tone="muted" className="shrink-0">Provider</Text>
          <Text size="sm" tone="muted">{account.provider}</Text>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <Text size="sm" tone="muted" className="shrink-0">Authenticated</Text>
          <Text size="sm" tone="muted">{account.authType}</Text>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <Text size="sm" tone="muted" className="shrink-0">Connected</Text>
          <Text size="sm" tone="muted">{new Date(account.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</Text>
        </NavigationMenuItem>
      </NavigationMenu>
      <NavigationMenu>
        <NavigationMenuItem onClick={() => setDeleteOpen(true)}>
          <NavigationMenuItemIcon>
            <Text size="sm" tone="danger">Delete Account</Text>
          </NavigationMenuItemIcon>
        </NavigationMenuItem>
      </NavigationMenu>
      <Modal open={deleteOpen} onOpenChange={setDeleteOpen}>
        <ModalContent>
          <ModalTitle>Delete calendar account?</ModalTitle>
          <ModalDescription>
            This will remove the account and all its calendars. Any sync profiles using these calendars will be affected.
          </ModalDescription>
          <ModalFooter>
            <Button
              variant="destructive"
              className="w-full justify-center"
              onClick={async () => {
                setDeleting(true);
                const response = await fetch(`/api/accounts/${accountId}`, {
                  credentials: "include",
                  method: "DELETE",
                });
                setDeleting(false);
                if (response.ok) {
                  await globalMutate("/api/accounts");
                  await globalMutate("/api/sources");
                  navigate({ to: "/dashboard" });
                }
              }}
              disabled={deleting}
            >
              {deleting && <LoaderCircle size={16} className="animate-spin" />}
              <ButtonText>{deleting ? "Deleting..." : "Delete"}</ButtonText>
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
