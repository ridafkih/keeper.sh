/**
 * The three kinds a change can be, and how each one is marked.
 *
 * All the changelog-specific knowledge lives here and in
 * `changelog-new-tag.tsx`: the primitives in `ui/primitives/tag.tsx` know
 * nothing about releases.
 */

export type ChangelogKind = "added" | "improved" | "fixed";

export const CHANGELOG_KINDS = ["added", "improved", "fixed"] as const;

export const changelogKindLabel: Record<ChangelogKind, string> = {
  added: "New",
  improved: "Improved",
  fixed: "Fixed",
};

/** Weight and fill stand in for colour, which the theme does not carry. */
export const changelogKindEmphasis: Record<ChangelogKind, "strong" | "soft" | "outline"> = {
  added: "strong",
  improved: "soft",
  fixed: "outline",
};
