/**
 * feedback-dialog.tsx -- a note to the people who make the app, written in a modal over the window: words, screenshots, and whether to sign it.
 *
 * The window dims and a card holds the window's one composer, as New task's
 * does: the screenshots over the words, the + that attaches more and the
 * round send at its foot, and whether to sign it under it. The field takes
 * focus, Tab stays inside the card, and focus goes back to whatever opened
 * it. Enter in the field sends, as every box's does (`enter-sends.ts`), and
 * Shift+Enter adds a line.
 *
 * One door opens it, Send feedback; a choice at the card's head turns the
 * note into a prompt, written as an agent would be asked to build what the
 * reader wants, and back, so the menus hold one item rather than one per
 * kind. Each kind keeps its own draft, so a note is always sent as the kind
 * it was written as. One rule keeps it: only a delivered send discards it;
 * Escape and a press on the dimmed window only close the card, keeping the
 * words and screenshots for the next opening of that kind — unless there are
 * no words yet, in which case there is nothing worth keeping and they discard
 * it too. While there are words, the first of them nudges the card and keeps
 * it open, so a stray press never takes the card from under a note being
 * written, and the next closes it. A send refused shakes the card.
 *
 * What a send carries is exactly what the card shows: the words, the
 * screenshots drawn in it, which experiment the note is about where its
 * title names one (opened from that experiment's row in Settings ›
 * Experimental), and — only while "Include my name and email" is
 * ticked — the signed-in account's name and address, the line under the
 * box reads out. Nothing else rides along, a credential least of all.
 */

import { ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import {
  draftHasWords,
  draftSubmission,
  FEEDBACK_COPY,
  FEEDBACK_KIND,
  FEEDBACK_KIND_CHOICES,
  FEEDBACK_LIMITS,
  FEEDBACK_WORDS,
  type FeedbackDraft,
  type FeedbackImage,
  type FeedbackKind,
  type FeedbackSignature,
  FRESH_FEEDBACK_DRAFT,
  feedbackSignature,
  signatureLine,
} from "@repo/features/feedback";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { pasteCutWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENTS, type Experiment } from "@repo/settings";
import {
  ALIGN,
  AttachmentChip,
  CHOICE_BAR_LOOK,
  Checkbox,
  ChoiceBar,
  ComposerBody,
  ComposerFoot,
  ComposerFrame,
  type ComposerNote,
  DIALOG_SIZE,
  Dialog,
  GAP,
  Inline,
  LAYOUT_ELEMENT,
  LIST_MOTION_WAY,
  ListMotion,
  TEXT_AREA_LOOK,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextArea,
  useLeaving,
} from "@repo/ui";
import { UNREPORTED } from "@repo/ui/reported-failure";
import { useStateWithRef } from "@repo/ui/use-state-with-ref";
import { useMutation } from "@tanstack/react-query";
import { type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { actMutation } from "./act-mutations.js";
import { enterKeyHint, enterSubmitKey } from "./enter-sends.js";
import { failureShown } from "./failure-report.js";
import { encodeImage } from "./feedback-images.js";
import { imageFiles } from "./picture-files.js";
import { AttachFilesButton } from "./tasks/attach-files-button.js";
import { DROP_LEAVE, useFileDrop } from "./use-file-drop.js";

/**
 * Why the last attachment or send did not go: its words, and whether they
 * are the person's input checked, a picture refused, rather than a failure
 * of the app's.
 */
interface Rejection {
  readonly words: string;
  readonly input: boolean;
}

/** How many lines the empty note stands tall before it grows with its words. */
const MESSAGE_ROWS = 5;

type FeedbackDrafts = Readonly<Record<FeedbackKind, FeedbackDraft>>;

const FRESH_DRAFTS = {
  [FEEDBACK_KIND.FEEDBACK]: FRESH_FEEDBACK_DRAFT,
  [FEEDBACK_KIND.PROMPT]: FRESH_FEEDBACK_DRAFT,
} satisfies FeedbackDrafts;

function accountSignature(account: AccountSnapshot | undefined): FeedbackSignature | undefined {
  return feedbackSignature(account?.status === ACCOUNT_STATUS.SIGNED_IN ? account : undefined);
}

/** The dialog's title: Send feedback, or which experiment a note is about where it was opened from that experiment's row. */
function dialogTitle(about: Experiment | undefined): string {
  const experiment = EXPERIMENTS.find((entry) => entry.key === about);

  return experiment ? `Feedback on ${experiment.name}` : FEEDBACK_WORDS.TITLE;
}

function feedbackImageUrl(image: FeedbackImage): string {
  return `data:${image.mediaType};base64,${image.base64}`;
}

/** The screenshots' row, each by a key minted for its image, a screenshot taken off scaling out where it stood. */
function FeedbackImageRow({
  row,
  images,
  busy,
  onRemove,
}: {
  row: RefObject<HTMLUListElement | null>;
  images: readonly FeedbackImage[];
  busy: boolean;
  onRemove: (image: FeedbackImage) => void;
}): React.JSX.Element | null {
  const [ids] = useState(() => new WeakMap<FeedbackImage, string>());
  const minted = useRef(0);

  const idOf = (image: FeedbackImage): string => {
    const known = ids.get(image);

    if (known !== undefined) return known;
    minted.current += 1;
    const id = String(minted.current);
    ids.set(image, id);

    return id;
  };

  const drawn = useLeaving(images, idOf);

  if (drawn.length === 0) return null;

  return (
    <Inline
      as={LAYOUT_ELEMENT.UL}
      gap={GAP.CONTROL}
      align={ALIGN.STRETCH}
      ref={row}
      className="feedback-dialog-images"
      aria-label="Screenshots"
      moves
    >
      {drawn.map(({ key, value: image, leaving }) => (
        <AttachmentChip
          key={key}
          motionKey={key}
          name={image.name}
          image={feedbackImageUrl(image)}
          removeDisabled={busy || leaving}
          onRemove={() => onRemove(image)}
        />
      ))}
    </Inline>
  );
}

/** The screenshots attached to the kind's draft, under a motion that scales one in and out (`ListMotion`); another kind's draft is another scene, which stands at once. */
function FeedbackImages({
  kind,
  ...props
}: {
  kind: FeedbackKind;
  images: readonly FeedbackImage[];
  busy: boolean;
  onRemove: (image: FeedbackImage) => void;
}): React.JSX.Element {
  const row = useRef<HTMLUListElement | null>(null);

  return (
    <ListMotion root={row} way={LIST_MOTION_WAY.SCALE} scene={kind}>
      <FeedbackImageRow row={row} {...props} />
    </ListMotion>
  );
}

/**
 * Encodes picked, pasted, or dropped files on this machine — scaled and
 * re-written where a screenshot would not fit the request a submission
 * travels as — and says what could not come rather than dropping it.
 */
async function takenImages(
  files: readonly File[],
  room: number,
): Promise<{ images: FeedbackImage[]; refusal?: string }> {
  const images: FeedbackImage[] = [];
  let unreadable: string | undefined;

  for (const file of files.slice(0, Math.max(0, room))) {
    const read = await encodeImage(file);

    if ("image" in read) images.push(read.image);
    else unreadable ??= read.unreadable ?? FEEDBACK_WORDS.UNREADABLE;
  }

  if (unreadable !== undefined) return { images, refusal: unreadable };

  if (files.length > room) return { images, refusal: FEEDBACK_WORDS.FULL };

  return { images };
}

/**
 * The one line under the composer's foot: why the last send or attachment
 * did not go, a screenshot refused being the person's input checked and a
 * send refused the app's failure; else a paste cut to the room left.
 */
function composerNote(rejection: Rejection | undefined, cut: boolean): ComposerNote | undefined {
  if (rejection !== undefined) {
    return {
      words: rejection.words,
      failure: rejection.input
        ? UNREPORTED.INPUT
        : failureShown({
            surface: FAILURE_SURFACE.FEEDBACK_SEND,
            cause: FAILURE_CONDITION.REFUSED,
            refused: true,
          }),
    };
  }

  return cut
    ? { words: pasteCutWords(FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH), failure: UNREPORTED.INPUT }
    : undefined;
}

/**
 * The dialog for the kind asked for, while one is, and the thank-you after a
 * send lands. Always mounted by the app, because the drafts it keeps between
 * openings live here.
 */
export function FeedbackDialog({
  kind,
  about,
  account,
  onKind,
  onClose,
}: {
  /** The kind being written, or nothing while the dialog is closed. */
  kind: FeedbackKind | undefined;
  /** The experiment the note is about, where an experiment's row opened it. */
  about?: Experiment | undefined;
  account: AccountSnapshot | undefined;
  /** Turns the note into the other kind, from the choice at the card's head; a note about an experiment offers no choice. */
  onKind: (kind: FeedbackKind) => void;
  onClose: () => void;
}): React.JSX.Element | null {
  const { mutateAsync: sendFeedback } = useMutation(actMutation(ACT_KIND.FEEDBACK_SEND));
  const [drafts, setDrafts, latestDrafts] = useStateWithRef<FeedbackDrafts>(FRESH_DRAFTS);

  /**
   * Counts each kind's discards, so a screenshot still being read when its
   * draft was discarded or sent lands in no draft at all.
   */
  const discards = useRef<Record<FeedbackKind, number>>({
    [FEEDBACK_KIND.FEEDBACK]: 0,
    [FEEDBACK_KIND.PROMPT]: 0,
  });

  /** The kind on screen now, for work that finishes renders after it began. */
  const shownKind = useRef(kind);
  shownKind.current = kind;
  const [busy, setBusy, latestBusy] = useStateWithRef(false);
  const [rejection, setRejection] = useState<Rejection>();
  // The words a paste past the cap left once it was cut to fit; the note stands while they do.
  const [cutWords, setCutWords] = useState<string>();

  const fileDrop = useFileDrop((files) => void attach(imageFiles(files)), {
    leave: DROP_LEAVE.WINDOW,
  });

  const open = kind !== undefined;
  const field = useRef<HTMLTextAreaElement | null>(null);
  const signatureId = useId();
  const signature = accountSignature(account);

  /**
   * Which experiment each kind's kept draft was written about. A note kept by
   * Escape belongs to the place it was written from, so opened about another
   * experiment, or about none, that kind starts fresh rather than sending the
   * old words under the new title.
   */
  const draftAbout = useRef<Record<FeedbackKind, Experiment | undefined>>({
    [FEEDBACK_KIND.FEEDBACK]: undefined,
    [FEEDBACK_KIND.PROMPT]: undefined,
  });

  useLayoutEffect(() => {
    if (kind === undefined || draftAbout.current[kind] === about) return;
    draftAbout.current[kind] = about;
    discards.current[kind] += 1;
    setDrafts({ ...latestDrafts(), [kind]: FRESH_FEEDBACK_DRAFT });
  }, [kind, about, latestDrafts, setDrafts]);

  // Closing puts a drop's highlight away, whatever became of the drag.
  useEffect(() => {
    if (!open) fileDrop.clear();
  }, [open]);

  const draft = drafts[kind ?? FEEDBACK_KIND.FEEDBACK];

  const writeDraft = (of: FeedbackKind, next: FeedbackDraft) => {
    setDrafts({ ...latestDrafts(), [of]: next });
  };

  const discardDraft = (of: FeedbackKind) => {
    discards.current[of] += 1;
    writeDraft(of, FRESH_FEEDBACK_DRAFT);
  };

  const changeDraft = (next: Partial<FeedbackDraft>) => {
    if (kind === undefined) return;
    writeDraft(kind, { ...latestDrafts()[kind], ...next });
    setRejection(undefined);
  };

  // Note that the browser cuts a paste to the room left without a word, so the words it leaves are worked out here to tell it.
  const noteCutPaste = (box: HTMLTextAreaElement, pasted: string) => {
    const kept = box.value.slice(0, box.selectionStart) + box.value.slice(box.selectionEnd);
    const room = FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH - kept.length;
    const text = pasted.replaceAll("\r\n", "\n");

    if (text.length <= room) return;
    setCutWords(
      box.value.slice(0, box.selectionStart) +
        text.slice(0, room) +
        box.value.slice(box.selectionEnd),
    );
  };

  const close = () => {
    if (kind === undefined || latestBusy()) return;

    if (!draftHasWords(latestDrafts()[kind])) discardDraft(kind);
    setRejection(undefined);
    onClose();
  };

  const attach = async (files: readonly File[]) => {
    if (kind === undefined || files.length === 0 || latestBusy()) return;
    const of = kind;
    const discarded = discards.current[of];

    const taken = await takenImages(
      files,
      FEEDBACK_LIMITS.MAX_IMAGES - latestDrafts()[of].images.length,
    );

    // Note that a draft discarded or sent while its screenshots were read
    // takes none of them, and neither does one now being sent, because
    // either would carry a picture into a note nobody attached it to.
    if (discards.current[of] !== discarded || latestBusy()) return;
    // Read again after the encoding: typing meanwhile replaced the draft.
    const current = latestDrafts()[of];
    writeDraft(of, {
      ...current,
      images: [...current.images, ...taken.images].slice(0, FEEDBACK_LIMITS.MAX_IMAGES),
    });

    if (shownKind.current === of) {
      setRejection(taken.refusal === undefined ? undefined : { words: taken.refusal, input: true });
    }
  };

  const send = async () => {
    if (kind === undefined) return;
    const current = latestDrafts()[kind];

    if (latestBusy() || !draftHasWords(current)) return;
    setBusy(true);
    setRejection(undefined);

    const refusal = await sendFeedback({
      submission: draftSubmission(kind, current, signature, about),
    }).then(
      (result) => (result.delivered ? undefined : (result.reason ?? FEEDBACK_WORDS.SEND_REFUSAL)),
      () => FEEDBACK_WORDS.SEND_REFUSAL,
    );

    setBusy(false);

    if (refusal !== undefined) {
      setRejection({ words: refusal, input: false });

      return;
    }

    discardDraft(kind);
    onClose();
  };

  // Note that the card is drawn as it last stood while it fades out, because
  // what it was opened with, and the draft a send has emptied, are let go
  // the moment it closes.
  const standing = useRef<
    { kind: FeedbackKind; about: Experiment | undefined; draft: FeedbackDraft } | undefined
  >(undefined);

  if (kind !== undefined) standing.current = { kind, about, draft };
  const shown = standing.current;

  const full = draft.images.length >= FEEDBACK_LIMITS.MAX_IMAGES;

  return shown === undefined ? null : (
    // The whole dimmed window takes a dropped screenshot.
    <Dialog
      open={open}
      size={DIALOG_SIZE.WIDE}
      title={dialogTitle(shown.about)}
      busy={busy}
      refused={rejection !== undefined}
      holding={draftHasWords(draft)}
      initialFocus={field}
      onDismiss={close}
      dropping={fileDrop.dropping}
      dropTarget={fileDrop.target}
    >
      <div className="feedback-dialog flex min-h-0 flex-col gap-block-gap">
        {shown.about === undefined ? (
          <ChoiceBar<FeedbackKind>
            label={FEEDBACK_WORDS.KIND}
            items={FEEDBACK_KIND_CHOICES}
            value={shown.kind}
            look={CHOICE_BAR_LOOK.SEGMENTED}
            disabled={busy}
            onChange={onKind}
          />
        ) : null}
        {/* Note that the note is written in the window's one composer, its screenshots over its words and the + and the round send at its foot, as an agent's box and New task's are. */}
        <ComposerFrame
          className="feedback-dialog-composer flex min-w-0 flex-col"
          dropping={fileDrop.dropping}
        >
          <ComposerBody
            files={
              <FeedbackImages
                kind={shown.kind}
                images={shown.draft.images}
                busy={busy}
                onRemove={(image) =>
                  changeDraft({
                    images: latestDrafts()[shown.kind].images.filter((held) => held !== image),
                  })
                }
              />
            }
          >
            {/* Note that the bare field stands at the card's inset, as the files over it and the foot under it do. */}
            <div className="feedback-dialog-field px-ui-12 pt-ui-12">
              <TextArea
                ref={field}
                label={FEEDBACK_COPY[shown.kind].field}
                look={TEXT_AREA_LOOK.BARE}
                placeholder={FEEDBACK_COPY[shown.kind].placeholder}
                maxLength={FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH}
                value={shown.draft.message}
                disabled={busy}
                rows={MESSAGE_ROWS}
                grow
                enterKeyHint={enterKeyHint()}
                submitKey={enterSubmitKey()}
                onSubmit={() => void send()}
                onChange={(message) => changeDraft({ message })}
                onPaste={(event) => {
                  // A screenshot on the clipboard is an attachment, not text
                  // that failed to paste; text pastes as it always does.
                  const pasted = imageFiles(event.clipboardData.files);

                  if (pasted.length === 0) {
                    noteCutPaste(event.currentTarget, event.clipboardData.getData("text"));

                    return;
                  }

                  event.preventDefault();
                  void attach(pasted);
                }}
              />
            </div>
          </ComposerBody>
          <ComposerFoot
            tools={
              <AttachFilesButton
                label={FEEDBACK_WORDS.ATTACH}
                accept="image/*"
                disabled={busy || full}
                onFiles={(picked) => void attach(imageFiles(picked))}
              />
            }
            counter={{
              length: shown.draft.message.length,
              limit: FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH,
            }}
            send={{
              label: FEEDBACK_WORDS.SEND,
              empty: !draftHasWords(draft),
              onSend: () => void send(),
              busy,
              busyLabel: FEEDBACK_WORDS.SENDING,
            }}
            note={composerNote(rejection, cutWords === shown.draft.message)}
          />
        </ComposerFrame>
        {signature ? (
          // Note that who the note is signed by stands under the box's words, so a long address is cut there rather than squeezing the words onto two lines.
          <Checkbox
            checked={shown.draft.signed}
            disabled={busy}
            aria-describedby={signatureId}
            onChange={(signed) => changeDraft({ signed })}
            detail={
              <Text
                as={TEXT_ELEMENT.SPAN}
                variant={TEXT_VARIANT.CAPTION}
                tone={TEXT_TONE.MUTED}
                truncate
                id={signatureId}
              >
                {signatureLine(signature, shown.draft.signed)}
              </Text>
            }
          >
            {FEEDBACK_WORDS.SIGN}
          </Checkbox>
        ) : null}
      </div>
    </Dialog>
  );
}
