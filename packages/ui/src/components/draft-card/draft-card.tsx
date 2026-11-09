import { type ReactNode, useMemo } from "react";
import {
  DRAFT_KIND,
  DRAFT_MARK,
  DRAFT_RUN,
  type DraftCopy,
  type DraftKind,
  type DraftMark,
  type DraftRun,
  draftCopy,
  readDraft,
} from "../../draft-text.js";
import { DraftIcon, MailIcon } from "../../icons/lucide-glyphs.js";
import { MARK_PROVIDER, ProviderMark } from "../../marks/provider-mark.js";
import { CARD_CORNER, CARD_ELEMENT, CARD_LOOK, CARD_PADDING, Card } from "../card/card.js";
import { BlockCardHeader, CODE_CARD_TITLE } from "../code-card/code-card.js";
import { CopyButton } from "../copy-button/copy-button.js";
import { PROSE_CLASS } from "../prose/prose.js";

/**
 * draft-card.tsx -- words an agent wrote to be sent elsewhere, drawn as they will look there: a Slack message with its marks and links, an email under its subject, or a plain draft, with a Copy that keeps their formatting.
 *
 * A draft stands in a card headed as a code card is (`BlockCardHeader`),
 * by where it goes after that place's glyph ("Slack message" after Slack's
 * mark, "Email" after an envelope, "Draft" after a pen), with the one Copy
 * at its end, "Copy message". Under it the words stand on the card's own
 * surface in the type of the words around it, every line break where the
 * agent put it and a long line wrapping as a message's does, rather than
 * in mono on the code's ground, since they are a message and not code. A
 * Slack message's marks are drawn as Slack draws them, bold, italic, struck
 * through, or a code span in the prose's tint (`PROSE_CLASS`), and its links as the caller draws a link
 * (`link`), which opens it as the window opens any. An email's subject
 * stands on a row of its own between the header and the body, after the
 * word "Subject", with a Copy of its own ("Copy subject"), since a subject
 * is pasted into a field of its own.
 *
 * The header's Copy puts the body on the clipboard as rich text, its HTML
 * and its plain words together (`@repo/ui/draft-text`'s `draftCopy`),
 * through the caller's act (`copy`), so it pastes into Slack or Mail with
 * its links and bold; the subject's copies its words alone (`copyText`).
 */

/** What each draft's header says it is. */
const TITLE = {
  [DRAFT_KIND.SLACK]: "Slack message",
  [DRAFT_KIND.EMAIL]: "Email",
  [DRAFT_KIND.DRAFT]: "Draft",
} as const satisfies Record<DraftKind, string>;

/** The glyph each draft's header leads with: where it goes. */
const GLYPH = {
  [DRAFT_KIND.SLACK]: () => <ProviderMark provider={MARK_PROVIDER.SLACK} />,
  [DRAFT_KIND.EMAIL]: MailIcon,
  [DRAFT_KIND.DRAFT]: DraftIcon,
} as const satisfies Record<DraftKind, () => React.JSX.Element>;

/** What each Copy copies, as "Copy message" and "Copy subject". */
const COPY_WHAT = {
  BODY: "message",
  SUBJECT: "subject",
} as const;

/** The element each Slack mark is drawn as. */
const MARK_ELEMENT = {
  [DRAFT_MARK.BOLD]: "strong",
  [DRAFT_MARK.ITALIC]: "em",
  [DRAFT_MARK.STRIKE]: "s",
  [DRAFT_MARK.CODE]: "code",
} as const satisfies Record<DraftMark, keyof React.JSX.IntrinsicElements>;

/** The word a subject's row leads with. */
const SUBJECT_LABEL = "Subject";

/** Runs drawn as their marks, links, and words. */
function Runs({
  runs,
  link,
}: {
  runs: readonly DraftRun[];
  link: (url: string, children: ReactNode) => ReactNode;
}): ReactNode {
  return runs.map((run, at) => {
    // Note that a run's place is its identity: a draft's runs are read afresh, never reordered.
    if (run.kind === DRAFT_RUN.TEXT) return <span key={at}>{run.text}</span>;
    const inner = <Runs runs={run.runs} link={link} />;
    if (run.kind === DRAFT_RUN.LINK) return <span key={at}>{link(run.url, inner)}</span>;
    const Mark = MARK_ELEMENT[run.mark];
    return <Mark key={at}>{inner}</Mark>;
  });
}

/** A draft bound for `kind`, read from its fenced `text`, as it will look when sent. */
export function DraftCard({
  kind,
  text,
  link,
  copy,
  copyText,
}: {
  /** Where the draft goes, which its fence names. */
  kind: DraftKind;
  /** The fence's words, as the agent wrote them. */
  text: string;
  /** How the caller draws a link to `url` over `children`, opening it as the window opens any. */
  link: (url: string, children: ReactNode) => ReactNode;
  /** The caller's platform act that puts the body on the clipboard as rich text; a rejection is a refused copy. */
  copy: (rich: DraftCopy) => Promise<void>;
  /** The caller's platform act that puts words on the clipboard, an email's subject's. */
  copyText: (text: string) => Promise<void>;
}): React.JSX.Element {
  const draft = useMemo(() => readDraft(kind, text), [kind, text]);
  const rich = useMemo(() => draftCopy(draft), [draft]);
  const Glyph = GLYPH[kind];
  return (
    <Card
      as={CARD_ELEMENT.FIGURE}
      look={CARD_LOOK.SURFACE}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.FLUSH}
      className="ui-draft-card m-0"
      data-draft={kind}
    >
      <BlockCardHeader
        glyph={<Glyph />}
        title={TITLE[kind]}
        titleIs={CODE_CARD_TITLE.WORDS}
        actions={<CopyButton text={rich.text} what={COPY_WHAT.BODY} copy={() => copy(rich)} />}
      />
      {draft.subject === undefined ? null : (
        <div className="ui-draft-card-subject flex min-w-0 items-center gap-control-gap border-b border-border pl-list-inset">
          <span className="ui-draft-card-subject-label flex-none text-muted-foreground">
            {SUBJECT_LABEL}
          </span>
          <span className="ui-draft-card-subject-words min-w-0 flex-1 font-label wrap-break-word">
            {draft.subject}
          </span>
          <span className="flex flex-none">
            <CopyButton text={draft.subject} what={COPY_WHAT.SUBJECT} copy={copyText} />
          </span>
        </div>
      )}
      <div
        className={`ui-draft-card-body ${PROSE_CLASS} px-list-inset py-row-inset text-foreground whitespace-pre-wrap wrap-break-word`}
      >
        <Runs runs={draft.runs} link={link} />
      </div>
    </Card>
  );
}
