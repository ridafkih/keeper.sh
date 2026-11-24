import { MEETING_LINK_LABELS } from "./meeting-link-labels";

const MEETING_LINK_SEPARATOR = "\n\n";

const resolveMeetingLinkLabel = (link: string): string =>
  MEETING_LINK_LABELS.byHost[new URL(link).hostname] ?? MEETING_LINK_LABELS.unknownHost;

const formatMeetingLinkLine = (link: string): string =>
  `${resolveMeetingLinkLabel(link)}: ${link}`;

const appendMeetingLink = (description: string | undefined, link: string): string => {
  if (!description) {
    return formatMeetingLinkLine(link);
  }
  if (description.includes(link)) {
    return description;
  }
  return `${description}${MEETING_LINK_SEPARATOR}${formatMeetingLinkLine(link)}`;
};

export { appendMeetingLink, formatMeetingLinkLine };
