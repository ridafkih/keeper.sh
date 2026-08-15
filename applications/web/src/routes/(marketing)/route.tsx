import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { jsonLdScript, organizationSchema } from '../../lib/seo'
import { Layout, LayoutItem } from '../../components/ui/shells/layout'
import { MarketingHeader, MarketingHeaderActions, MarketingHeaderBranding, MarketingHeaderMenu, MarketingHeaderNav } from '../../features/marketing/components/marketing-header'
import { MarketingFooter, MarketingFooterTagline, MarketingFooterNav, MarketingFooterNavGroup, MarketingFooterNavGroupLabel, MarketingFooterNavItem } from '../../features/marketing/components/marketing-footer'
import KeeperLogo from "@/assets/keeper.svg?react";
import { ButtonText, LinkButton } from '../../components/ui/primitives/button';
import { SessionSlot } from '../../components/ui/shells/session-slot';
import HeartIcon from "lucide-react/dist/esm/icons/heart";
import { ExternalTextLink } from "@/components/ui/primitives/text-link";
import { CookieConsent } from "@/components/consent-banner";

interface GithubStarsLoaderData {
  count: number | null;
  fetchedAt: string | null;
}

export const Route = createFileRoute('/(marketing)')({
  beforeLoad: ({ context }) => {
    if (!context.runtimeConfig.commercialMode) {
      const hasSession = context.auth.hasSession();
      throw redirect({ to: hasSession ? "/dashboard" : "/login" });
    }
  },
  loader: async ({ context }) => {
    try {
      return await context.fetchWeb<GithubStarsLoaderData>("/internal/github-stars");
    } catch {
      return {
        count: null,
        fetchedAt: null,
      } satisfies GithubStarsLoaderData;
    }
  },
  head: () => ({
    scripts: [jsonLdScript(organizationSchema)],
  }),
  component: MarketingLayout,
})

function MarketingLayout() {
  return (
    <>
      <MarketingHeader>
        <MarketingHeaderBranding label="Keeper.sh home">
          <KeeperLogo className="size-7 shrink-0" aria-hidden="true" />
        </MarketingHeaderBranding>
        <MarketingHeaderNav />
        <MarketingHeaderActions>
          <span className="contents max-md:[body:has(#marketing-header-menu)_&]:hidden">
            <SessionSlot
              authenticated={
                <LinkButton size="compact" variant="highlight" to="/dashboard">
                  <ButtonText>Dashboard</ButtonText>
                </LinkButton>
              }
              unauthenticated={
                <>
                  <span className="hidden xs:contents">
                    <LinkButton size="compact" variant="elevated" to="/login">
                      <ButtonText>Login</ButtonText>
                    </LinkButton>
                  </span>
                  <LinkButton size="compact" variant="highlight" to="/register">
                    <ButtonText>Register</ButtonText>
                  </LinkButton>
                </>
              }
            />
          </span>
          <MarketingHeaderMenu />
        </MarketingHeaderActions>
      </MarketingHeader>
      <Layout>
      <LayoutItem>
        <main>
          <Outlet />
        </main>
      </LayoutItem>
      <LayoutItem>
        <MarketingFooter>
          <MarketingFooterTagline>
            Made with <HeartIcon size={12} className="inline text-red-500 fill-red-500 relative -top-px" aria-hidden="true" /> by{" "}
            <ExternalTextLink
              align="left"
              href="https://rida.dev"
              rel="noopener noreferrer"
              size="sm"
              target="_blank"
              tone="muted"
            >
              Rida F'kih
            </ExternalTextLink>
          </MarketingFooterTagline>
          <MarketingFooterNav>
            <MarketingFooterNavGroup>
              <MarketingFooterNavGroupLabel>Product</MarketingFooterNavGroupLabel>
              <MarketingFooterNavItem to="/register">Create an Account</MarketingFooterNavItem>
              <MarketingFooterNavItem to="/features">Features</MarketingFooterNavItem>
              <MarketingFooterNavItem to="/pricing">Pricing</MarketingFooterNavItem>
              <MarketingFooterNavItem to="/self-hosting">Self-Hosting</MarketingFooterNavItem>
            </MarketingFooterNavGroup>
            <MarketingFooterNavGroup>
              <MarketingFooterNavGroupLabel>Resources</MarketingFooterNavGroupLabel>
              <MarketingFooterNavItem to="/blog">Blog</MarketingFooterNavItem>
              <MarketingFooterNavItem to="/about">About</MarketingFooterNavItem>
              <MarketingFooterNavItem to="/tools/ics-generator">ICS File Generator</MarketingFooterNavItem>
              <MarketingFooterNavItem to="/tools/ics-viewer">ICS File Viewer</MarketingFooterNavItem>
              <MarketingFooterNavItem href="https://github.com/ridafkih/keeper.sh">GitHub</MarketingFooterNavItem>
            </MarketingFooterNavGroup>
            <MarketingFooterNavGroup>
              <MarketingFooterNavGroupLabel>Legal</MarketingFooterNavGroupLabel>
              <MarketingFooterNavItem to="/privacy">Privacy Policy</MarketingFooterNavItem>
              <MarketingFooterNavItem to="/terms">Terms of Service</MarketingFooterNavItem>
            </MarketingFooterNavGroup>
          </MarketingFooterNav>
        </MarketingFooter>
      </LayoutItem>
    </Layout>
    <CookieConsent />
    </>
  )
}
