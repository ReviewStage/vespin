import { type ReactNode, useId } from "react";
import { ICON_SIZE } from "../../icons/icons.js";
import type { CodexArt } from "../../marks/harness-mark.js";
import { MarkOrb } from "../../marks/mark-orb.js";
import { GLYPH_INK, GlyphSlot } from "../glyph-slot/glyph-slot.js";
import { TEXT_LINK_HEIGHT, TextLink } from "../text-link/text-link.js";
import { type LandingCast, LandingCastProvider } from "./landing-desktop.js";
import { LANDING_FIELD, LandingField, type LandingFieldPattern } from "./landing-field.js";
import { LandingHeroApp } from "./landing-hero.js";
import { LANDING_SCENE, type LandingScene, LandingSceneView } from "./landing-scenes.js";
import { SiteFrame, SiteRule } from "./site-frame.js";

export type { LandingCast, LandingPerson } from "./landing-desktop.js";

export { SiteBarPages } from "./site-frame.js";

/**
 * landing-page.tsx -- the product's landing: the line over the live app, a section per feature each over a moving screen, and a close over the wordmark in dots.
 *
 * The hero sets its line large and to the left, its sentence and its calls
 * on one row under it, and the Mac app live below them, as wide as the page
 * allows, its foot fading into the ground (`landing-hero.tsx`). A section opens under a hairline across
 * the page with its words, a heading over a sentence and a link to read
 * more, beside the feature's screen standing on a field of drifting copper
 * dots, the app's own components playing a short story
 * (`landing-scenes.tsx`); the words and the screen trade sides
 * from one section to the next, and stack on a phone. The close sets
 * the page's last call in the middle.
 *
 * It stands in the site's frame (`site-frame.tsx`). Its words and its links
 * are the caller's; its art, scenes, and rhythm are its own, drawn in the
 * theme's roles and the web profile's display styles (`tokens/display.css`).
 * It is drawn in `landing.css`.
 */

export { LANDING_SCENE, type LandingScene };

/** The field of copper dots behind each scene's stage, or none where the scene draws a ground of its own. */
const SCENE_FIELD: Readonly<Record<LandingScene, LandingFieldPattern | null>> = {
  [LANDING_SCENE.INBOX]: LANDING_FIELD.FLOW,
  [LANDING_SCENE.AGENTS]: LANDING_FIELD.WAVES,
  [LANDING_SCENE.AUTOMATIONS]: LANDING_FIELD.RINGS,
  [LANDING_SCENE.DEVICES]: LANDING_FIELD.FLOW,
  // Note that the keys scene stands on a glow of its own, since its tiles are lost among dots.
  [LANDING_SCENE.KEYS]: null,
  [LANDING_SCENE.STARTS]: LANDING_FIELD.RINGS,
};

/** A feature: `title` over `lead`, its link to read `more`, and `aside` where given, beside its scene's stage, the two trading sides from one section to the next. */
export function LandingSection({
  title,
  lead,
  more,
  scene,
  aside,
  codexArt,
}: {
  title: ReactNode;
  lead: ReactNode;
  /** Where to read more of the feature, linked under the lead. */
  more?: { readonly label: string; readonly href: string } | undefined;
  scene: LandingScene;
  /** What stands under the words, such as `LandingFacts`. */
  aside?: ReactNode;
  /** Codex's picture as the site serves it, which a scene naming Codex draws its mark from. */
  codexArt?: CodexArt | undefined;
}): React.JSX.Element {
  const titleId = `${useId()}title`;
  const field = SCENE_FIELD[scene];

  const stage = (
    <div className="ui-landing-stage" data-scene={scene}>
      {field === null ? null : <LandingField pattern={field} />}
      <LandingSceneView scene={scene} codexArt={codexArt} />
    </div>
  );

  return (
    <section className="ui-landing-section" aria-labelledby={titleId}>
      <SiteRule />
      <div className="ui-landing-section-body">
        <div className="ui-landing-section-words">
          <h2 className="ui-landing-section-title" id={titleId}>
            {title}
          </h2>
          <p className="ui-landing-lead">{lead}</p>
          {more === undefined ? null : (
            <TextLink href={more.href} height={TEXT_LINK_HEIGHT.CONTROL}>
              {more.label} →
            </TextLink>
          )}
          {aside}
        </div>
        {stage}
      </div>
    </section>
  );
}

