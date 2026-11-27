/**
 * inbox-view-choices.ts -- what the Inbox lists and how, the account's own choices, so the phone's Inbox lists what the Mac's does and every choice outlives a relaunch.
 *
 * The scope the Inbox shows, whom the items it lists are addressed to,
 * whether its pinned tasks' items stand first, and which of those runs are
 * folded are the account's view choices the panel's Inbox keeps
 * (`@repo/panel`'s `folded-groups.ts`), read here through
 * `../view-choices.ts`. A scope or a fold an earlier build kept in this
 * device's `NSUserDefaults` moves up to the account once
 * (`useDeviceKeptMovedUp`, `../fold-list.ts`), and is drawn meanwhile; a
 * fold made before the account's runs are read waits for them. Until a choice is made,
 * the Inbox shows Open, the reader's own items, the pinned tasks' first,
 * no run folded, as the panel's opens.
 */

import {
  INBOX_RUNS,
  INBOX_SHOW,
  type InboxRun,
  type InboxShow,
  type InboxWhose,
  MINE,
} from "@repo/features/inbox-list-model";
import {
  VIEW_CHOICE_KEY,
  type ViewChoiceKey,
  type ViewChoiceValue,
} from "@repo/features/view-choice-wire";
import { useHeldValue } from "@repo/ui-native";
import { Option, Schema } from "effect";
import { useMemo } from "react";
import { useFoldList } from "../fold-list.js";
import {
  type DeviceKept,
  deviceKept,
  useDeviceKeptMovedUp,
  useViewChoice,
} from "../view-choices.js";

/** What a choice that did not keep says in the failure notice. */
const CHOICE_REFUSED = "Couldn't change what the Inbox shows.";

/** Where an earlier build kept the scope, and the runs folded, in this device's defaults. */
const DEVICE_KEPT = {
  SCOPE: deviceKept("inboxScope", Schema.Literals(Object.values(INBOX_SHOW))),
  FOLDED_RUNS: deviceKept("inboxFoldedRuns", Schema.Array(Schema.Literals(INBOX_RUNS))),
} as const;

/** One of the Inbox's choices as a screen draws it, and the press that keeps another. */
type InboxChoice<Key extends ViewChoiceKey> = readonly [
  ViewChoiceValue<Key>,
  (next: ViewChoiceValue<Key>) => void,
];

/** The account's choice of `key`, `fallback` where it keeps none, and the press that keeps another. */
function useInboxChoice<Key extends ViewChoiceKey>(
  key: Key,
  fallback: ViewChoiceValue<Key>,
): InboxChoice<Key> {
  const { value, choose } = useViewChoice(key, null, CHOICE_REFUSED);

  return [Option.getOrElse(value, () => fallback), choose];
}

/** The account's choice of `key`, the device's earlier copy while it moves up, else `fallback`, and the press that keeps another. */
function useMovedUpChoice<Key extends ViewChoiceKey>(
  key: Key,
  kept: DeviceKept<ViewChoiceValue<Key>>,
  fallback: ViewChoiceValue<Key>,
): InboxChoice<Key> {
  const choice = useViewChoice(key, null, CHOICE_REFUSED);
  const left = useHeldValue(kept.left);

  useDeviceKeptMovedUp(choice, kept);

  return [Option.getOrElse(choice.value, () => left ?? fallback), choice.choose];
}

/** The scope the Inbox shows, and the press that shows another. */
export interface InboxScope {
  readonly show: InboxShow;
  readonly choose: (show: InboxShow) => void;
}

/** The Inbox's scope, the account's, and the press that keeps another. */
export function useInboxScope(): InboxScope {
  const [show, choose] = useMovedUpChoice(
    VIEW_CHOICE_KEY.INBOX_SHOW,
    DEVICE_KEPT.SCOPE,
    INBOX_SHOW.OPEN,
  );

  return { show, choose };
}

/** Whom the items the Inbox lists are addressed to, and the press that names another. */
export interface InboxWhoseChoice {
  readonly whose: InboxWhose;
  readonly onWhose: (whose: InboxWhose) => void;
}

/** Whom the Inbox's items are addressed to, the account's, the reader until another is named. */
export function useInboxWhose(): InboxWhoseChoice {
  const [whose, onWhose] = useInboxChoice(VIEW_CHOICE_KEY.INBOX_WHOSE, MINE);

  return { whose, onWhose };
}

/** Whether the Inbox's pinned tasks' items stand first, and the press that turns it. */
export interface InboxPinnedFirst {
  readonly pinnedFirst: boolean;
  readonly onPinnedFirst: (pinnedFirst: boolean) => void;
}

/** Whether the pinned tasks' items stand first, the account's, on until turned off. */
export function useInboxPinnedFirst(): InboxPinnedFirst {
  const [pinnedFirst, onPinnedFirst] = useInboxChoice(VIEW_CHOICE_KEY.INBOX_PINNED_FIRST, true);

  return { pinnedFirst, onPinnedFirst };
}

/** The runs folded, and the press that folds a run or opens it. */
export interface InboxRunFolds {
  readonly folded: ReadonlySet<InboxRun>;
  readonly onFold: (run: InboxRun, shut: boolean) => void;
}

/** The Inbox's folded runs, the account's, and the door that folds one or opens it. Note that a fold made before the account's runs are read waits for them (`../fold-list.ts`), so it never writes over a run folded on another device. */
export function useInboxRunFolds(): InboxRunFolds {
  const [runs, onFold] = useFoldList(VIEW_CHOICE_KEY.INBOX_FOLDED_RUNS, {
    refused: CHOICE_REFUSED,
    kept: DEVICE_KEPT.FOLDED_RUNS,
  });

  const folded = useMemo(() => new Set(runs), [runs]);

  return { folded, onFold };
}
