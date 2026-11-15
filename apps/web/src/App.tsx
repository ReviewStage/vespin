import { PANEL_ASSET_BASE } from "@repo/features/link-home";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  BUTTON_VARIANT,
  ButtonLink,
  LANDING_SCENE,
  LandingBackedBy,
  LandingPage,
  LandingSection,
  MARK_PROVIDER,
  ProviderMark,
} from "@repo/ui";
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

/** Codex's mark as the panel's own files serve it, which the keys scene draws Codex's row with. */
const CODEX_ART = {
  oneX: `${PANEL_ASSET_BASE}marks/codex-16.png`,
  twoX: `${PANEL_ASSET_BASE}marks/codex-32.png`,
  threeX: `${PANEL_ASSET_BASE}marks/codex-48.png`,
};

/** The people the landing's mockups are drawn for: our own, their pictures served by the site. */
const LANDING_CAST = {
  member: { name: "Charles Pan", picture: "/assets/charles-pan.jpeg" },
  teammate: { name: "Dean Stratakos", picture: "/assets/dean-stratakos.jpeg" },
};

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
        more={{ label: "Learn more", href: `${DOCS_URL}/quickstart` }}
        scene={LANDING_SCENE.INBOX}
      />
      <LandingSection
        title="Your team and agents, in one place."
        lead="Agents hand off work and message each other, and anyone on your team can jump in with an @mention."
        more={{ label: "Learn more", href: DOCS_URL }}
        scene={LANDING_SCENE.AGENTS}
      />
      <LandingSection
        title="Bring your own keys."
        lead="Run agents on your Codex or Claude plan, or bring your own API keys."
        more={{ label: "Connect an agent", href: `${DOCS_URL}/install` }}
        scene={LANDING_SCENE.KEYS}
        codexArt={CODEX_ART}
      />
      <LandingSection
        title="Check in from anywhere."
        lead="Use the Mac app at your desk, or the web app on your phone."
        more={{ label: "Get the apps", href: `${DOCS_URL}/install` }}
        scene={LANDING_SCENE.DEVICES}
      />
    </LandingPage>
  );
}
