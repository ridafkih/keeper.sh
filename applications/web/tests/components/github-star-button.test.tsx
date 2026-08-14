import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { useSWRImmutableMock } = vi.hoisted(() => ({
  useSWRImmutableMock: vi.fn<() => { data?: number; error?: Error }>(() => ({})),
}));

vi.mock("swr/immutable", () => ({
  default: useSWRImmutableMock,
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock("../../src/components/ui/primitives/fade-in", () => ({
  FadeIn: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

vi.mock("lucide-react/dist/esm/icons/github", () => ({
  default: (props: React.ComponentPropsWithoutRef<"svg">) => <svg {...props} />,
}));

let GithubStarButton: typeof import("../../src/components/ui/primitives/github-star-button").GithubStarButton;

beforeAll(async () => {
  ({ GithubStarButton } = await import("../../src/components/ui/primitives/github-star-button"));
});

beforeEach(() => {
  useSWRImmutableMock.mockReturnValue({});
});

describe("GithubStarButton", () => {
  it("labels the count as GitHub stars", () => {
    useSWRImmutableMock.mockReturnValue({ data: 1243 });

    const markup = renderToStaticMarkup(<GithubStarButton initialStarCount={1243} />);

    expect(markup).toContain("1.2K stars");
  });

  it("keeps the label singular for a single star", () => {
    useSWRImmutableMock.mockReturnValue({ data: 1 });

    const markup = renderToStaticMarkup(<GithubStarButton initialStarCount={1} />);

    expect(markup).toContain("1 star");
    expect(markup).not.toContain("1 stars");
  });

  it("falls back to a GitHub label when the count is unavailable", () => {
    useSWRImmutableMock.mockReturnValue({ error: new Error("unavailable") });

    const markup = renderToStaticMarkup(<GithubStarButton initialStarCount={null} />);

    expect(markup).toContain("GitHub");
    expect(markup).not.toContain("stars");
  });

  it("renders as a bordered link to the repository", () => {
    useSWRImmutableMock.mockReturnValue({ data: 1243 });

    const markup = renderToStaticMarkup(<GithubStarButton initialStarCount={1243} />);

    expect(markup).toContain("border-interactive-border");
    expect(markup).toContain('href="https://github.com/ridafkih/keeper.sh"');
  });
});
