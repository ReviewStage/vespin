/**
 * prototype-chat-ask.tsx -- PROTOTYPE, never merged: a Manager's ask drawn on the chat message it stands on, answered in place, from the chat or its thread.
 *
 * One kind of thread for a Manager: an ask (decide, do, answer) is no
 * Inbox thread of its own but a chat message whose thread is its
 * conversation. The card under the message is the Inbox's own ask controls
 * (`inbox-ask-controls.tsx`), standing open with a Send while it waits on
 * the reader, held still with whom it waits on while it waits on someone
 * else, and as the answer left them once answered. Answering writes the
 * reader's reply into the thread, and the Manager's acknowledgment a beat
 * after (`@repo/host/fixture-inbox`'s `answerPrototypeChatAsk`), whose
 * change stages the window's document anew, so the chat, the Manager's
 * Inbox tab, and the window's Inbox all move together.
 */

import { askHeadWords, missingWords } from "@repo/features/inbox-ask-words";
import {
  answeredDraft,
  EMPTY_INBOX_DRAFT,
  type InboxDraft,
  inboxMissing,
  inboxThreadSend,
} from "@repo/features/inbox-draft";
import {
  INBOX_ASK,
  INBOX_REPLY,
  type InboxAnswers,
  type InboxAsk,
} from "@repo/features/inbox-wire";
import {
  answerPrototypeChatAsk,
  onPrototypeChatMoved,
  PROTOTYPE_MANAGER_ID,
  prototypeAnsweredBy,
  prototypeChatAnswer,
  prototypeChatAsk,
  prototypeChatItem,
  prototypeChatVersion,
} from "@repo/host/fixture-inbox";
import {
  Badge,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  CardHead,
  QuietWords,
  STATUS_TONE,
} from "@repo/ui";
import { CheckIcon } from "@repo/ui/icons";
import { useState, useSyncExternalStore } from "react";
import { fixtureMoved } from "./fixture-moves.js";
import {
  AnsweredCard,
  AskControls,
  HeldControls,
  INBOX_ASK_BOX,
  INBOX_ASK_KIND,
} from "./inbox-ask-controls.js";
import { InboxPictures } from "./inbox-pictures.js";

// Note that every change of the prototype's asks stages the window's document anew, so every reader of it moves.
onPrototypeChatMoved(() => fixtureMoved());

/** The Manager whose chat the prototype's asks stand in. */
export const PROTO_MANAGER = PROTOTYPE_MANAGER_ID;

/** Follows the prototype's asks, so a card draws again as one is answered. */
export function usePrototypeChat(): number {
  return useSyncExternalStore(onPrototypeChatMoved, prototypeChatVersion);
}

/** Whether a chat message carries an ask. */
export function isPrototypeAsk(messageId: string): boolean {
  return prototypeChatAsk(messageId) !== undefined;
}

/** The thread a window's Inbox row opens in its Manager's chat, where it is one of the prototype's asks. */
export function prototypeThreadOfItem(itemId: string): string | undefined {
  return prototypeChatAsk(itemId)?.id;
}

/* ----- Landing in a Manager's thread from elsewhere ----- */

let pendingThread: string | undefined;
const pendingListeners = new Set<() => void>();

/** Asks the Manager's page to open `root`'s thread beside its chat once it stands. */
export function landInPrototypeThread(root: string): void {
  pendingThread = root;

  for (const listener of pendingListeners) listener();
}

/** Takes the thread a page was asked to open, once. */
export function takePrototypeThread(): string | undefined {
  const root = pendingThread;
  pendingThread = undefined;

  return root;
}

/** Hears an ask to open a thread. */
export function onPrototypeThreadAsked(listener: () => void): () => void {
  pendingListeners.add(listener);

  return () => pendingListeners.delete(listener);
}

/* ----- The answer's words ----- */

/** The answer as the reader's reply in the thread says it. */
function answerWords(ask: InboxAsk, answers: InboxAnswers): string {
  switch (answers.reply) {
    case INBOX_REPLY.CHOSE:
      return (answers.choices ?? []).join(", ") || "None of these";
    case INBOX_REPLY.DONE:
      return "Done";
    case INBOX_REPLY.NOT_DONE: {
      const steps = ask.type === INBOX_ASK.DO ? ask.steps.length : 0;
      const ticked = answers.steps?.length ?? 0;

      return steps === 0 ? "Couldn't do it" : `Couldn't do it (${ticked} of ${steps} done)`;
    }

    case INBOX_REPLY.SUBMITTED:
      return (answers.values ?? [])
        .map((value) => `**${value.label}:** ${valueWords(value.value)}`)
        .join("\n");
    default:
      return "Answered";
  }
}

function valueWords(value: unknown): string {
  if (value === true) return "Yes";

  if (value === false) return "No";

  return String(value);
}

/* ----- The card ----- */

/** Where the ask stands, at its head: who it waits on, or that it is answered. */
function Standing({
  answered,
  waitsOnReader,
  waitsOnName,
}: {
  answered: boolean;
  waitsOnReader: boolean;
  waitsOnName: string;
}): React.JSX.Element {
  if (answered) {
    return (
      <Badge tone={STATUS_TONE.COMPLETE} icon={<CheckIcon aria-hidden="true" />}>
        Answered
      </Badge>
    );
  }

  return (
    <Badge tone={waitsOnReader ? STATUS_TONE.ATTENTION : STATUS_TONE.NEUTRAL}>
      {waitsOnReader ? "Waiting on you" : `Waiting on ${waitsOnName}`}
    </Badge>
  );
}

