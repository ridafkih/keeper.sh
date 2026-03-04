import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR from "swr";
import { LoaderCircle } from "lucide-react";
import { BackButton } from "../../../../components/ui/back-button";
import { Button, ButtonText } from "../../../../components/ui/button";
import { Divider } from "../../../../components/ui/divider";
import { Text } from "../../../../components/ui/text";
import {
  NavigationMenu,
  NavigationMenuEditableItem,
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
  "/(dashboard)/dashboard/calendars/$calendarId",
)({
  component: RouteComponent,
});

interface CalendarDetail {
  id: string;
  name: string;
  calendarType: string;
  provider: string | null;
  url: string | null;
  calendarUrl: string | null;
  excludeWorkingLocation: boolean;
  excludeFocusTime: boolean;
  excludeOutOfOffice: boolean;
  createdAt: string;
  updatedAt: string;
}

const fetcher = async (url: string): Promise<CalendarDetail> => {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error("Failed to fetch");
  return response.json();
};

const calendarTypeLabels: Record<string, string> = {
  ical: "iCal Feed",
  oauth: "OAuth",
  caldav: "CalDAV",
};

const providerLabels: Record<string, string> = {
  google: "Google Calendar",
  outlook: "Outlook",
  icloud: "iCloud",
  fastmail: "Fastmail",
  "microsoft-365": "Microsoft 365",
};

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

function RouteComponent() {
  const { calendarId } = Route.useParams();
  const navigate = useNavigate();
  const { data: calendar, isLoading, mutate } = useSWR(`/api/sources/${calendarId}`, fetcher);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (isLoading || !calendar) {
    return (
      <div className="flex flex-col gap-1.5">
        <BackButton fallback="/dashboard/calendars" />
        <div className="flex justify-center py-6">
          <LoaderCircle size={20} className="animate-spin text-foreground-muted" />
        </div>
      </div>
    );
  }

  const displayUrl = calendar.url ?? calendar.calendarUrl;
  const displayType = calendarTypeLabels[calendar.calendarType] ?? calendar.calendarType;
  const displayProvider = calendar.provider
    ? (providerLabels[calendar.provider] ?? calendar.provider)
    : null;
  return (
    <div className="flex flex-col gap-1.5">
      <BackButton fallback="/dashboard/calendars" />
      <NavigationMenu>
        <NavigationMenuEditableItem
          value={calendar.name}
          onCommit={async (name) => {
            await mutate(
              async (current) => {
                await fetch(`/api/sources/${calendar.id}`, {
                  body: JSON.stringify({ name }),
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  method: "PATCH",
                });
                return current ? { ...current, name } : current;
              },
              {
                optimisticData: { ...calendar, name },
                rollbackOnError: true,
                revalidate: false,
              },
            );
          }}
        />
      </NavigationMenu>
      <CalendarInfo
        type={displayType}
        provider={displayProvider}
        url={displayUrl}
        createdAt={calendar.createdAt}
      />
      <Divider />
      <NavigationMenu>
        <NavigationMenuItem onClick={() => setDeleteOpen(true)}>
          <NavigationMenuItemIcon>
            <Text size="sm" tone="danger">Delete Calendar</Text>
          </NavigationMenuItemIcon>
        </NavigationMenuItem>
      </NavigationMenu>
      <DeleteConfirmation
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        deleting={deleting}
        onConfirm={async () => {
          setDeleting(true);
          const response = await fetch(`/api/sources/${calendarId}`, {
            credentials: "include",
            method: "DELETE",
          });
          setDeleting(false);
          if (response.ok) {
            navigate({ to: "/dashboard/calendars" });
          }
        }}
      />
    </div>
  );
}


interface CalendarInfoProps {
  type: string;
  provider: string | null;
  url: string | null;
  createdAt: string;
}

function CalendarInfo({ type, provider, url, createdAt }: CalendarInfoProps) {
  return (
    <NavigationMenu>
      <NavigationMenuItem>
        <NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Type</NavigationMenuItemLabel>
        </NavigationMenuItemIcon>
        <NavigationMenuItemTrailing>
          <Text size="sm" tone="muted">{type}</Text>
        </NavigationMenuItemTrailing>
      </NavigationMenuItem>
      {provider && (
        <NavigationMenuItem>
          <NavigationMenuItemIcon>
            <NavigationMenuItemLabel>Provider</NavigationMenuItemLabel>
          </NavigationMenuItemIcon>
          <NavigationMenuItemTrailing>
            <Text size="sm" tone="muted">{provider}</Text>
          </NavigationMenuItemTrailing>
        </NavigationMenuItem>
      )}
      {url && (
        <NavigationMenuItem>
          <NavigationMenuItemIcon>
            <NavigationMenuItemLabel>URL</NavigationMenuItemLabel>
          </NavigationMenuItemIcon>
          <NavigationMenuItemTrailing>
            <Text size="sm" tone="muted" className="truncate max-w-[180px]" style={{ direction: "rtl" }}>
              {url}
            </Text>
          </NavigationMenuItemTrailing>
        </NavigationMenuItem>
      )}
      <NavigationMenuItem>
        <NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Added</NavigationMenuItemLabel>
        </NavigationMenuItemIcon>
        <NavigationMenuItemTrailing>
          <Text size="sm" tone="muted">{formatDate(createdAt)}</Text>
        </NavigationMenuItemTrailing>
      </NavigationMenuItem>
    </NavigationMenu>
  );
}

interface DeleteConfirmationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deleting: boolean;
  onConfirm: () => void;
}

function DeleteConfirmation({ open, onOpenChange, deleting, onConfirm }: DeleteConfirmationProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>Delete calendar?</ModalTitle>
        <ModalDescription>
          This will permanently remove this calendar and all its synced events.
        </ModalDescription>
        <ModalFooter>
          <Button variant="destructive" className="w-full justify-center" onClick={onConfirm} disabled={deleting}>
            {deleting && <LoaderCircle size={16} className="animate-spin" />}
            <ButtonText>{deleting ? "Deleting..." : "Delete"}</ButtonText>
          </Button>
          <Button variant="elevated" className="w-full justify-center" onClick={() => onOpenChange(false)}>
            <ButtonText>Cancel</ButtonText>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
