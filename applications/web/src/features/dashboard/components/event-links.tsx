import type { MouseEvent } from "react";
import { tv } from "tailwind-variants/lite";
import Video from "lucide-react/dist/esm/icons/video";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import { URL_PATTERN, trimUrl } from "@/lib/event-links";
import type { EventLink } from "@/lib/event-links";

const joinButton = tv({
  base: "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-(--event-accent) font-medium tracking-tight text-white hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-neutral-950",
  variants: {
    size: {
      sm: "h-6 px-2 text-xs",
      md: "h-8 px-3 text-sm",
    },
  },
});

// Card clicks open the detail panel; a link press must not also count as one.
const stopPropagation = (event: MouseEvent) => event.stopPropagation();

interface EventLinkButtonProps {
  link: EventLink;
  size: "sm" | "md";
  className?: string;
}

export function EventLinkButton({ link, size, className }: EventLinkButtonProps) {
  const Icon = link.isMeeting ? Video : ExternalLink;
  const text = link.isMeeting ? "Join" : "Open link";
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={link.url}
      aria-label={link.isMeeting ? `Join ${link.label}` : `Open ${link.label}`}
      onClick={stopPropagation}
      className={joinButton({ size, className })}
    >
      <Icon size={size === "sm" ? 12 : 14} aria-hidden />
      {size === "md" && link.isMeeting ? `${text} ${link.label}` : text}
    </a>
  );
}

const textLink = "underline decoration-(--event-ink)/40 underline-offset-2 break-all hover:decoration-(--event-ink)";

/** Plain text with each http(s) URL rendered as a new-tab link. */
export function LinkifiedText({ text }: { text: string }) {
  const parts: (string | { url: string; trailing: string })[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const url = trimUrl(match[0]);
    parts.push(text.slice(cursor, start), { url, trailing: match[0].slice(url.length) });
    cursor = start + match[0].length;
  }
  parts.push(text.slice(cursor));

  return parts.map((part, index) =>
    typeof part === "string" ? (
      part
    ) : (
      <span key={index}>
        <a
          href={part.url.replace(/&amp;/g, "&")}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stopPropagation}
          className={textLink}
        >
          {part.url}
        </a>
        {part.trailing}
      </span>
    ),
  );
}
