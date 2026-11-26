import { ENTITY_KIND } from "@repo/features/entity-kind";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { EntityGlyph } from "@repo/panel/entities/entity-glyph";
import {
  BUTTON_VARIANT,
  ButtonLink,
  ComputerUseIcon,
  LANDING_SCENE,
  LandingBackedBy,
  LandingMore,
  type LandingMoreItem,
  LandingPage,
  LandingSection,
  MARK_PROVIDER,
  ProviderMark,
  TerminalIcon,
  WaveformIcon,
} from "@repo/ui";
import { KanbanIcon, ServerIcon, TargetIcon } from "@repo/ui/icons";
import { GUIDES_PATH } from "./guides";
import {
  DOCS_URL,
  REPOSITORY_URL,
  SITE_PAGE,
  SiteBarDownload,
  SiteDownload,
  SiteFooterLinks,
  SiteNavigation,
  WEB_APP_URL,
} from "./SiteChrome";

/** The people the landing's mockups are drawn for: our own, their pictures served by the site. */
const LANDING_CAST = {
  member: { name: "Charles Pan", picture: "/assets/charles-pan.jpeg" },
  teammate: { name: "Dean Stratakos", picture: "/assets/dean-stratakos.jpeg" },
};

/** The features the sections leave out, which the grid under them names in passing. */
const MORE_FEATURES: readonly LandingMoreItem[] = [
  {
    id: "computer",
    icon: <ComputerUseIcon />,
    title: "Computer use",
    words: "Agents can see and use the Mac apps you allow.",
  },
  {
    id: "goal",
    icon: <TargetIcon />,
    title: "Goal mode",
    words: "Set a goal with /goal and the agent keeps going until it's met.",
  },
  {
    id: "voice",
    icon: <WaveformIcon />,
    title: "Voice mode",
    words: "Call an agent and talk a task through out loud.",
  },
  {
    id: "mcp",
    icon: <TerminalIcon />,
    title: "MCP and CLI",
    words: `Drive ${PRODUCT_NAME} from your favorite harness.`,
  },
  {
    id: "host",
    icon: <ServerIcon />,
    title: "Bring your own host",
    words: "Run agents on your own Macs and Linux machines, or in our cloud.",
  },
  {
    id: "tasks",
    icon: <KanbanIcon />,
    title: "Task management",
    words: "Tasks with plans, sub-tasks, and statuses your agents keep current.",
  },
  {
    id: "slack",
    icon: <ProviderMark provider={MARK_PROVIDER.SLACK} />,
    title: "Slack",
    words: `Mention @${PRODUCT_NAME} to start an agent, and trade messages and files with it in the thread.`,
  },
  {
    id: "automations",
    icon: <EntityGlyph kind={ENTITY_KIND.AUTOMATIONS} />,
    title: "Automations",
    words: "Start agents on a schedule, on GitHub and Sentry events, or from a webhook.",
  },
];

/** Our page among Y Combinator's companies, which the hero's backing chip opens. */
const Y_COMBINATOR_PAGE = "https://www.ycombinator.com/companies/vespin";

/**
 * The landing: the one line over the live app, then a section for each of
 * the product's features over the app's own screens at work, and the close. A reader with an account signs in
 * from the bar, or continues on the web beside the hero's download.
 */
export function App(): React.JSX.Element {
  return (
    <LandingPage
      bar={<SiteNavigation current={{ page: SITE_PAGE.HOME }} />}
      barCall={<SiteBarDownload />}
      badge={<LandingBackedBy href={Y_COMBINATOR_PAGE} />}
      title="The unified workspace for teams and agents."
      lead="Designed to keep every task moving, day and night."
      actions={
        <>
          <SiteDownload />
          <ButtonLink variant={BUTTON_VARIANT.OUTLINE} href={WEB_APP_URL}>
            Continue on web
          </ButtonLink>
        </>
      }
      close={{
        title: `Try ${PRODUCT_NAME} today.`,
        actions: (
          <>
            <SiteDownload />
            <ButtonLink
              variant={BUTTON_VARIANT.OUTLINE}
              href={REPOSITORY_URL}
              icon={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}
            >
              GitHub
            </ButtonLink>
          </>
        ),
      }}
      footer={<SiteFooterLinks current={{ page: SITE_PAGE.HOME }} />}
      cast={LANDING_CAST}
    >
      <LandingSection
        title="Monitor all your agents with one inbox."
        lead="Agents only post to your inbox when something needs your attention."
        more={{ label: "Learn more", href: `${GUIDES_PATH}/how-the-vespin-inbox-works` }}
        scene={LANDING_SCENE.INBOX}
      />
      <LandingSection
        title="Your team and agents, in one place."
        lead="Agents hand off work and message each other, and anyone on your team can jump in with an @mention."
        scene={LANDING_SCENE.AGENTS}
      />
      <LandingSection
        title="Bring your own subscriptions and keys."
        lead="Run agents on your Codex or Claude plan, or bring your own API keys."
        more={{ label: "Connect an agent", href: `${DOCS_URL}/install#connect-an-agent` }}
        scene={LANDING_SCENE.KEYS}
      />
      <LandingSection
        title="Check in from anywhere."
        lead="Use the Mac app at your desk, or the web app on your phone."
        more={{ label: "Get the apps", href: `${DOCS_URL}/install#download-for-mac` }}
        scene={LANDING_SCENE.DEVICES}
      />
      <LandingSection
        title="Start agents from Slack or your terminal."
        lead={`Mention @${PRODUCT_NAME} in a thread, or run the vespin CLI.`}
        scene={LANDING_SCENE.STARTS}
      />
      <LandingMore title="And much more." items={MORE_FEATURES} />
    </LandingPage>
  );
}
