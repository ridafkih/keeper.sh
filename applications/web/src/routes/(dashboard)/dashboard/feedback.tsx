import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BackButton } from "@/components/ui/primitives/back-button";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { Text } from "@/components/ui/primitives/text";
import { Button, ButtonText, LinkButton } from "@/components/ui/primitives/button";
import { apiFetch } from "@/lib/fetcher";
import { resolveErrorMessage } from "@/utils/errors";

export const Route = createFileRoute("/(dashboard)/dashboard/feedback")({
  component: FeedbackPage,
});

function FeedbackPage() {
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    const message = messageRef.current?.value.trim();

    if (!message) return;

    setError(null);
    setIsSubmitting(true);

    try {
      await apiFetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, type: "feedback" }),
      });
      setSubmitted(true);
    } catch (err) {
      setError(resolveErrorMessage(err, "Failed to submit feedback."));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex flex-col gap-3">
        <BackButton />
        <DashboardSection
          title="Thank You"
          description="Your feedback has been submitted. We appreciate you taking the time to help us improve."
          level={1}
        />
        <LinkButton to="/dashboard" variant="elevated" className="w-full justify-center">
          <ButtonText>Back to Dashboard</ButtonText>
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <BackButton />
      <DashboardSection
        title="Submit Feedback"
        description="Let us know how we can improve your experience."
        level={1}
      />
      <div className="flex flex-col gap-2">
        <textarea
          ref={messageRef}
          placeholder="Tell us what's on your mind..."
          rows={5}
          className="w-full rounded-xl border border-interactive-border bg-background px-4 py-2.5 text-foreground tracking-tight placeholder:text-foreground-muted resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {error && <Text size="sm" tone="danger">{error}</Text>}
        <Button className="w-full justify-center" onClick={handleSubmit} disabled={isSubmitting}>
          <ButtonText>{isSubmitting ? "Submitting..." : "Submit Feedback"}</ButtonText>
        </Button>
      </div>
    </div>
  );
}
