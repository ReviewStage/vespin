import {
  DISCLOSURE_SUMMARY,
  DisclosureChevron,
  DisclosureFrame,
  DisclosureSummary,
  OneLine,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import type { ReactNode } from "react";
import { Fold, FoldBody } from "../ai-elements/fold.js";

/**
 * pull-request-section.tsx -- a section of a pull request's page, its Conversation and its Chapters alike: its heading, what it counts, and what it holds, folding where it folds.
 *
 * Note that the section stands apart from the Pull request tab
 * (`agent-pull-request-tab.tsx`), because that tab loads the Chapters tab
 * (`agent-chapters-tab.tsx`), and each draws its sections with it.
 */

/** Whether a section that folds stands open, and the press that opens or folds it. */
export interface SectionFold {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * A section of the page: its heading, what it counts beside it, and what it
 * holds. One that folds (`fold`) heads itself with a press across its whole
 * row, the chevron leading, which opens and folds it as the app's own
 * disclosure does, its motion and its reduced motion the disclosure's; what
 * stands at the row's end (`end`) keeps its own presses rather than folding
 * it. That row sticks to the top of the Conversation's scroller while its
 * section is in view, and the next section's pushes it off (tasks.css).
 */
export function Section({
  title,
  count,
  fold,
  end,
  children,
}: {
  title: string;
  count?: ReactNode;
  fold?: SectionFold | undefined;
  end?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  const heading = (
    <Text
      as={TEXT_ELEMENT.H3}
      variant={TEXT_VARIANT.GROUP}
      truncate
      className="pull-request-heading mx-0 mt-0 mb-item-gap flex items-baseline gap-item-gap px-row-inset"
    >
      {/* Note that the title is cut in a line of its own, since a flex row's bare words are never cut, and the count after it stays whole. */}
      <OneLine className="flex-initial">{title}</OneLine>
      {count === undefined ? null : (
        <span className="pull-request-count flex-none font-ui-regular text-muted-foreground tabular-nums">
          {count}
        </span>
      )}
    </Text>
  );

  if (fold === undefined) {
    return (
      <section className="pull-request-section" aria-label={title}>
        {heading}
        {children}
      </section>
    );
  }

  return (
    <section className="pull-request-section" aria-label={title}>
      <DisclosureFrame
        actions={
          end === undefined ? undefined : (
            <span className="pull-request-section-end flex flex-none items-center gap-control-gap">
              {end}
            </span>
          )
        }
      >
        <Fold
          className="pull-request-section-fold"
          open={fold.open}
          onOpenChange={fold.onOpenChange}
        >
          <DisclosureSummary look={DISCLOSURE_SUMMARY.TRANSCRIPT}>
            <DisclosureChevron />
            {heading}
          </DisclosureSummary>
          <FoldBody className="pull-request-section-body pt-tight-gap">{children}</FoldBody>
        </Fold>
      </DisclosureFrame>
    </section>
  );
}
