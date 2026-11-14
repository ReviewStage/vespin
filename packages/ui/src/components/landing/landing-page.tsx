import { type ReactNode, useId } from "react";
import type { CodexArt } from "../../marks/harness-mark.js";
import { TEXT_LINK_HEIGHT, TextLink } from "../text-link/text-link.js";
import { type LandingFigure, LandingFigureArt } from "./landing-figures.js";
import { LandingHeroApp } from "./landing-hero.js";
import { LANDING_SCENE, type LandingScene, LandingSceneView } from "./landing-scenes.js";
import { SiteFrame, SiteRule } from "./site-frame.js";

export { SiteBarPages } from "./site-frame.js";

/**
 * landing-page.tsx -- the product's landing: the line over the live app, three pillars, a section per feature each over a moving screen, and a close over the wordmark in dots.
 *
 * The hero sets its line large and to the left, its sentence and its calls
 * on one row under it, and the Mac app live below them, as wide as the page
 * allows, its foot fading into the ground (`landing-hero.tsx`). Under it
 * three pillars stand side by side, each a line drawing over a name and a
 * sentence, parted by hairlines. A section opens under a hairline across
 * the page with its heading at the left and its sentence, larger, at the
 * right, a link to read more under it, and the feature's screen below them
 * both, the app's own components playing a short story
 * (`landing-scenes.tsx`), its edges fading into the ground. The close sets
 * the page's last call in the middle.
 *
 * It stands in the site's frame (`site-frame.tsx`). Its words and its links
 * are the caller's; its art, scenes, and rhythm are its own, drawn in the
 * theme's roles and the web profile's display styles (`tokens/display.css`).
 * It is drawn in `landing.css`.
 */

export { LANDING_FIGURE, type LandingFigure } from "./landing-figures.js";

export { LANDING_SCENE, type LandingScene };

/** A feature: `title` beside `lead` and its link to read `more`, over its scene's stage, `aside` beside the stage where given. */
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
  /** What stands beside the stage, such as `LandingFacts`; none lets the stage take the column. */
  aside?: ReactNode;
  /** Codex's picture as the site serves it, which a scene naming Codex draws its mark from. */
  codexArt?: CodexArt | undefined;
}): React.JSX.Element {
  const titleId = `${useId()}title`;

  const stage = (
    <div className="ui-landing-stage" data-scene={scene}>
      <LandingSceneView scene={scene} codexArt={codexArt} />
    </div>
  );

  return (
    <section className="ui-landing-section" aria-labelledby={titleId}>
      <SiteRule />
      <div className="ui-landing-section-body">
        <div className="ui-landing-section-head">
          <h2 className="ui-landing-section-title" id={titleId}>
            {title}
          </h2>
          <div className="ui-landing-section-words">
            <p className="ui-landing-lead">{lead}</p>
            {more === undefined ? null : (
              <TextLink href={more.href} height={TEXT_LINK_HEIGHT.CONTROL}>
                {more.label} →
              </TextLink>
            )}
          </div>
        </div>
        {aside === undefined ? (
          stage
        ) : (
          <div className="ui-landing-beside">
            {stage}
            {aside}
          </div>
        )}
      </div>
    </section>
  );
}

/** The page's pillars: three steps side by side, each a line drawing over its name and a sentence, parted by hairlines. */
export function LandingPillars({
  label,
  pillars,
}: {
  /** What the pillars are, said to a reader as the section's name. */
  label: string;
  pillars: readonly {
    readonly figure: LandingFigure;
    readonly title: string;
    readonly detail: ReactNode;
  }[];
}): React.JSX.Element {
  return (
    <section className="ui-landing-pillars-section" aria-label={label}>
      <SiteRule />
      <ol className="ui-landing-pillars">
        {pillars.map((pillar, index) => (
          <li key={pillar.title} className="ui-landing-pillar">
            <span className="ui-landing-pillar-number" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <LandingFigureArt figure={pillar.figure} />
            <h2 className="ui-landing-pillar-title">{pillar.title}</h2>
            <p className="ui-landing-pillar-detail">{pillar.detail}</p>
          </li>
        ))}
      </ol>
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

/** The landing: `bar` over the hero's `badge`, `title`, and its `lead` beside its `actions`, over the live app, the pillars and sections, the `close`, and the `footer` over the wordmark. */
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
  /** The page's `LandingPillars` and `LandingSection`s. */
  children: ReactNode;
  /** The page's last call: a heading, an optional sentence, and its calls. */
  close: { readonly title: ReactNode; readonly lead?: ReactNode; readonly actions: ReactNode };
  /** The site's closing links and notices. */
  footer: ReactNode;
}): React.JSX.Element {
  const closeId = `${useId()}close`;

  return (
    <SiteFrame bar={bar} barCall={barCall} footer={footer}>
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
          <h2 className="ui-landing-close-title" id={closeId}>
            {close.title}
          </h2>
          {close.lead === undefined ? null : <p className="ui-landing-lead">{close.lead}</p>}
          <div className="ui-landing-actions">{close.actions}</div>
        </section>
      </main>
    </SiteFrame>
  );
}
