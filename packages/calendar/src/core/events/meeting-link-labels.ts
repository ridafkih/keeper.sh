interface MeetingLinkLabels {
  byHost: Readonly<Record<string, string>>;
  unknownHost: string;
}

const MEETING_LINK_LABELS: MeetingLinkLabels = {
  byHost: {
    "meet.google.com": "Join Google Meet",
  },
  unknownHost: "Join video meeting",
};

export { MEETING_LINK_LABELS };