/**
 * The ask a Manager's chat message carries, under its words: open with a
 * Send while it waits on the reader, held still while it waits on someone
 * else, as answered once it is; nothing for a message that asks nothing.
 */
export function PrototypeChatAsk({
  messageId,
  readerId,
  readInboxImage,
  onLand,
}: {
  messageId: string;
  readerId: string | undefined;
  /** Lands in the chat on the ask's thread, where the ask is drawn outside the chat. */
  onLand?: (() => void) | undefined;
  readInboxImage: (input: { itemId: string; attachmentId: string }) => Promise<unknown>;
}): React.JSX.Element | null {
  usePrototypeChat();
  const [draft, setDraft] = useState<InboxDraft>(EMPTY_INBOX_DRAFT);
  const [missing, setMissing] = useState<string | undefined>(undefined);
  const ask = prototypeChatAsk(messageId);
  const item = prototypeChatItem(messageId);

  if (ask === undefined || item === undefined || ask.message.ask === undefined) return null;
  const inboxAsk = ask.message.ask as InboxAsk;
  const answer = prototypeChatAnswer(ask.id);
  const waitsOnReader = ask.waitsOn.userId === readerId;
  const thread = item.thread ?? [];

  const send = () => {
    const sent = inboxThreadSend(thread, draft);

    if (sent?.answers === undefined) {
      const lacks = inboxMissing(thread, draft);
      setMissing(lacks === undefined ? "Pick an answer." : missingWords(lacks));

      return;
    }

    setMissing(undefined);
    answerPrototypeChatAsk(ask.id, sent.answers, answerWords(inboxAsk, sent.answers));
  };

  const textDoors = {
    self: PROTO_MANAGER,
    agent: undefined,
    skills: undefined,
    keywords: [],
    onEnter: send,
  };

  const controls =
    answer !== undefined ? (
      <HeldControls
        ask={inboxAsk}
        title={ask.title}
        draft={answeredDraft(inboxAsk, answer.answers)}
      />
    ) : waitsOnReader ? (
      <AskControls
        ask={inboxAsk}
        title={ask.title}
        doors={{
          draft,
          disabled: false,
          text: textDoors,
          onDraft: (next) => {
            setDraft(next);
            setMissing(undefined);
          },
        }}
      />
    ) : (
      <HeldControls ask={inboxAsk} title={ask.title} draft={EMPTY_INBOX_DRAFT} />
    );

  return (
    <InboxPictures
      itemId={ask.id}
      control={{
        read: (itemId, attachmentId) =>
          readInboxImage({ itemId, attachmentId }) as ReturnType<
            Parameters<typeof InboxPictures>[0]["control"]["read"]
          >,
      }}
    >
      <div className={`${INBOX_ASK_BOX} mt-tight-gap`} data-prototype-chat-ask={ask.id}>
        <Card look={CARD_LOOK.RAISED} padding={CARD_PADDING.FLUSH}>
          <CardHead>
            <span className={INBOX_ASK_KIND}>{askHeadWords(inboxAsk, undefined)}</span>
            <Standing
              answered={answer !== undefined}
              waitsOnReader={waitsOnReader}
              waitsOnName={ask.waitsOn.name}
            />
          </CardHead>
          <div className="flex min-w-0 flex-col gap-block-gap px-card-head-inline pb-card-head-block">
            {controls}
            {(answer === undefined && waitsOnReader) || onLand !== undefined ? (
              <div className="flex flex-wrap items-center gap-control-gap">
                {answer === undefined && waitsOnReader ? (
                  <Button
                    variant={BUTTON_VARIANT.PRIMARY}
                    size={BUTTON_SIZE.COMPACT}
                    onClick={send}
                  >
                    Send answer
                  </Button>
                ) : null}
                {onLand === undefined ? null : (
                  <Button
                    variant={BUTTON_VARIANT.QUIET}
                    size={BUTTON_SIZE.COMPACT}
                    onClick={onLand}
                  >
                    Open in chat
                  </Button>
                )}
                {missing === undefined ? null : <QuietWords>{missing}</QuietWords>}
              </div>
            ) : null}
          </div>
        </Card>
      </div>
    </InboxPictures>
  );
}

/** The ask a reader's reply in a thread answered, drawn at its head as the Inbox draws an answer; nothing for any other reply. */
export function PrototypeAnsweredHead({
  messageId,
}: {
  messageId: string;
}): React.JSX.Element | null {
  usePrototypeChat();
  const ask = prototypeAnsweredBy(messageId);
  const answer = ask === undefined ? undefined : prototypeChatAnswer(ask.id);

  if (ask?.message.ask === undefined || answer === undefined) return null;

  return (
    <AnsweredCard ask={ask.message.ask as InboxAsk} title={ask.title} answers={answer.answers} />
  );
}

/** Where an ask stands for the reader: waiting on them, waiting on someone else, or settled. */
export const PROTO_ASK_STANDING = {
  READER: "reader",
  OTHERS: "others",
  SETTLED: "settled",
} as const;

type ProtoAskStanding = (typeof PROTO_ASK_STANDING)[keyof typeof PROTO_ASK_STANDING];

/** Where the ask a chat message carries stands for the reader; none for a message that asks nothing. */
export function prototypeAskStanding(
  messageId: string,
  readerId: string | undefined,
): ProtoAskStanding | undefined {
  const ask = prototypeChatAsk(messageId);

  if (ask === undefined) return undefined;

  if (prototypeChatAnswer(ask.id) !== undefined) return PROTO_ASK_STANDING.SETTLED;

  return ask.waitsOn.userId === readerId ? PROTO_ASK_STANDING.READER : PROTO_ASK_STANDING.OTHERS;
}
