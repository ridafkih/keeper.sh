import { useState, useTransition, type SubmitEvent } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Text } from "@/components/ui/primitives/text";
import { Divider } from "@/components/ui/primitives/divider";
import { Input } from "@/components/ui/primitives/input";
import { changePassword } from "@/lib/auth";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { fetchAuthCapabilitiesWithApi } from "@/lib/auth-capabilities";
import { resolveErrorMessage } from "@/utils/errors";

export const Route = createFileRoute(
  "/(dashboard)/dashboard/settings/change-password",
)({
  loader: async ({ context }) => {
    const capabilities = await fetchAuthCapabilitiesWithApi(context.fetchApi);
    if (!capabilities.supportsChangePassword) {
      throw redirect({ to: "/dashboard/settings" });
    }
    return capabilities;
  },
  component: ChangePasswordPage,
});

function resolveInputTone(error: string | null): "error" | "neutral" {
  if (error) return "error";
  return "neutral";
}

function ChangePasswordPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const current = formData.get("current");
    const newPassword = formData.get("new");
    const confirm = formData.get("confirm");

    if (typeof current !== "string" || typeof newPassword !== "string" || typeof confirm !== "string") return;

    if (newPassword !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    startTransition(async () => {
      try {
        await changePassword(current, newPassword);
        track(ANALYTICS_EVENTS.password_changed);
        navigate({ to: "/dashboard/settings" });
      } catch (err) {
        setError(resolveErrorMessage(err, "Failed to change password."));
      }
    });
  };

  const inputTone = resolveInputTone(error);

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton fallback="/dashboard/settings" />
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Input name="current" type="password" placeholder="Current password" tone={inputTone} />
          <Input name="new" type="password" placeholder="New password" tone={inputTone} />
          <Input name="confirm" type="password" placeholder="Confirm new password" tone={inputTone} />
        </div>
        {error && <Text size="sm" tone="danger">{error}</Text>}
        <Divider />
        <Button type="submit" variant="highlight" className="w-full justify-center" disabled={isPending}>
          {isPending && <LoaderCircle size={16} className="animate-spin" />}
          <ButtonText>{isPending ? "Saving..." : "Save"}</ButtonText>
        </Button>
      </form>
    </div>
  );
}
