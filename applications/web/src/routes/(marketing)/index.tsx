import { useSetAtom } from 'jotai'
import { createFileRoute, useLoaderData, type LinkProps } from '@tanstack/react-router'
import { faqSchema, jsonLdScript, seoHead, softwareApplicationSchema, webPageSchema } from '../../lib/seo'
import { Heading1, Heading2, Heading3 } from '../../components/ui/primitives/heading'
import { Text } from '../../components/ui/primitives/text'
import { MarketingFaqSection, MarketingFaqList, MarketingFaqItem, MarketingFaqQuestion } from '../../features/marketing/components/marketing-faq'
import { MarketingArticleCard, MarketingArticleGrid, MarketingArticleSection } from '../../features/marketing/components/marketing-article-section'
import { MarketingCtaSection, MarketingCtaCard } from '../../features/marketing/components/marketing-cta'
import { Collapsible } from '../../components/ui/primitives/collapsible'
import { TextLink } from '../../components/ui/primitives/text-link'
import { ButtonIcon, ButtonText, ExternalLinkButton, LinkButton } from '../../components/ui/primitives/button'
import { MarketingIllustrationCalendar, MarketingIllustrationCalendarCard, type Skew, type SkewTuple } from '../../features/marketing/components/marketing-illustration-calendar'
import {
  MarketingFeatureBentoBody,
  MarketingFeatureBentoCard,
  MarketingFeatureBentoGrid,
  MarketingFeatureBentoIllustration,
  MarketingFeatureBentoSection,
} from '../../features/marketing/components/marketing-feature-bento'
import { MarketingIllustrationContributors } from '../../illustrations/marketing-illustration-contributors'
import { MarketingIllustrationProviders } from '../../illustrations/marketing-illustration-providers'
import { MarketingIllustrationSync } from '../../illustrations/marketing-illustration-sync'
import {
  MarketingTestimonialCard,
  MarketingTestimonialsGrid,
  MarketingTestimonialsSection,
} from '../../features/marketing/components/marketing-testimonials'
import {
  MarketingHowItWorksCard,
  MarketingHowItWorksRow,
  MarketingHowItWorksSection,
  MarketingHowItWorksStepBody,
  MarketingHowItWorksStepIllustration,
} from '../../features/marketing/components/marketing-how-it-works'
import { HOW_IT_WORKS_STEPS } from '../../features/marketing/how-it-works-steps'
import { HowItWorksConnect } from '../../illustrations/how-it-works-connect'
import { HowItWorksConfigure } from '../../illustrations/how-it-works-configure'
import { HowItWorksSync } from '../../illustrations/how-it-works-sync'
import {
  MarketingPricingComparisonGrid,
  MarketingPricingComparisonSpacer,
  MarketingPricingFeatureDisplay,
  MarketingPricingFeatureLabel,
  MarketingPricingFeatureMatrix,
  MarketingPricingFeatureRow,
  MarketingPricingFeatureValue,
  MarketingPricingIntro,
  MarketingPricingPlanCard,
  MarketingPricingSection,
} from '../../features/marketing/components/marketing-pricing-section'
import { PRICING_FEATURE_DIFFERENCES, PRICING_PLANS, pricingPlanHighlights } from '../../features/marketing/pricing-plans'
import { TESTIMONIALS } from '../../features/marketing/testimonials'
import { GithubStarButton } from '../../components/ui/primitives/github-star-button'
import { latestArticles } from '../../lib/article-library'
import { calendarEmphasizedAtom } from '../../state/calendar-emphasized'
import { ANALYTICS_EVENTS } from '../../lib/analytics'
import ArrowRightIcon from "lucide-react/dist/esm/icons/arrow-right";
import ArrowUpRightIcon from "lucide-react/dist/esm/icons/arrow-up-right";

const PAGE_DESCRIPTION =
  "Keeper.sh copies your events between Google Calendar, Outlook, iCloud and Fastmail so all of them show you as busy at the same times. Event titles stay private."

const createSkew = (rotate: number, x: number, y: number): Skew => ({ rotate, x, y });

const SKEW_BACK_LEFT: SkewTuple = [
  createSkew(-12, -24, 12),
  createSkew(-8, -16, 8),
  createSkew(-3, -8, 4),
]

const SKEW_BACK_RIGHT: SkewTuple = [
  createSkew(9, 20, -8),
  createSkew(5, 12, -4),
  createSkew(1.5, 6, -2),
]

