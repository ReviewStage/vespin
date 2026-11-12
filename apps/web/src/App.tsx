import { PANEL_ASSET_BASE } from "@repo/features/link-home";
import {
  BUTTON_VARIANT,
  ButtonLink,
  LANDING_SCENE,
  LandingBackedBy,
  LandingPage,
  LandingSection,
  MARK_PROVIDER,
  ProviderMark,
  TEXT_LINK_HEIGHT,
  TextLink,
} from "@repo/ui";
import {
  REPOSITORY_URL,
  SITE_PAGE,
  SiteBarDownload,
  SiteDownload,
  SiteFooterLinks,
  SiteNavigation,
  WEB_APP_URL,
} from "./SiteChrome";

/** Codex's mark as the panel's own files serve it, which the keys scene draws Codex's row with. */
const CODEX_ART = {
  oneX: `${PANEL_ASSET_BASE}marks/codex-16.png`,
  twoX: `${PANEL_ASSET_BASE}marks/codex-32.png`,
  threeX: `${PANEL_ASSET_BASE}marks/codex-48.png`,
};

/** Our page among Y Combinator's companies, which the hero's backing chip opens. */
const Y_COMBINATOR_PAGE = "https://www.ycombinator.com/companies/vespin";

/**
 * The landing: the one line beside the copper ball, then a section for each
 * of the product's features over the app's own screens at work, and the
 * close. A reader with an account signs in from the bar or under the hero's
 * download.
 */
export function App(): React.JSX.Element {
  return (
    <LandingPage
      bar={<SiteNavigation current={{ page: SITE_PAGE.HOME }} />}
      barCall={<SiteBarDownload />}
      badge={<LandingBackedBy href={Y_COMBINATOR_PAGE} />}
      title="An inbox for all your coding agents."
      actions={
        <>
          <SiteDownload />
          <TextLink href={WEB_APP_URL} height={TEXT_LINK_HEIGHT.CONTROL}>
            or sign in on the web
          </TextLink>
        </>
      }
      close={{
        title: "Free and open source.",
        actions: (
          <>
            <SiteDownload />
            <ButtonLink
              variant={BUTTON_VARIANT.OUTLINE}
              href={REPOSITORY_URL}
              icon={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}
            >
              View on GitHub
            </ButtonLink>
          </>
        ),
      }}
      footer={<SiteFooterLinks current={{ page: SITE_PAGE.HOME }} />}
    >
      <LandingSection
        title="Monitor all your agents with one inbox."
        lead="Agents only post to your inbox when something needs your attention."
        scene={LANDING_SCENE.INBOX}
      />
      <LandingSection
        title="Agents work together."
        lead="They hand off work, message each other, and split tasks into sub-tasks."
        scene={LANDING_SCENE.AGENTS}
      />
      <LandingSection
        title="Check in from anywhere."
        lead="Use the Mac app at your desk, or the web app on your phone."
        scene={LANDING_SCENE.DEVICES}
      />
      <LandingSection
        title="Start agents from Slack or your terminal."
        lead="Mention @Vespin in a thread, or run the vespin CLI."
        scene={LANDING_SCENE.STARTS}
      />
      <LandingSection
        title="Bring your own keys."
        lead="Run agents on your Codex or Claude plan, or bring your own API keys."
        scene={LANDING_SCENE.KEYS}
        codexArt={CODEX_ART}
      />
    </LandingPage>
  );
}
