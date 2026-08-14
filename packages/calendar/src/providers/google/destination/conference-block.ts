/*
 * Google writes its conference details between two canonical delimiter lines
 * and treats the region as its own: on write it deletes everything the region
 * holds, because a mirrored copy carries no conference. Removing the two lines
 * hands Google the meeting details as ordinary text, which it keeps.
 */
const CONFERENCE_DELIMITER_LINE = /^-::~:~::[-:~]{40,}::~:~::-$/;

const stripConferenceDelimiters = (value: string | undefined): string | undefined => {
  if (!value) {
    return value;
  }
  const lines = value.split("\n");
  const kept = lines.filter((line) => !CONFERENCE_DELIMITER_LINE.test(line.trim()));

  if (kept.length === lines.length) {
    return value;
  }

  return kept.join("\n").trim();
};

export { stripConferenceDelimiters };
