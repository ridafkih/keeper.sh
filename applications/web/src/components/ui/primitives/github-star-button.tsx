import { AnimatePresence } from "motion/react";
import Star from "lucide-react/dist/esm/icons/star";
import {
  Component,
  type PropsWithChildren,
  useEffect,
  useState,
} from "react";
import useSWRImmutable from "swr/immutable";
import { ButtonText, ExternalLinkButton } from "./button";
import { FadeIn } from "./fade-in";

const SCROLL_THRESHOLD = 32;
const GITHUB_STARS_ENDPOINT_PATH = "/internal/github-stars";
const GITHUB_REPOSITORY_URL = "https://github.com/ridafkih/keeper.sh";

interface GithubStarsResponse {
  fetchedAt: string;
  count: number;
}

function isGithubStarsResponse(value: unknown): value is GithubStarsResponse {
  if (typeof value !== "object" || value === null) return false;
  return (
    "fetchedAt" in value &&
    typeof value.fetchedAt === "string" &&
    "count" in value &&
    typeof value.count === "number" &&
    Number.isInteger(value.count) &&
    value.count >= 0
  );
}

function formatStarCount(starCount: number): string {
  return new Intl.NumberFormat("en-US", {
    compactDisplay: "short",
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(starCount);
}

async function fetchGithubStarCount(url: string): Promise<number> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `GitHub stars request failed: ${response.status} ${response.statusText}`,
    );
  }

  const json: unknown = await response.json();
  if (!isGithubStarsResponse(json)) {
    throw new Error("Invalid GitHub stars payload");
  }

  return json.count;
}

interface GithubStarButtonProps {
  initialStarCount: number | null;
}

interface GithubStarButtonShellProps {
  countLabel?: string;
}

interface GithubStarErrorBoundaryState {
  hasError: boolean;
}

class GithubStarErrorBoundary extends Component<
  PropsWithChildren,
  GithubStarErrorBoundaryState
> {
  state: GithubStarErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): GithubStarErrorBoundaryState {
    return {
      hasError: true,
    };
  }

  render() {
    if (this.state.hasError) {
      return <GithubStarButtonShell />;
    }

    return this.props.children;
  }
}

function GithubStarButtonShell({ countLabel }: GithubStarButtonShellProps) {
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
      {typeof countLabel === "string" ? <ButtonText>{countLabel}</ButtonText> : null}
    </ExternalLinkButton>
  );
}

function GithubStarButtonCount({ initialStarCount }: GithubStarButtonProps) {
  const { data: starCount, error } = useSWRImmutable<number>(
    GITHUB_STARS_ENDPOINT_PATH,
    fetchGithubStarCount,
    typeof initialStarCount === "number"
      ? { fallbackData: initialStarCount }
      : undefined,
  );

  if (error) {
    return <GithubStarButtonShell />;
  }

  if (typeof starCount !== "number") {
    return <GithubStarButtonShell countLabel="…" />;
  }

  const formattedStarCount = formatStarCount(starCount);

  return <GithubStarButtonShell countLabel={formattedStarCount} />;
}

export function GithubStarButton({ initialStarCount }: GithubStarButtonProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY <= SCROLL_THRESHOLD);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <FadeIn direction="from-right">
          <GithubStarErrorBoundary>
            <GithubStarButtonCount initialStarCount={initialStarCount} />
          </GithubStarErrorBoundary>
        </FadeIn>
      )}
    </AnimatePresence>
  );
}
