/**
 * page-intro.tsx -- the card each of four pages opens with the first time the account visits it, and whether it still stands.
 *
 * Automations, the Inbox, a task's Overview, and an agent's Browser tab each
 * open with an intro (`@repo/ui`'s `IntroCard`): what the page is for in
 * one sentence, Learn more, which opens its docs page in the browser, and
 * Got it. Each one's glyph, words, and docs address are written once, here
 * (`INTRO_PAGE`), so a renamed docs page is one line. The glyph is the one
 * the page already wears where it is named: the sidebar's row for
 * Automations and the Inbox, and the tab's own (`tabLook`) for the Overview
 * and the Browser.
 *
 * Which intros the account has seen is its preference
 * (`APP_SETTING_SCHEMA.introsSeen`), so Got it on one device dismisses the
 * card on every other. A card stands only once the service has answered the
 * account's preferences (`accountRead`), since an account made before the
 * intros shipped reads them all as seen and must not see one flash before
 * that answer lands. Got it adds the intro to the list the account holds;
 * the card goes at once in this window, before the write comes back, and
 * stands again if the write is refused, so Got it can be pressed again.
 */

import { ENTITY_KIND } from "@repo/features/entity-kind";
import { LINK_PAGE } from "@repo/features/link-home";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  APP_SETTING_SCHEMA,
  INTRO,
  type Intro,
  introsSeenFrom,
  introsSeenWith,
} from "@repo/settings";
import { IntroCard } from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { actMutation } from "./act-mutations.js";
import { EntityGlyph } from "./entities/entity-glyph.js";
import { TAB_KIND, tabLook } from "./tasks/tab-look.js";
import { useOpenLink } from "./tasks/use-open-link.js";
import { appStateQuery, selectAppSettingsView } from "./use-app-state.js";

/**
 * What each page's intro draws: its glyph, its one sentence, and the docs
 * page Learn more opens. Note that each glyph is drawn as the card draws,
 * because the tab looks import the pages that mount these cards.
 */
const INTRO_PAGE: Record<Intro, { glyph: () => ReactNode; words: string; learnMore: string }> = {
  [INTRO.AUTOMATIONS]: {
    glyph: () => <EntityGlyph kind={ENTITY_KIND.AUTOMATIONS} />,
    words:
      "Automations start agents on a schedule, or when GitHub, Sentry, or a webhook says something happened.",
    learnMore: `${LINK_PAGE.DOCS}/automations`,
  },
  [INTRO.INBOX]: {
    glyph: () => <EntityGlyph kind={ENTITY_KIND.INBOX} />,
    words:
      "Agents post here when they need your decision, a to-do done, or your review, and your answer goes straight back to them.",
    learnMore: `${LINK_PAGE.DOCS}/inbox`,
  },
  [INTRO.TASK_OVERVIEW]: {
    glyph: () => tabLook({ kind: TAB_KIND.OVERVIEW }).icon,
    words:
      "You and the task's agents keep this description current: edit it, or comment and mention an agent to steer them.",
    learnMore: `${LINK_PAGE.DOCS}/tasks`,
  },
  [INTRO.BROWSER]: {
    glyph: () => tabLook({ kind: TAB_KIND.BROWSER, title: undefined }).icon,
    words: "This is the agent's own browser: watch it work, or take over to sign in for it.",
    learnMore: `${LINK_PAGE.DOCS}/tasks#the-agents-browser`,
  },
};

/** What the window reads of the intros: whether the account's preferences are answered, and the list it holds. */
function selectIntros(state: AppStateSnapshot) {
  const settings = selectAppSettingsView(state);

  return { read: settings?.accountRead === true, seen: settings?.introsSeen };
}

/** Whether `intro`'s card stands: the account's preferences answered, and the intro not yet seen; and Got it, which dismisses it for good. */
export function useIntro(intro: Intro) {
  const intros = useQuery({ ...appStateQuery, select: selectIntros }).data;
  const { mutate: updateSetting } = useMutation(actMutation(ACT_KIND.SETTING_UPDATE));
  const [dismissed, setDismissed] = useState(false);
  const seen = introsSeenFrom(intros?.seen).includes(intro);

  const dismiss = () => {
    setDismissed(true);
    updateSetting(
      { field: APP_SETTING_SCHEMA.introsSeen.field, value: introsSeenWith(intros?.seen, intro) },
      { onError: () => setDismissed(false) },
    );
  };

  return { shown: intros?.read === true && !seen && !dismissed, dismiss };
}

/** `intro`'s card while the account has not seen it, at the head of its page. */
export function PageIntro({ intro }: { intro: Intro }): React.JSX.Element {
  const { shown, dismiss } = useIntro(intro);
  const open = useOpenLink();
  const page = INTRO_PAGE[intro];

  return (
    <IntroCard
      shown={shown}
      glyph={page.glyph()}
      learnMore={page.learnMore}
      open={open}
      onDismiss={dismiss}
    >
      {page.words}
    </IntroCard>
  );
}
