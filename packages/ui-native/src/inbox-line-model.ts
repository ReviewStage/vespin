// inbox-line-model.ts -- the glyphs and tones a row's marks wear: an Inbox row's last line, and a task row's pull request, as the panel draws them.

import { PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { INBOX_LINE, type InboxLineKind } from "@repo/features/inbox-list-model";
import {
  PULL_REQUEST_MARK_QUEUED,
  type PullRequestMarkState,
} from "@repo/features/pull-request-model";
import type { Glyph } from "./glyph.js";
import { STATUS_TONE, type StatusTone } from "./tokens/colors.js";
import { LUCIDE_SYMBOL } from "./tokens/lucide-symbols.js";

type InboxLineLook = { readonly symbol: Glyph; readonly tone: StatusTone };

/**
 * The panel's glyph for each line: Lucide's own Split for a decide ask,
 * which SF Symbols has no drawing of, and the SF Symbol closest to the
 * panel's Lucide glyph for the rest
 * (`@repo/features/inbox-list-model`'s `INBOX_LINE`): an ask that waits on
 * you in the attention ink, the accent's, since it wants you, and an
 * answered or resolved thread in the muted ink, since it no longer does. A
 * plain message leads with no glyph, as the panel's.
 */
export const INBOX_LINE_LOOK = {
  [INBOX_LINE.DECIDE]: { symbol: LUCIDE_SYMBOL.SPLIT, tone: STATUS_TONE.ATTENTION },
  [INBOX_LINE.DO]: { symbol: "checkmark.square", tone: STATUS_TONE.ATTENTION },
  [INBOX_LINE.ANSWER]: { symbol: "pencil.line", tone: STATUS_TONE.ATTENTION },
  [INBOX_LINE.SETTLED]: { symbol: "checkmark", tone: STATUS_TONE.NEUTRAL },
  [INBOX_LINE.RESOLVED]: { symbol: "checkmark.circle", tone: STATUS_TONE.NEUTRAL },
  [INBOX_LINE.SAID]: undefined,
} as const satisfies Record<InboxLineKind, InboxLineLook | undefined>;

/**
 * A pull request's mark, by where its mark says it stands
 * (`@repo/features/pull-request-model`'s `pullRequestMarkState`), in GitHub's
 * own colors, as the panel's agents mark draws it (`@repo/ui`'s
 * `PULL_REQUEST_GLYPH`): Lucide's own git glyphs, since SF Symbols has none.
 * An open one the merge queue holds wears the merge's glyph in the attention
 * ink, as the panel's does, so its words, "Queued", not its color alone, tell
 * it from a merged one.
 */
export const PULL_REQUEST_LOOK = {
  [PULL_REQUEST_STATE.OPEN]: { symbol: LUCIDE_SYMBOL.GIT_PULL_REQUEST, tone: STATUS_TONE.COMPLETE },
  [PULL_REQUEST_STATE.DRAFT]: {
    symbol: LUCIDE_SYMBOL.GIT_PULL_REQUEST_DRAFT,
    tone: STATUS_TONE.NEUTRAL,
  },
  [PULL_REQUEST_STATE.MERGED]: { symbol: LUCIDE_SYMBOL.GIT_MERGE, tone: STATUS_TONE.MERGED },
  [PULL_REQUEST_STATE.CLOSED]: {
    symbol: LUCIDE_SYMBOL.GIT_PULL_REQUEST_CLOSED,
    tone: STATUS_TONE.DANGER,
  },
  [PULL_REQUEST_MARK_QUEUED]: { symbol: LUCIDE_SYMBOL.GIT_MERGE, tone: STATUS_TONE.ATTENTION },
} as const satisfies Record<PullRequestMarkState, InboxLineLook>;
