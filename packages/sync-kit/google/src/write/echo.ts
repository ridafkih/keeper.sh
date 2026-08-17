import type { calendar_v3 } from "@googleapis/calendar";
import type { EchoVerdict, NormalizedContent } from "@keeper.sh/sync-protocol";
import { contentOfPatch, decodeEvent } from "../decode/decode-event";
import { decodeEventTime } from "../decode/event-time";
import { fingerprintContent } from "../fingerprint";

const diverged: EchoVerdict = {
  kind: "diverged",
  fields: { sample: ["content"], total: 1 },
};

const echoVerdict = (
  submitted: NormalizedContent<"google">,
  returned: calendar_v3.Schema$Event | null,
  hash: (input: string) => string,
): EchoVerdict => {
  if (returned === null) {
    return { kind: "notObserved" };
  }
  const decoded = decodeEvent(returned, decodeEventTime);
  if (decoded.kind !== "patch") {
    return diverged;
  }
  const observed = fingerprintContent(contentOfPatch(decoded.fields), hash);
  if (observed.value !== submitted.fingerprint.value) {
    return diverged;
  }
  return { kind: "matched" };
};

export { echoVerdict };
