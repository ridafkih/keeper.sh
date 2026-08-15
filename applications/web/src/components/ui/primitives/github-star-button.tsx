import Star from "lucide-react/dist/esm/icons/star";
import { formatStarCount } from "@/features/marketing/github-stars";
import { ButtonText, ExternalLinkButton } from "./button";

const GITHUB_REPOSITORY_URL = "https://github.com/ridafkih/keeper.sh";

interface GithubStarButtonProps {
  /** Server-rendered star count from the marketing loader, or null when it could not be fetched. */
  starCount: number | null;
}

/**
 * Renders the GitHub star count that the marketing route loader already resolved on the
 * server. It never fetches on the client, so the label is identical before and after
 * hydration and the control cannot change width on load.
 */
export function GithubStarButton({ starCount }: GithubStarButtonProps) {
  const countLabel = typeof starCount === "number" ? formatStarCount(starCount) : "GitHub";

  return (
    <ExternalLinkButton
      size="compact"
      variant="ghost"
      href={GITHUB_REPOSITORY_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="Star Keeper.sh on GitHub"
    >
      <Star size={14} aria-hidden="true" />
      <ButtonText>{countLabel}</ButtonText>
    </ExternalLinkButton>
  );
}
