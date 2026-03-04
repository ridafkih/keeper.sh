import { useState, type ChangeEvent, type SubmitEvent } from "react";
import { LoaderCircle, Upload } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useSWRConfig } from "swr";
import { getFormData } from "../../lib/forms";
import { apiFetch } from "../../lib/fetcher";
import { invalidateAccountsAndSources } from "../../lib/swr";
import { BackButton } from "../ui/back-button";
import { Button, ButtonText } from "../ui/button";
import { Divider } from "../ui/divider";
import { Input } from "../ui/input";
import { Text } from "../ui/text";

export function ICSFeedForm() {
  const navigate = useNavigate();
  const { mutate: globalMutate } = useSWRConfig();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = getFormData(event);
    const url = formData.get("feed-url");

    if (!url || typeof url !== "string") return;

    setSubmitting(true);
    setError(null);

    try {
      await apiFetch("/api/ics", {
        body: JSON.stringify({ name: "iCal Feed", url }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    } catch {
      setError("Failed to subscribe to feed");
      setSubmitting(false);
      return;
    }

    await invalidateAccountsAndSources(globalMutate);
    navigate({ to: "/dashboard/calendars" });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Input
        id="feed-url"
        name="feed-url"
        type="url"
        placeholder="Calendar Feed URL"
        disabled={submitting}
      />
      <Divider />
      <div className="flex items-stretch gap-2">
        <BackButton variant="border" size="standard" className="self-stretch justify-center px-3.5" />
        <Button type="submit" className="grow justify-center" disabled={submitting}>
          {submitting && <LoaderCircle size={16} className="animate-spin" />}
          <ButtonText>{submitting ? "Subscribing..." : "Subscribe"}</ButtonText>
        </Button>
      </div>
      {error && <Text size="sm" tone="danger" align="center">{error}</Text>}
    </form>
  );
}

export function ICSFileForm() {
  const [fileName, setFileName] = useState<string | null>(null);

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setFileName(file?.name ?? null);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label
        htmlFor="ics-file"
        className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-interactive-border p-8 hover:cursor-pointer hover:bg-background-hover"
      >
        <Upload size={20} className="text-foreground-muted" />
        <p className="text-sm tracking-tight text-foreground-muted">
          {fileName ?? "Upload an ICS File"}
        </p>
        <input
          id="ics-file"
          name="ics-file"
          type="file"
          accept=".ics,.ical"
          className="sr-only"
          onChange={handleFileChange}
        />
      </label>
      <Divider />
      <div className="flex items-stretch gap-2">
        <BackButton variant="border" size="standard" className="self-stretch justify-center px-3.5" />
        <Button type="submit" className="grow justify-center">
          <ButtonText>Upload</ButtonText>
        </Button>
      </div>
    </form>
  );
}