const SKEW_FRONT: SkewTuple = [
  createSkew(-4, 4, -6),
  createSkew(-2, 2, -2),
  createSkew(0, 0, 0),
]

type MarketingFeature = {
  id: number
  title: string
  description: string
  gridClassName: string
  illustration?: React.ReactNode
  link?: { to: LinkProps["to"]; label: string }
}

const MARKETING_FEATURES: MarketingFeature[] = [
  {
    id: 1,
    title: 'One booking blocks every calendar',
    description:
      'Book something in one calendar and that time shows as busy in all the others.',
    gridClassName: 'lg:col-start-1 lg:col-span-6 lg:row-start-1',
    illustration: <MarketingIllustrationSync />,
  },
  {
    id: 2,
    title: 'Works with the calendars you already use',
    description:
      'Google, Outlook, iCloud and Fastmail sign in directly. For anything else, paste a calendar link.',
    gridClassName: 'lg:col-start-7 lg:col-span-4 lg:row-start-1',
    illustration: <MarketingIllustrationProviders />,
  },
  {
    id: 3,
    title: 'Synced events stay private by default',
    description:
      'A copy shows the calendar it came from. Your title, description, location and guest list stay behind.',
    gridClassName: 'lg:col-start-1 lg:col-span-10 lg:row-start-2',
  },
  {
    id: 4,
    title: 'Let AI agents view and manage your calendar',
    description:
      'Connect Claude or any MCP client and let it check your week, book events and reschedule.',
    gridClassName: 'lg:col-start-1 lg:col-span-4 lg:row-start-3',
  },
  {
    id: 5,
    title: 'Anyone can read the code',
    description:
      'Check exactly what Keeper.sh sends to your calendars, or run it on your own server.',
    gridClassName: 'lg:col-start-5 lg:col-span-6 lg:row-start-3',
    illustration: <MarketingIllustrationContributors />,
    link: { to: '/about', label: 'Who builds Keeper.sh' },
  },
]

type FaqItem = {
  question: string
  answer: string
  content?: React.ReactNode
}

const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'What if my calendar only gives me a share link?',
    answer:
      'Paste the link and those events copy into your other calendars. The copying runs one way, so nothing you change later reaches the original calendar.',
  },
  {
    question: 'Which calendars does Keeper.sh work with?',
    answer:
      'Google Calendar, Outlook, iCloud and Fastmail sign in directly. Most others work too, as long as yours gives you a calendar link or a login.',
  },
  {
    question: 'Can my colleagues see what my personal events are?',
    answer:
      'No. A copy shows the name of the calendar it came from, with no title, description, location or guest list. Pro lets you pass the title, description and location through, and the guest list is never copied on any plan.',
  },
  {
    question: 'How often do calendars update?',
    answer:
      'Keeper.sh reads every calendar every minute. Your changes reach the other calendars every 30 minutes on Free, and every minute on Pro.',
  },
  {
    question: 'Can I run Keeper.sh myself?',
    answer:
      'Yes. Keeper.sh is open source under AGPL-3.0. The self-hosting page covers what you get, and the README on GitHub has the setup steps.',
    content: <>Yes. Keeper.sh is open source under AGPL-3.0. The <TextLink align="left" size="sm" to="/self-hosting" tone="default">self-hosting page</TextLink> covers what you get, and the <a href="https://github.com/ridafkih/keeper.sh#readme" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">README on GitHub</a> has the setup steps.</>,
  },
  {
    question: 'Can I cancel any time?',
    answer:
      'Yes. Cancel in your account settings and keep access until the period you paid for ends.',
  },
]

export const Route = createFileRoute('/(marketing)/')({
  component: MarketingPage,
  head: () => seoHead({
    title: "Sync Google Calendar with Outlook & iCloud",
    description: PAGE_DESCRIPTION,
    path: "/",
    brandPosition: "before",
    scripts: [
      jsonLdScript(webPageSchema("Keeper.sh", PAGE_DESCRIPTION, "/")),
      jsonLdScript(softwareApplicationSchema()),
      jsonLdScript(faqSchema("", FAQ_ITEMS)),
    ],
  }),
})

