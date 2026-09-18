/*
 * Google writes its conference details between two canonical delimiters and
 * treats the region as its own: on write it deletes everything the region
 * holds, because a mirrored copy carries no conference. Removing the two
 * delimiters hands Google the meeting details as ordinary content, which it
 * keeps. A source may have wrapped the block in markup, so the marker itself is
 * the anchor rather than the line it sits on, and the break it occupied goes
 * with it.
 */
const CONFERENCE_DELIMITER = /(\n[^\S\n]*)?-::~:~::[-:~]{40,}::~:~::-[^\S\n]*(\n)?/g;

/** Prose on both sides keeps the line break between them; an edge keeps none. */
const readDelimiterGap = (before?: string, after?: string): string => {
  if (before === globalThis.undefined || after === globalThis.undefined) {
    return "";
  }

  return "\n";
};

const stripConferenceDelimiters = (value: string | undefined): string | undefined => {
  if (!value) {
    return value;
  }

  return value.replaceAll(
    CONFERENCE_DELIMITER,
    (_match, before?: string, after?: string) => readDelimiterGap(before, after),
  );
};

/*
 * The mirror is compared against what Google reports back, and Google owns the
 * delimited region: a block it writes there on its own is not content Keeper
 * authored, so dropping the whole region on read keeps the comparison from
 * diverging forever over text no write of ours can reproduce.
 */
const stripConferenceRegion = (value: string | undefined): string | undefined => {
  if (!value) {
    return value;
  }

  const markers = [...value.matchAll(CONFERENCE_DELIMITER)];
  const [opening] = markers;
  const closing = markers.at(-1);
  if (!opening || !closing || opening === closing) {
    return stripConferenceDelimiters(value);
  }

  const before = value.slice(0, opening.index);
  const after = value.slice(closing.index + closing[0].length);
  return `${before}${readDelimiterGap(before || globalThis.undefined, after || globalThis.undefined)}${after}`;
};

export { stripConferenceDelimiters, stripConferenceRegion };
