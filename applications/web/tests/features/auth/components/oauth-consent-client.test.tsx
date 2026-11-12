import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsentClientSummary } from "../../../../src/features/auth/components/oauth-consent-client";

describe("ConsentClientSummary", () => {
  it("names the app as unverified and shows where approval sends the user", () => {
    const markup = renderToStaticMarkup(
      <ConsentClientSummary clientName="Claude" redirectDestination="claude.ai" />,
    );

    expect(markup).toContain("An app calling itself");
    expect(markup).toContain("“Claude”");
    expect(markup).toContain("hasn&#x27;t verified this name");
    expect(markup).toContain("claude.ai");
  });

  it("says so when the app gave no name", () => {
    const markup = renderToStaticMarkup(
      <ConsentClientSummary clientName={null} redirectDestination="attacker.example" />,
    );

    expect(markup).toContain("didn&#x27;t give a name");
    expect(markup).toContain("attacker.example");
  });

  it("renders a hostile name as text", () => {
    const markup = renderToStaticMarkup(
      <ConsentClientSummary clientName={'<img src=x onerror="alert(1)">'} redirectDestination={null} />,
    );

    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;img");
  });

  it("leaves out the destination when the redirect can't be read", () => {
    const markup = renderToStaticMarkup(
      <ConsentClientSummary clientName="Claude" redirectDestination={null} />,
    );

    expect(markup).not.toContain("you&#x27;ll be sent to");
  });
});
