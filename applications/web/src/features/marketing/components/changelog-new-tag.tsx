import { Tag, TagDot, TagList } from "@/components/ui/primitives/tag";
import { changelogKindEmphasis, changelogKindLabel } from "./changelog-kinds";

/**
 * The one marker a changelog row carries: this entry is a new capability.
 *
 * It replaces the row of New / Improved / Fixed tags, which only restated the
 * note-group labels a few lines below it. Everything else is left to those
 * labels to say, where the items actually are.
 */
export function ChangelogNewTag() {
  return (
    <TagList label="What changed">
      <Tag tone="default">
        <TagDot emphasis={changelogKindEmphasis.added} />
        {changelogKindLabel.added}
      </Tag>
    </TagList>
  );
}
