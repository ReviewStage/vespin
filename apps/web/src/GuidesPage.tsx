import guides from "virtual:site/guides";
import { formatDayHeading } from "@repo/features/time-format";
import {
  Prose,
  PUBLIC_SECTIONS,
  PublicPage,
  PublicSection,
  TEXT_ELEMENT,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextLink,
} from "@repo/ui";
import {
  GUIDE_FAQ_HEADING,
  GUIDE_VIEW,
  GUIDES_PATH,
  type Guide,
  type GuideView,
  guidePath,
  INDEX_DESCRIPTION,
} from "./guides";
import { SiteBarDownload, SiteDownload, SiteFooterLinks, SiteNavigation } from "./SiteChrome";

/**
 * The guides' index and each guide's own page, drawn from the Markdown under
 * `apps/web/guides/` (`site-markdown.tsx` draws them when the site is built,
 * and `guides.ts` decides which an address shows). Nothing in the site's bar
 * or foot links here: a reader arrives from a search or an answer engine, or
 * from another guide, so each page links to the guides related to it.
 */
export const GUIDES: readonly Guide[] = guides;

/** A day as the page writes it, in a `<time>` a machine reads. */
function Day({ day }: { readonly day: string }): React.JSX.Element {
  return <time dateTime={day}>{formatDayHeading(day)}</time>;
}

/** When a guide's words last changed and when it went up, the first a reader checks. */
function GuideDays({ guide }: { readonly guide: Guide }): React.JSX.Element {
  return (
    <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      Updated <Day day={guide.updated} /> · Published <Day day={guide.published} />
    </Text>
  );
}

/** A guide as a list names it: its title, which links to it, and what it answers. */
function GuideEntry({
  guide,
  heading,
}: {
  readonly guide: Guide;
  readonly heading: typeof TEXT_ELEMENT.H2 | typeof TEXT_ELEMENT.H3;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <Text as={heading} variant={TEXT_VARIANT.SECTION}>
        <TextLink href={guidePath(guide.slug)} look={TEXT_LINK_LOOK.HEADING}>
          {guide.title}
        </TextLink>
      </Text>
      <Text as={TEXT_ELEMENT.P} tone={TEXT_TONE.MUTED}>
        {guide.description}
      </Text>
    </div>
  );
}

function GuideIndex({ guides }: { readonly guides: readonly Guide[] }): React.JSX.Element {
  return (
    <PublicPage
      banner={<SiteNavigation />}
      bannerCall={<SiteBarDownload />}
      footer={<SiteFooterLinks />}
      title="Guides"
      lead={INDEX_DESCRIPTION}
      sections={PUBLIC_SECTIONS.RULED}
    >
      {guides.length === 0 ? (
        <PublicSection>
          <Text as={TEXT_ELEMENT.P} tone={TEXT_TONE.MUTED}>
            No guides yet.
          </Text>
        </PublicSection>
      ) : (
        guides.map((guide) => (
          <PublicSection key={guide.slug}>
            <GuideEntry guide={guide} heading={TEXT_ELEMENT.H2} />
          </PublicSection>
        ))
      )}
    </PublicPage>
  );
}

function GuideArticle({
  guide,
  related,
}: {
  readonly guide: Guide;
  readonly related: readonly Guide[];
}): React.JSX.Element {
  return (
    <PublicPage
      banner={<SiteNavigation />}
      bannerCall={<SiteBarDownload />}
      footer={<SiteFooterLinks />}
      back={{ href: GUIDES_PATH, label: "Guides" }}
      title={guide.title}
      lead={guide.description}
    >
      <PublicSection>
        <div className="flex flex-col gap-8">
          <GuideDays guide={guide} />
          <Prose html={guide.html} />
        </div>
      </PublicSection>
      <PublicSection title={GUIDE_FAQ_HEADING}>
        <div className="flex flex-col gap-8">
          {guide.faq.map((entry) => (
            <div key={entry.question} className="flex flex-col gap-2">
              <Text as={TEXT_ELEMENT.H3} variant={TEXT_VARIANT.LABEL}>
                {entry.question}
              </Text>
              <Prose html={entry.html} />
            </div>
          ))}
        </div>
      </PublicSection>
      <PublicSection>
        <SiteDownload />
      </PublicSection>
      {related.length > 0 ? (
        <PublicSection title="Related guides">
          <div className="flex flex-col gap-8">
            {related.map((other) => (
              <GuideEntry key={other.slug} guide={other} heading={TEXT_ELEMENT.H3} />
            ))}
          </div>
        </PublicSection>
      ) : null}
    </PublicPage>
  );
}

export function GuidesPage({ view }: { readonly view: GuideView }): React.JSX.Element {
  return view.kind === GUIDE_VIEW.INDEX ? (
    <GuideIndex guides={view.guides} />
  ) : (
    <GuideArticle guide={view.guide} related={view.related} />
  );
}
