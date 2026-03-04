import { useState } from "react";
import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import useSWR from "swr";
import { Calendar, Check, LoaderCircle } from "lucide-react";
import { BackButton } from "../../../../components/ui/back-button";
import { Button, ButtonText } from "../../../../components/ui/button";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "../../../../components/ui/navigation-menu";
import { Heading2 } from "../../../../components/ui/heading";
import { Text } from "../../../../components/ui/text";

interface SearchParams {
  token?: string;
  connected?: string;
  error?: string;
}

interface CallbackState {
  credentialId: string;
  provider: string;
}

interface CalendarOption {
  id: string;
  summary: string;
  primary?: boolean;
}

const fetchCallbackState = async (token: string): Promise<CallbackState> => {
  const response = await fetch(`/api/sources/callback-state?token=${token}`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Invalid token");
  return response.json();
};

export const Route = createFileRoute("/(dashboard)/dashboard/integrations/")({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    token: search.token as string | undefined,
    connected: search.connected as string | undefined,
    error: search.error as string | undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.connected === "true") {
      throw redirect({ to: "/dashboard/calendars" });
    }
    if (search.token) {
      const returnTo = sessionStorage.getItem(`oauth:${search.token}`);
      if (returnTo) {
        throw redirect({ to: returnTo });
      }
    }
    if (!search.token && !search.error) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) => {
    const token = deps.token;

    if (!token) return { callbackState: null };

    try {
      const callbackState = await fetchCallbackState(token);
      const returnTo = sessionStorage.getItem("oauth:returnTo");
      if (returnTo) {
        sessionStorage.setItem(`oauth:${token}`, returnTo);
        sessionStorage.removeItem("oauth:returnTo");
      }
      return { callbackState };
    } catch {
      throw redirect({ to: "/dashboard/calendars" });
    }
  },
});

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error("Failed to fetch");
  return response.json();
};

function RouteComponent() {
  const { error } = Route.useSearch();
  const { callbackState } = Route.useLoaderData();

  if (error) {
    return <ErrorView message={error} />;
  }

  if (callbackState) {
    return (
      <CalendarPicker
        provider={callbackState.provider}
        credentialId={callbackState.credentialId}
      />
    );
  }

  return null;
}

function ErrorView({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-3">
      <BackButton />
      <div className="flex flex-col gap-1 py-2">
        <Heading2 as="span" className="text-center">Connection failed</Heading2>
        <Text size="sm" tone="muted" align="center">{message}</Text>
      </div>
    </div>
  );
}

interface CalendarPickerProps {
  provider: string;
  credentialId: string;
}

function CalendarPicker({ provider, credentialId }: CalendarPickerProps) {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useSWR<{ calendars: CalendarOption[] }>(
    `/api/sources/${provider}/calendars?credentialId=${credentialId}`,
    fetcher,
  );

  const calendars = data?.calendars ?? [];

  const handleImport = async () => {
    if (!selectedId) return;

    const calendar = calendars.find((c) => c.id === selectedId);
    if (!calendar) return;

    setSubmitting(true);
    setError(null);

    const response = await fetch(`/api/sources/${provider}`, {
      body: JSON.stringify({
        externalCalendarId: selectedId,
        name: calendar.summary,
        oauthCredentialId: credentialId,
      }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? "Failed to import calendar");
      setSubmitting(false);
      return;
    }

    navigate({ to: "/dashboard/calendars" });
  };

  return (
    <div className="flex flex-col gap-3">
      <BackButton />
      <div className="flex flex-col py-2">
        <Heading2 as="span" className="text-center">Select a calendar</Heading2>
        <Text size="sm" tone="muted" align="center">
          Choose which calendar to import events from.
        </Text>
      </div>
      {isLoading && (
        <div className="flex justify-center py-6">
          <LoaderCircle size={20} className="animate-spin text-foreground-muted" />
        </div>
      )}
      {!isLoading && calendars.length > 0 && (
        <NavigationMenu>
          {calendars.map((calendar) => (
            <NavigationMenuItem
              key={calendar.id}
              onClick={() => setSelectedId(calendar.id)}
            >
              <NavigationMenuItemIcon>
                <Calendar size={15} />
                <NavigationMenuItemLabel>{calendar.summary}</NavigationMenuItemLabel>
              </NavigationMenuItemIcon>
              <NavigationMenuItemTrailing>
                {selectedId === calendar.id && (
                  <Check size={14} className="text-foreground" />
                )}
              </NavigationMenuItemTrailing>
            </NavigationMenuItem>
          ))}
        </NavigationMenu>
      )}
      {!isLoading && calendars.length === 0 && (
        <Text size="sm" tone="muted" align="center">No calendars found.</Text>
      )}
      {error && <Text size="sm" tone="danger" align="center">{error}</Text>}
      <Button
        className="w-full justify-center"
        disabled={!selectedId || submitting}
        onClick={handleImport}
      >
        {submitting && <LoaderCircle size={16} className="animate-spin" />}
        <ButtonText>{submitting ? "Importing..." : "Import calendar"}</ButtonText>
      </Button>
    </div>
  );
}