/** A short list of facts, each a name and a sentence, ruled one from the next. */
export function LandingFacts({
  facts,
}: {
  facts: readonly { readonly title: string; readonly detail: ReactNode }[];
}): React.JSX.Element {
  return (
    <dl className="ui-landing-facts">
      {facts.map((fact) => (
        <div key={fact.title} className="ui-landing-fact">
          <dt>{fact.title}</dt>
          <dd>{fact.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Y Combinator's orange, the one ink of its mark, which no theme role holds. */
const Y_COMBINATOR_ORANGE = "#FB651E";

/** Y Combinator's mark: a white Y on its orange square. */
function YCombinatorMark(): React.JSX.Element {
  return (
    <svg className="ui-landing-backer-mark" viewBox="0 0 16 16" aria-hidden="true">
      <rect width="16" height="16" rx="2" fill={Y_COMBINATOR_ORANGE} />
      <path d="M4.4 3.5h1.9L8 7.1l1.7-3.6h1.9L8.9 8.9v3.6H7.1V8.9Z" fill="#fff" />
    </svg>
  );
}

/** The hero's chip saying Y Combinator backs the product, going to `href`, the company's page there, in a new tab. */
export function LandingBackedBy({ href }: { href: string }): React.JSX.Element {
  return (
    <a
      className="ui-landing-backer"
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Backed by Y Combinator"
    >
      Backed by
      <YCombinatorMark />
      <span className="ui-landing-backer-name">Combinator</span>
    </a>
  );
}

/** A feature the landing names in passing: its glyph, its name, and a line on what it does. */
export type LandingMoreItem = {
  readonly id: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly words: string;
};

/** The features the sections leave out: `title` beside two columns of `items`, each a ruled row of its glyph beside its name and its line. */
export function LandingMore({
  title,
  items,
}: {
  title: ReactNode;
  items: readonly LandingMoreItem[];
}): React.JSX.Element {
  const titleId = `${useId()}title`;

  return (
    <section className="ui-landing-more" aria-labelledby={titleId}>
      <SiteRule />
      <div className="ui-landing-more-body">
        <h2 className="ui-landing-section-title" id={titleId}>
          {title}
        </h2>
        <ul className="ui-landing-more-grid">
          {items.map((item) => (
            <li key={item.id} className="ui-landing-more-tile">
              <span className="ui-landing-more-icon">
                <GlyphSlot size={ICON_SIZE.LARGE} ink={GLYPH_INK.INHERIT}>
                  {item.icon}
                </GlyphSlot>
              </span>
              <h3 className="ui-landing-more-name">{item.title}</h3>
              <p className="ui-landing-more-words">{item.words}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Hands the mockups under it `cast`, or leaves them our own where none is named. */
function LandingCastScope({
  cast,
  children,
}: {
  cast: LandingCast | undefined;
  children: ReactNode;
}): React.JSX.Element {
  if (cast === undefined) return <>{children}</>;

  return <LandingCastProvider value={cast}>{children}</LandingCastProvider>;
}

/** The landing: `bar` over the hero's `badge`, `title`, and its `lead` beside its `actions`, over the live app, the sections, the `close`, and the `footer` over the wordmark. */
export function LandingPage({
  bar,
  barCall,
  badge,
  title,
  lead,
  actions,
  children,
  close,
  footer,
  cast,
}: {
  /** The site's wordmark and links, laid across the bar. */
  bar: ReactNode;
  /** The bar's call at its end, which a page narrower than a phone's leaves to the hero. */
  barCall?: ReactNode;
  /** What stands over the line, such as `LandingBackedBy`; none sets the line first. */
  badge?: ReactNode;
  /** The page's one line, its `h1`. */
  title: ReactNode;
  /** The sentence under the line; none sets the calls under the line itself. */
  lead?: ReactNode;
  /** The hero's calls, under its lead. */
  actions: ReactNode;
  /** The page's `LandingSection`s. */
  children: ReactNode;
  /** The page's last call: a heading, an optional sentence, and its calls. */
  close: { readonly title: ReactNode; readonly lead?: ReactNode; readonly actions: ReactNode };
  /** The site's closing links and notices. */
  footer: ReactNode;
  /** The people the mockups are drawn for, their pictures served by the site; none draws our own by their letters. */
  cast?: LandingCast | undefined;
}): React.JSX.Element {
  const closeId = `${useId()}close`;

  return (
    <SiteFrame bar={bar} barCall={barCall} footer={footer}>
      <LandingCastScope cast={cast}>
        <main>
          <div className="ui-landing-hero">
            <div className="ui-landing-hero-words">
              {badge === undefined ? null : <div className="ui-landing-hero-badge">{badge}</div>}
              <h1 className="ui-landing-title">{title}</h1>
              <div className="ui-landing-hero-row">
                {lead === undefined ? null : <p className="ui-landing-hero-lead">{lead}</p>}
                <div className="ui-landing-actions">{actions}</div>
              </div>
            </div>
            <div className="ui-landing-hero-stage">
              <div className="ui-landing-hero-app">
                <LandingHeroApp />
              </div>
            </div>
          </div>
          {children}
          <SiteRule />
          <section className="ui-landing-close" aria-labelledby={closeId}>
            <div className="ui-landing-close-words">
              <h2 className="ui-landing-close-title" id={closeId}>
                {close.title}
              </h2>
              {close.lead === undefined ? null : <p className="ui-landing-lead">{close.lead}</p>}
              <div className="ui-landing-actions">{close.actions}</div>
            </div>
            <div className="ui-landing-close-art">
              <MarkOrb />
            </div>
          </section>
        </main>
      </LandingCastScope>
    </SiteFrame>
  );
}
