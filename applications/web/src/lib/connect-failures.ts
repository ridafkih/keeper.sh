import { HTTP_STATUS } from "@keeper.sh/constants";
import {
  icsFeedFailureReasonSchema,
  oauthConnectFailureReasonSchema,
  readApiErrorMessage,
  type IcsFeedFailureReason,
  type OAuthConnectFailureReason,
} from "@keeper.sh/data-schemas";
import { HttpError } from "@/lib/fetcher";

const OAUTH_CONNECT_FAILURE_COPY: Record<OAuthConnectFailureReason, string> = {
  "access-declined": "Access wasn't granted, so nothing was connected.",
  "admin-approval-required":
    "Your organization needs an admin to approve Keeper.sh before this account can connect.",
  expired: "This connection request expired. Try connecting again.",
  "no-mailbox":
    "This Microsoft account has no Outlook mailbox to sync. Connect an account with Outlook or Exchange Online.",
  unknown: "Your calendar couldn't be connected. Try again.",
};

interface FeedFailureCopy {
  message: string;
  hint: string | null;
}

const ICS_FEED_FAILURE_COPY: Record<IcsFeedFailureReason, FeedFailureCopy> = {
  "auth-required": {
    hint: "Turn on Requires authentication and add the username and password.",
    message: "This feed needs a login.",
  },
  "not-calendar": {
    hint: "Look for a link that ends in .ics or starts with webcal://",
    message: "This link opens a web page, not a calendar.",
  },
  "not-found": {
    hint: "Check that it's the full feed URL.",
    message: "Nothing was found at this link.",
  },
  unreachable: {
    hint: "Check the link and try again.",
    message: "This feed couldn't be reached.",
  },
};

const CALENDAR_IMPORT_FAILURE = "Your calendars couldn't be imported. Try again.";
const CALENDARS_ALREADY_CONNECTED = "These calendars are already connected.";

const readIcsFeedFailureReason = (body: unknown): IcsFeedFailureReason => {
  if (typeof body !== "object" || body === null || !("reason" in body)) {
    return "unreachable";
  }
  if (!icsFeedFailureReasonSchema.allows(body.reason)) {
    return "unreachable";
  }
  return body.reason;
};

export function describeOAuthConnectFailure(reason: unknown): string {
  if (!oauthConnectFailureReasonSchema.allows(reason)) {
    return OAUTH_CONNECT_FAILURE_COPY.unknown;
  }
  return OAUTH_CONNECT_FAILURE_COPY[reason];
}

export function isAdminApprovalFailure(reason: unknown): boolean {
  return reason === "admin-approval-required";
}

export function describeIcsFeedFailure(error: unknown): FeedFailureCopy {
  if (!(error instanceof HttpError)) {
    return ICS_FEED_FAILURE_COPY.unreachable;
  }
  if (error.status === HTTP_STATUS.PAYMENT_REQUIRED) {
    const planMessage = readApiErrorMessage(error.body);
    if (planMessage) return { hint: null, message: planMessage };
    return ICS_FEED_FAILURE_COPY.unreachable;
  }
  return ICS_FEED_FAILURE_COPY[readIcsFeedFailureReason(error.body)];
}

export function describeCalendarImportFailure(error: unknown): string {
  if (!(error instanceof HttpError)) {
    return CALENDAR_IMPORT_FAILURE;
  }
  if (error.status === HTTP_STATUS.CONFLICT) {
    return CALENDARS_ALREADY_CONNECTED;
  }
  if (error.status === HTTP_STATUS.PAYMENT_REQUIRED) {
    return readApiErrorMessage(error.body) ?? CALENDAR_IMPORT_FAILURE;
  }
  return CALENDAR_IMPORT_FAILURE;
}

export type { FeedFailureCopy };
