import { createFileRoute, Outlet } from '@tanstack/react-router'
import { JsonLd, organizationSchema } from '../../lib/seo'
import { Layout, LayoutItem } from '../../components/ui/shells/layout'
import { MarketingHeader, MarketingHeaderActions, MarketingHeaderBranding } from '../../features/marketing/components/marketing-header'
import { MarketingFooter, MarketingFooterTagline, MarketingFooterNav, MarketingFooterNavGroup, MarketingFooterNavGroupLabel, MarketingFooterNavItem } from '../../features/marketing/components/marketing-footer'
import KeeperLogo from "../../assets/keeper.svg?react";
import { ButtonText, LinkButton } from '../../components/ui/primitives/button';
import { GithubStarButton } from '../../components/ui/primitives/github-star-button';
import { SessionSlot } from '../../components/ui/shells/session-slot';
import HeartIcon from "lucide-react/dist/esm/icons/heart";
import { ExternalTextLink } from "../../components/ui/primitives/text-link";

interface GithubStarsLoaderData {
  count: number | null;
  fetchedAt: string | null;
}

export const Route = createFileRoute('/(marketing)')({
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
  component: MarketingLayout,
})

function MarketingLayout() {
  const githubStars = Route.useLoaderData();

  return (
    <>
      <JsonLd data={organizationSchema} />
      <MarketingHeader>
        <MarketingHeaderBranding>
          <KeeperLogo className="w-full max-w-6" />
        </MarketingHeaderBranding>
        <SessionSlot
          authenticated={
            <MarketingHeaderActions>
              <GithubStarButton initialStarCount={githubStars.count} />
              <LinkButton size="compact" variant="highlight" to="/dashboard">
                <ButtonText>Dashboard</ButtonText>
              </LinkButton>
            </MarketingHeaderActions>
          }
          unauthenticated={
            <MarketingHeaderActions>
              <GithubStarButton initialStarCount={githubStars.count} />
              <LinkButton size="compact" variant="border" to="/login">
                <ButtonText>Login</ButtonText>
              </LinkButton>
              <LinkButton size="compact" variant="highlight" to="/register">
                <ButtonText>Register</ButtonText>
              </LinkButton>
            </MarketingHeaderActions>
          }
        />
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
            Made with <HeartIcon size={12} className="inline text-red-500 fill-red-500 relative -top-px" /> by{" "}
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
              <MarketingFooterNavItem to="/register">Get Started</MarketingFooterNavItem>
              <MarketingFooterNavItem to="/#features">Features</MarketingFooterNavItem>
              <MarketingFooterNavItem to="/#pricing">Pricing</MarketingFooterNavItem>
            </MarketingFooterNavGroup>
            <MarketingFooterNavGroup>
              <MarketingFooterNavGroupLabel>Resources</MarketingFooterNavGroupLabel>
              <MarketingFooterNavItem to="/blog">Blog</MarketingFooterNavItem>
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
    </>
  )
}
