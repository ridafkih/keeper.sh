import { useState, useTransition, type SubmitEvent } from "react";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { useNavigate } from "@tanstack/react-router";
import { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/fetcher";
import { invalidateAccountsAndSources } from "@/lib/swr";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { Checkbox } from "@/components/ui/primitives/checkbox";
import { Divider } from "@/components/ui/primitives/divider";
import { Input } from "@/components/ui/primitives/input";
import { Text } from "@/components/ui/primitives/text";

function resolveSubmitLabel(pending: boolean): string {
  if (pending) return "Subscribing...";
  return "Subscribe";
}

export function ICSFeedForm() {
  const navigate = useNavigate();
  const { mutate: globalMutate } = useSWRConfig();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [requiresAuth, setRequiresAuth] = useState(false);

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const rawUrl = formData.get("feed-url");

    if (!rawUrl || typeof rawUrl !== "string") return;

    let url = rawUrl;

    if (requiresAuth) {
      const username = formData.get("username");
      const password = formData.get("password");

      if (!username || !password) {
        setError("Username and password are required for authenticated feeds.");
        return;
      }

      try {
        const parsed = new URL(rawUrl);
        parsed.username = encodeURIComponent(String(username));
        parsed.password = encodeURIComponent(String(password));
        url = parsed.toString();
      } catch {
        setError("Invalid URL.");
        return;
      }
    }

    setError(null);

    startTransition(async () => {
      let accountId: string | undefined;

      try {
        const response = await apiFetch("/api/ics", {
          body: JSON.stringify({ name: "iCal Feed", url }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const data = await response.json();
        accountId = data?.accountId;
      } catch {
        setError("Failed to subscribe to feed");
        return;
      }

      await invalidateAccountsAndSources(globalMutate);

      if (accountId) {
        navigate({ to: "/dashboard/accounts/$accountId/setup", params: { accountId } });
      } else {
        navigate({ to: "/dashboard" });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Input
          id="feed-url"
          name="feed-url"
          type="url"
          placeholder="Calendar Feed URL"
          disabled={isPending}
        />
        <Checkbox checked={requiresAuth} onCheckedChange={setRequiresAuth}>
          Requires authentication
        </Checkbox>
        {requiresAuth && (
          <>
            <Input
              id="username"
              name="username"
              type="text"
              placeholder="Username"
              disabled={isPending}
            />
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="Password"
              disabled={isPending}
            />
          </>
        )}
      </div>
      <Divider />
      <div className="flex items-stretch gap-2">
        <BackButton variant="border" size="standard" className="self-stretch justify-center px-3.5" />
        <Button type="submit" className="grow justify-center" disabled={isPending}>
          {isPending && <LoaderCircle size={16} className="animate-spin" />}
          <ButtonText>{resolveSubmitLabel(isPending)}</ButtonText>
        </Button>
      </div>
      {error && <Text size="sm" tone="danger" align="center">{error}</Text>}
    </form>
  );
}
