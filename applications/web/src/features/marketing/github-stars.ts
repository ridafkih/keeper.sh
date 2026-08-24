export function formatStarCount(starCount: number): string {
  const formattedStarCount = new Intl.NumberFormat("en-US", {
    compactDisplay: "short",
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(starCount);

  return `${formattedStarCount} ${starCount === 1 ? "star" : "stars"}`;
}
