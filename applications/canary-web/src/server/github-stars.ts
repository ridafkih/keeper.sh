import { createStaleCache } from "./cache/stale-cache";

export interface GithubStarsSnapshot {
  count: number;
  fetchedAt: string;
}

function hasStargazersCount(value: unknown): value is { stargazers_count: number } {
  if (typeof value !== "object" || value === null) return false;
  return (
    "stargazers_count" in value &&
    typeof value.stargazers_count === "number" &&
    Number.isInteger(value.stargazers_count) &&
    value.stargazers_count >= 0
  );
}

const githubRepositoryApiUrl = "https://api.github.com/repos/ridafkih/keeper.sh";
const githubApiVersion = "2022-11-28";
const githubUserAgent = "@keeper.sh/web";

async function fetchGithubStarsCount(): Promise<number> {
  const response = await fetch(githubRepositoryApiUrl, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": githubUserAgent,
      "x-github-api-version": githubApiVersion,
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub stars request failed: ${response.status} ${response.statusText}`);
  }

  const json: unknown = await response.json();
  if (!hasStargazersCount(json)) {
    throw new Error("Invalid GitHub stars response");
  }

  return json.stargazers_count;
}

const githubStarsCache = createStaleCache<number>({
  load: fetchGithubStarsCount,
  name: "github-stars",
  ttlMs: 1000 * 60 * 30,
});

export async function getGithubStarsSnapshot(): Promise<GithubStarsSnapshot> {
  const snapshot = await githubStarsCache.getSnapshot();
  return {
    count: snapshot.value,
    fetchedAt: new Date(snapshot.fetchedAtMs).toISOString(),
  };
}
