import type { PropsWithChildren, ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Heading1, Heading2, Heading3 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";
import { ButtonIcon, ButtonText, ExternalLinkButton, LinkButton } from "@/components/ui/primitives/button";
import {
  MarkdownCodeBlock,
  MarkdownInlineCode,
  MarkdownTable,
  MarkdownTableBody,
  MarkdownTableCell,
  MarkdownTableHeader,
  MarkdownTableRow,
  MarkdownTableSection,
} from "@/components/ui/primitives/markdown-components";
import { ListItem, OrderedList } from "@/components/ui/primitives/list";
import { MarketingCtaCard, MarketingCtaSection } from "@/features/marketing/components/marketing-cta";
import {
  MCP_CLIENT_CONFIG_SNIPPET,
  MCP_DISCOVERY_SNIPPET,
  MCP_OAUTH_SCOPES,
  MCP_SERVER_URL,
  MCP_TOOL_GROUPS,
  REST_CREATE_EVENT_SNIPPET,
  REST_CURL_SNIPPET,
  REST_ENDPOINTS,
  REST_FREE_TIME_SNIPPET,
} from "@/features/marketing/mcp-documentation";
import { jsonLdScript, seoHead, webPageSchema, breadcrumbSchema, breadcrumbTrail } from "@/lib/seo";
import { ANALYTICS_EVENTS } from "@/lib/analytics";
import ArrowRightIcon from "lucide-react/dist/esm/icons/arrow-right";
import ArrowUpRightIcon from "lucide-react/dist/esm/icons/arrow-up-right";

const PAGE_TITLE = "MCP Server & REST API";

const PAGE_DESCRIPTION =
  "Documentation for the Keeper.sh MCP server and REST API. Connect an MCP client over OAuth 2.1 to read and write every calendar you have synced, or call the same endpoints with an API token.";

const breadcrumbs = breadcrumbTrail({ name: PAGE_TITLE, path: "/docs/mcp" });

type WorkedExample = {
  prompt: string;
  explanation: string;
  calls: string[];
};

const WORKED_EXAMPLES: WorkedExample[] = [
  {
    prompt: "“What does my Thursday look like across all my calendars?”",
    explanation:
      "One read covers every connected calendar, so the assistant does not need to know which provider an event came from. Each event carries its calendar name and provider back with it.",
    calls: [
      "get_events(from: \"2026-09-10T00:00:00Z\", to: \"2026-09-11T00:00:00Z\", timezone: \"America/New_York\")",
    ],
  },
  {
    prompt: "“Find 45 minutes next week that works for me and book a design review.”",
    explanation:
      "find_free_time reads busy time from every calendar at once, then create_event writes the booking back to the provider that owns the calendar you name.",
    calls: [
      "find_free_time(from: …, to: …, timezone: \"America/New_York\", durationMinutes: 45, workingHoursStart: \"09:00\", workingHoursEnd: \"17:00\", workingDays: \"1,2,3,4,5\")",
      "list_calendars()",
      "create_event(calendarId: …, title: \"Design review\", startTime: …, endTime: …, timezone: \"America/New_York\")",
    ],
  },
  {
    prompt: "“Decline anything on my work calendar I have not answered yet.”",
    explanation:
      "Invitations are listed per calendar, and the RSVP is written back to the provider, so the organizer sees the response.",
    calls: [
      "get_pending_invites(calendarId: …, from: …, to: …, timezone: \"America/New_York\")",
      "rsvp_event(eventId: …, rsvpStatus: \"declined\")",
    ],
  },
];

export const Route = createFileRoute("/(marketing)/docs/mcp")({
  component: McpDocumentationPage,
  head: () => seoHead({
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    path: "/docs/mcp",
    scripts: [
      jsonLdScript(webPageSchema(PAGE_TITLE, PAGE_DESCRIPTION, "/docs/mcp")),
      jsonLdScript(breadcrumbSchema(breadcrumbs)),
    ],
  }),
});

function DocsSection({ id, title, children }: PropsWithChildren<{ id: string; title: string }>) {
  return (
    <section id={id} className="flex flex-col gap-3 scroll-mt-24">
      <Heading2 as="h2">{title}</Heading2>
      {children}
    </section>
  );
}

function DocsParagraph({ children }: PropsWithChildren) {
  return (
    <Text size="sm" tone="muted" className="max-w-[72ch] leading-7">
      {children}
    </Text>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <MarkdownCodeBlock>
      <code>{children}</code>
    </MarkdownCodeBlock>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <MarkdownInlineCode>{children}</MarkdownInlineCode>;
}

function McpDocumentationPage() {
  return (
    <div className="flex flex-col gap-10 py-16">
      <Breadcrumb items={breadcrumbs} />

      <header className="flex flex-col gap-1.5">
        <Heading1>{PAGE_TITLE}</Heading1>
        <Text size="base" tone="muted" className="max-w-[72ch] leading-6">
          {PAGE_DESCRIPTION}
        </Text>
      </header>

      <DocsSection id="overview" title="What the server does">
        <DocsParagraph>
          Keeper.sh syncs events between Google Calendar, Outlook, iCloud, Fastmail, CalDAV servers, and iCal
          links. The MCP server puts that same merged view in front of an assistant: one connection reads and
          writes every calendar you have connected, rather than one integration per provider.
        </DocsParagraph>
        <DocsParagraph>
          It speaks the Model Context Protocol over streamable HTTP at <Code>{MCP_SERVER_URL}</Code>, and every
          tool is a thin wrapper over the public REST API described further down. Writes go through to the
          provider that owns the calendar, so an event an assistant creates appears in Google Calendar or Outlook
          exactly like one you made by hand, and Keeper.sh keeps syncing it from there.
        </DocsParagraph>
        <DocsParagraph>
          Self-hosted instances serve the same endpoint at <Code>/mcp</Code> on your own domain. Everything on
          this page applies to them, with your instance URL in place of <Code>www.keeper.sh</Code>.
        </DocsParagraph>
      </DocsSection>

      <DocsSection id="quickstart" title="Quickstart">
        <DocsParagraph>
          You need a Keeper.sh account with at least one calendar connected. There is no key to copy: the client
          registers itself and you approve it in the browser.
        </DocsParagraph>
        <OrderedList>
          <ListItem>
            <Text as="span" size="sm" tone="muted">
              Point an MCP client at <Code>{MCP_SERVER_URL}</Code>.
            </Text>
          </ListItem>
          <ListItem>
            <Text as="span" size="sm" tone="muted">
              The first request comes back <Code>401</Code> with a <Code>WWW-Authenticate</Code> header, and the
              client follows it into the OAuth flow.
            </Text>
          </ListItem>
          <ListItem>
            <Text as="span" size="sm" tone="muted">
              Sign in and approve the consent screen. The client stores the tokens it gets back.
            </Text>
          </ListItem>
          <ListItem>
            <Text as="span" size="sm" tone="muted">
              Ask it something like “what is on my calendar tomorrow?”. It should call <Code>get_events</Code>.
            </Text>
          </ListItem>
        </OrderedList>
        <DocsParagraph>Configuration for a client that takes a JSON server list:</DocsParagraph>
        <CodeBlock>{MCP_CLIENT_CONFIG_SNIPPET}</CodeBlock>
      </DocsSection>

      <DocsSection id="authentication" title="Authentication with OAuth 2.1">
        <DocsParagraph>
          The MCP server is an OAuth 2.1 protected resource. It never sees your password, and there is nothing to
          paste into a client.
        </DocsParagraph>
        <DocsParagraph>
          An unauthenticated request is answered <Code>401</Code> with{" "}
          <Code>WWW-Authenticate: Bearer resource_metadata=…</Code>, which points at the protected resource
          metadata document. That document names the authorization server, and the client discovers the rest from
          there.
        </DocsParagraph>
        <CodeBlock>{MCP_DISCOVERY_SNIPPET}</CodeBlock>
        <DocsParagraph>
          Clients register themselves through dynamic client registration, so you do not create an OAuth app
          first. Authorization uses the authorization code flow with PKCE, and the consent screen is hosted by
          Keeper.sh at <Code>/oauth/consent</Code>. Access tokens last 30 days and refresh tokens 90 days; a
          client that asks for <Code>offline_access</Code> can refresh without sending you back through consent.
        </DocsParagraph>
        <DocsParagraph>
          Every tool call requires the <Code>keeper.read</Code> scope. A token without it is answered{" "}
          <Code>403</Code> with <Code>error=&quot;insufficient_scope&quot;</Code>. The scopes a client may
          request are:
        </DocsParagraph>
        <MarkdownTable>
          <MarkdownTableSection>
            <MarkdownTableRow>
              <MarkdownTableHeader>Scope</MarkdownTableHeader>
              <MarkdownTableHeader>Covers</MarkdownTableHeader>
            </MarkdownTableRow>
          </MarkdownTableSection>
          <MarkdownTableBody>
            {MCP_OAUTH_SCOPES.map((entry) => (
              <MarkdownTableRow key={entry.scope}>
                <MarkdownTableCell>
                  <Code>{entry.scope}</Code>
                </MarkdownTableCell>
                <MarkdownTableCell>{entry.description}</MarkdownTableCell>
              </MarkdownTableRow>
            ))}
          </MarkdownTableBody>
        </MarkdownTable>
        <DocsParagraph>
          Write tools are covered by the same grant: the token is passed straight through to the REST API, which
          authorizes it as your account. Revoking access in the dashboard cuts the client off from both.
        </DocsParagraph>
      </DocsSection>

      <DocsSection id="tools" title="Tools">
        <DocsParagraph>
          The server exposes {MCP_TOOL_GROUPS.reduce((total, group) => total + group.tools.length, 0)} tools.
          Date ranges are ISO 8601 datetimes, and read tools that take a <Code>timezone</Code> return times
          already localized to it, so an assistant does not have to convert anything itself.
        </DocsParagraph>
        <div className="flex flex-col gap-8">
          {MCP_TOOL_GROUPS.map((group) => (
            <div key={group.title} className="flex flex-col gap-2">
              <Heading3 as="h3">{group.title}</Heading3>
              <Text size="sm" tone="muted" className="max-w-[72ch] leading-7">
                {group.description}
              </Text>
              <MarkdownTable>
                <MarkdownTableSection>
                  <MarkdownTableRow>
                    <MarkdownTableHeader>Tool</MarkdownTableHeader>
                    <MarkdownTableHeader>What it does</MarkdownTableHeader>
                    <MarkdownTableHeader>Arguments</MarkdownTableHeader>
                  </MarkdownTableRow>
                </MarkdownTableSection>
                <MarkdownTableBody>
                  {group.tools.map((tool) => (
                    <MarkdownTableRow key={tool.name}>
                      <MarkdownTableCell>
                        <Code>{tool.name}</Code>
                      </MarkdownTableCell>
                      <MarkdownTableCell>{tool.summary}</MarkdownTableCell>
                      <MarkdownTableCell>{tool.arguments}</MarkdownTableCell>
                    </MarkdownTableRow>
                  ))}
                </MarkdownTableBody>
              </MarkdownTable>
            </div>
          ))}
        </div>
      </DocsSection>

      <DocsSection id="examples" title="Worked examples">
        <DocsParagraph>
          What a session actually looks like. The prompts are yours; the calls are what the assistant makes.
        </DocsParagraph>
        <div className="flex flex-col gap-6">
          {WORKED_EXAMPLES.map((example) => (
            <div key={example.prompt} className="flex flex-col gap-2">
              <Heading3 as="h3">{example.prompt}</Heading3>
              <Text size="sm" tone="muted" className="max-w-[72ch] leading-7">
                {example.explanation}
              </Text>
              <CodeBlock>{example.calls.join("\n")}</CodeBlock>
            </div>
          ))}
        </div>
      </DocsSection>

      <DocsSection id="rest-api" title="REST API">
        <DocsParagraph>
          The MCP tools call the same public API you can call yourself, under <Code>/api/v1</Code>. Anything an
          assistant can do through MCP you can do with <Code>curl</Code>.
        </DocsParagraph>
        <DocsParagraph>
          Create a token from Settings → API Tokens in the dashboard. Tokens are prefixed with{" "}
          <Code>kpr_</Code> and shown once, at creation. Pass one as a bearer token. The same routes also accept
          a logged-in browser session or an MCP OAuth access token, so all three callers reach the same handlers.
        </DocsParagraph>
        <CodeBlock>{REST_CURL_SNIPPET}</CodeBlock>
        <MarkdownTable>
          <MarkdownTableSection>
            <MarkdownTableRow>
              <MarkdownTableHeader>Endpoint</MarkdownTableHeader>
              <MarkdownTableHeader>Description</MarkdownTableHeader>
            </MarkdownTableRow>
          </MarkdownTableSection>
          <MarkdownTableBody>
            {REST_ENDPOINTS.map((endpoint) => (
              <MarkdownTableRow key={`${endpoint.method} ${endpoint.path}`}>
                <MarkdownTableCell>
                  <Code>
                    {endpoint.method} {endpoint.path}
                  </Code>
                </MarkdownTableCell>
                <MarkdownTableCell>{endpoint.description}</MarkdownTableCell>
              </MarkdownTableRow>
            ))}
          </MarkdownTableBody>
        </MarkdownTable>
        <DocsParagraph>
          Range parameters <Code>from</Code> and <Code>to</Code> are ISO 8601 datetimes. If omitted,{" "}
          <Code>from</Code> defaults to now and <Code>to</Code> to a week later. A range may not exceed 732 days.
        </DocsParagraph>
        <Heading3 as="h3">Finding free time</Heading3>
        <DocsParagraph>
          Events marked free or working-elsewhere are treated as non-blocking; everything else, including all-day
          events, is busy. Pass <Code>ignoreAllDayEvents=true</Code> to stop all-day events blocking. Working
          hours are 24-hour local times and <Code>workingDays</Code> counts <Code>0</Code> as Sunday, both read
          against <Code>timezone</Code>, so the hours hold across daylight saving transitions.
        </DocsParagraph>
        <CodeBlock>{REST_FREE_TIME_SNIPPET}</CodeBlock>
        <Heading3 as="h3">Creating an event</Heading3>
        <DocsParagraph>
          The calendar ID comes from <Code>GET /api/v1/calendars</Code>. Sending a <Code>timezone</Code> keeps
          CalDAV providers such as iCloud and Fastmail from rendering the event in GMT.
        </DocsParagraph>
        <CodeBlock>{REST_CREATE_EVENT_SNIPPET}</CodeBlock>
        <Heading3 as="h3">Limits</Heading3>
        <DocsParagraph>
          On the free plan the API and MCP server together are capped at 25 requests per day, after which
          requests return <Code>429</Code>. Pro is uncapped, and self-hosted instances running without commercial
          mode are treated as Pro. <Code>POST /api/v1/sync</Code> and <Code>trigger_sync</Code> are separately
          throttled to one request per minute per user, and answer <Code>429</Code> with a{" "}
          <Code>Retry-After</Code> header rather than queueing a second run.
        </DocsParagraph>
      </DocsSection>

      <MarketingCtaSection>
        <MarketingCtaCard>
          <Heading2 className="text-center text-white">Connect your calendars to your assistant</Heading2>
          <Text size="sm" align="center" tone="highlight" className="max-w-[46ch]">
            Create an account, connect a calendar, and point your MCP client at Keeper.sh. Free to use, no credit
            card required.
          </Text>
          <div className="flex items-center gap-2 mt-2">
            <LinkButton
              to="/register"
              size="compact"
              variant="inverse"
              data-visitors-event={ANALYTICS_EVENTS.marketing_cta_clicked}
              data-visitors-cta="docs-mcp"
            >
              <ButtonText>Get Started</ButtonText>
              <ButtonIcon>
                <ArrowRightIcon size={16} />
              </ButtonIcon>
            </LinkButton>
            <ExternalLinkButton
              href="https://github.com/ridafkih/keeper.sh"
              target="_blank"
              rel="noreferrer"
              size="compact"
              variant="inverse-ghost"
            >
              <ButtonText>View on GitHub</ButtonText>
              <ButtonIcon>
                <ArrowUpRightIcon size={16} />
              </ButtonIcon>
            </ExternalLinkButton>
          </div>
        </MarketingCtaCard>
      </MarketingCtaSection>
    </div>
  );
}