function MarketingPage() {
  const setEmphasized = useSetAtom(calendarEmphasizedAtom)
  const githubStars = useLoaderData({ from: '/(marketing)' })

  return (
    <div className="flex flex-col gap-2 pt-8">
      <Heading1 className="text-center">Stop double-booking yourself.</Heading1>
      <Text align="center" className="max-w-[48ch] mx-auto">
        Keeper.sh copies your events between your personal, work and school calendars, so all of them show you as busy at the same times. Works with Google Calendar, Outlook, iCloud and Fastmail.
      </Text>
      <div className="contents *:z-20">
        <div className="flex items-center gap-2 mx-auto pt-1">
          <LinkButton
            to="/register"
            size="compact"
            onMouseEnter={() => setEmphasized(true)}
            onMouseLeave={() => setEmphasized(false)}
            data-visitors-event={ANALYTICS_EVENTS.marketing_cta_clicked}
            data-visitors-cta="hero"
          >
            <ButtonText>Sync Calendars</ButtonText>
            <ButtonIcon>
              <ArrowRightIcon size={16} />
            </ButtonIcon>
          </LinkButton>
          <GithubStarButton starCount={githubStars.count} />
        </div>
      </div>
      <div className="contents *:z-10">
        <div className="flex flex-col">
          <MarketingIllustrationCalendar>
            <MarketingIllustrationCalendarCard skew={SKEW_BACK_LEFT} />
            <MarketingIllustrationCalendarCard skew={SKEW_BACK_RIGHT} />
            <MarketingIllustrationCalendarCard skew={SKEW_FRONT} />
          </MarketingIllustrationCalendar>
          <MarketingFeatureBentoSection id="features">
            <MarketingFeatureBentoGrid>
              {MARKETING_FEATURES.map((feature) => (
                <MarketingFeatureBentoCard key={feature.id} className={feature.gridClassName}>
                  <MarketingFeatureBentoIllustration plain={!!feature.illustration}>
                    {feature.illustration}
                  </MarketingFeatureBentoIllustration>
                  <MarketingFeatureBentoBody>
                    <Heading3 as="h2">{feature.title}</Heading3>
                    <Text size="sm" className="text-left">
                      {feature.description}
                    </Text>
                    {feature.link && (
                      <TextLink align="left" size="sm" to={feature.link.to} tone="muted">
                        {feature.link.label}
                      </TextLink>
                    )}
                  </MarketingFeatureBentoBody>
                </MarketingFeatureBentoCard>
              ))}
            </MarketingFeatureBentoGrid>
          </MarketingFeatureBentoSection>

          <MarketingHowItWorksSection>
            <Heading2 className="text-center">How your calendars stay in step</Heading2>
            <Text size="sm" align="center" tone="muted" className="mt-2">
              You set a connection up once. After that, Keeper.sh keeps the copies right.
            </Text>
            <MarketingHowItWorksCard>
              <MarketingHowItWorksRow>
                <MarketingHowItWorksStepBody step={1}>
                  <Heading3 as="h3">{HOW_IT_WORKS_STEPS[0].title}</Heading3>
                  <Text size="sm" tone="muted">{HOW_IT_WORKS_STEPS[0].body}</Text>
                </MarketingHowItWorksStepBody>
                <MarketingHowItWorksStepIllustration align="right">
                  <HowItWorksConnect />
                </MarketingHowItWorksStepIllustration>
              </MarketingHowItWorksRow>

              <MarketingHowItWorksRow reverse>
                <MarketingHowItWorksStepBody step={2}>
                  <Heading3 as="h3">{HOW_IT_WORKS_STEPS[1].title}</Heading3>
                  <Text size="sm" tone="muted">{HOW_IT_WORKS_STEPS[1].body}</Text>
                </MarketingHowItWorksStepBody>
                <MarketingHowItWorksStepIllustration align="left">
                  <HowItWorksConfigure />
                </MarketingHowItWorksStepIllustration>
              </MarketingHowItWorksRow>

              <MarketingHowItWorksRow>
                <MarketingHowItWorksStepBody step={3}>
                  <Heading3 as="h3">{HOW_IT_WORKS_STEPS[2].title}</Heading3>
                  <Text size="sm" tone="muted">{HOW_IT_WORKS_STEPS[2].body}</Text>
                </MarketingHowItWorksStepBody>
                <MarketingHowItWorksStepIllustration align="right">
                  <HowItWorksSync />
                </MarketingHowItWorksStepIllustration>
              </MarketingHowItWorksRow>
            </MarketingHowItWorksCard>
          </MarketingHowItWorksSection>

          {TESTIMONIALS.length > 0 && (
            <MarketingTestimonialsSection id="testimonials">
              <Heading2 className="text-center">What people say</Heading2>
              <Text size="sm" align="center" tone="muted" className="mt-2">
                Quotes from Reddit, X and email, each shown with who wrote it.
              </Text>
              <MarketingTestimonialsGrid>
                {TESTIMONIALS.map((testimonial) => (
                  <MarketingTestimonialCard key={`${testimonial.source}-${testimonial.author}`} {...testimonial} />
                ))}
              </MarketingTestimonialsGrid>
            </MarketingTestimonialsSection>
          )}

          <MarketingPricingSection id="pricing">
            <MarketingPricingIntro>
              <Heading2 className="text-center">Pricing</Heading2>
              <Text size="sm" align="center" tone="muted">
                Not sure which you need?{' '}
                <TextLink to="/pricing" size="sm" tone="default">See what each plan includes</TextLink>.
              </Text>
            </MarketingPricingIntro>

            <MarketingPricingComparisonGrid>
              <MarketingPricingComparisonSpacer />

              {PRICING_PLANS.map((plan) => (
                <MarketingPricingPlanCard
                  key={plan.id}
                  tone={plan.tone}
                  name={plan.name}
                  price={plan.price}
                  period={plan.period}
                  description={plan.description}
                  ctaLabel={plan.ctaLabel}
                  features={pricingPlanHighlights(plan.id)}
                />
              ))}

              <MarketingPricingFeatureMatrix>
                {PRICING_FEATURE_DIFFERENCES.map((feature) => (
                  <MarketingPricingFeatureRow key={feature.label}>
                    <MarketingPricingFeatureLabel>
                      <Text size="sm" className="text-left text-nowrap">{feature.label}</Text>
                    </MarketingPricingFeatureLabel>
                    <MarketingPricingFeatureValue>
                      <MarketingPricingFeatureDisplay value={feature.free} tone="muted" />
                    </MarketingPricingFeatureValue>
                    <MarketingPricingFeatureValue>
                      <MarketingPricingFeatureDisplay value={feature.pro} tone="muted" />
                    </MarketingPricingFeatureValue>
                  </MarketingPricingFeatureRow>
                ))}
              </MarketingPricingFeatureMatrix>
            </MarketingPricingComparisonGrid>
          </MarketingPricingSection>

          <MarketingArticleSection>
            <Heading2 className="text-center">Latest content</Heading2>
            <Text size="sm" align="center" className="mt-2 max-w-[48ch] mx-auto">
              Step-by-step guides for the calendars you use, and comparisons with the other
              sync tools. Browse them all on the{' '}
              <TextLink size="sm" to="/blog">blog</TextLink> and the{' '}
              <TextLink size="sm" to="/compare">comparison pages</TextLink>.
            </Text>
            <MarketingArticleGrid>
              {latestArticles.map((article) => (
                <MarketingArticleCard
                  key={article.path}
                  blurb={article.blurb}
                  path={article.path}
                  title={article.title}
                />
              ))}
            </MarketingArticleGrid>
          </MarketingArticleSection>

          <MarketingFaqSection>
            <Heading2 className="text-center">Frequently Asked Questions</Heading2>
            <Text size="sm" align="center" className="mt-2 max-w-[48ch] mx-auto">
              Anything else, write to{' '}
              <a href="mailto:support@keeper.sh" className="text-foreground underline underline-offset-2">support@keeper.sh</a>.
            </Text>
            <MarketingFaqList>
              {FAQ_ITEMS.map((item) => (
                <MarketingFaqItem key={item.question}>
                  <Collapsible
                    trigger={<MarketingFaqQuestion>{item.question}</MarketingFaqQuestion>}
                  >
                    <Text size="sm" tone="muted">{item.content ?? item.answer}</Text>
                  </Collapsible>
                </MarketingFaqItem>
              ))}
            </MarketingFaqList>
          </MarketingFaqSection>

          <MarketingCtaSection>
            <MarketingCtaCard>
              <Heading2 className="text-center text-white">Ready to sync your calendars?</Heading2>
              <Text size="sm" align="center" tone="highlight" className="max-w-[46ch]">
                Free for two calendar accounts. No credit card.
              </Text>
              <div className="flex items-center gap-2 mt-2">
                <LinkButton to="/register" size="compact" variant="inverse" data-visitors-event={ANALYTICS_EVENTS.marketing_cta_clicked} data-visitors-cta="bottom">
                  <ButtonText>Sync Calendars</ButtonText>
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
                  <ButtonText>GitHub</ButtonText>
                  <ButtonIcon>
                    <ArrowUpRightIcon size={16} />
                  </ButtonIcon>
                </ExternalLinkButton>
              </div>
            </MarketingCtaCard>
          </MarketingCtaSection>
        </div>
      </div>
    </div>
  )
}
