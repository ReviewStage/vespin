/**
 * manager-chat-edit.tsx -- the reader's own message of a Manager's chat edited in place, as Slack edits one: Edit among its actions, its words opened in a box where it stands, and Save, which changes them there and marks it edited.
 *
 * A Manager's chat is a team channel, so an edit there is a channel's, not
 * an agent conversation's rewind: the message keeps its place, its files,
 * its thread, and everything after it, and its words change in place under
 * an "(edited)" mark. The Manager is told in a turn of its own, naming the
 * words before and after (`AGENTS_CHAT_EDIT`), and answers in the chat as
 * it answers any message. Only the reader's own messages offer Edit, and
 * only their words are written again, in the chat's own box
 * (`AgentComposer`) less its files; Save with the words as they stand
 * closes the box and asks nothing.
 *
 * A save is drawn at once (`useChatEdit`): over the window's document
 * until its ask settles (`drawAhead`), by when the host has written it into
 * the chat it holds where the service took it (`manager-chat-follow.ts`);
 * where it did not, the words go back and a toast says so.
 */

import { REWIND_WORDS } from "@repo/features/agent-rewind-model";
import { AGENT_STATUS } from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { type ManagerChatEditPress, withEditPress } from "@repo/features/manager-chat-live";
import { CHAT_EDIT_WORDS } from "@repo/features/manager-chat-view";
import { FAILURE_SURFACE, failureAboutOf } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { BUTTON_SIZE, BUTTON_VARIANT, Button, STATUS_TONE } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { pressMutation } from "../act-mutations.js";
import { MessageAction } from "../ai-elements/message.js";
import {
  DRAFT_PLACE,
  type EditPlace,
  EMPTY_DRAFT,
  useDraft,
  useDraftWriter,
} from "../composer-drafts.js";
import { showToast } from "../toast.js";
import { drawAhead } from "../use-app-state.js";
import { AgentComposer, type ComposerWords } from "./agent-composer.js";
import { useHandedWords } from "./box-words.js";
import type { HeldUpdate } from "./refused-send.js";
import type { SkillSource } from "./skill-picker.js";
import type { AgentComposerControl } from "./use-agent-composer.js";

/** What a chat's messages read of the reader's edit: the message open for writing again, by its id, and the presses that open, close, and save it. */
export interface ChatEdit {
  readonly editing: string | undefined;
  /** What the edit box is drawn with beside the chat's own box. */
  readonly box: ChatEditBox;
  readonly onOpen: (messageId: string) => void;
  readonly onClose: () => void;
  /** Saves the words given in place of the message's, which stood as `was`. */
  readonly onSave: (messageId: string, text: string, was: string) => void;
}

/** `state` with `press` drawn on `agentId`'s chat as the window holds it; the very document where the chat holds no such message or its words stand so already. */
function withChatEdit(
  state: AppStateSnapshot,
  agentId: string,
  press: ManagerChatEditPress,
): AppStateSnapshot {
  const chats = state[LIVE_READ.MANAGER_CHAT];
  const held = chats[agentId];
  const chat = held?.rows;

  if (held === undefined || chat === undefined) return state;
  const messages = withEditPress(chat.messages, press);

  if (messages === chat.messages) return state;

  return {
    ...state,
    [LIVE_READ.MANAGER_CHAT]: { ...chats, [agentId]: { ...held, rows: { ...chat, messages } } },
  };
}

/**
 * The reader's edit of `agentId`'s chat: which message stands open, and its
 * save, drawn at once over the window's document until its ask settles,
 * under a key of its own so a save the host sends again tells the Manager
 * once; one the host or the service refused says so on a toast, and opens
 * the message again on the words that did not go.
 */
export function useChatEdit(box: ChatEditBox): ChatEdit {
  const { agentId } = box;
  const client = useQueryClient();
  const { mutateAsync: edit } = useMutation(pressMutation(ACT_KIND.AGENTS_CHAT_EDIT));
  const [editing, setEditing] = useState<string | undefined>(undefined);

  const onSave = useCallback(
    (messageId: string, typed: string, was: string) => {
      const text = typed.trim();
      setEditing(undefined);

      // Note that words as they stand, or none, change nothing, so the box closes and nothing is asked.
      if (text === "" || text === was) return;
      const { promise: settled, resolve } = Promise.withResolvers<void>();
      drawAhead(
        client,
        (state) => withChatEdit(state, agentId, { messageId, text, editedAt: Date.now() }),
        settled,
      );

      // Note that the host's refusal is said by the mutation's toast, and the service's, which answers rather than fails, here.
      edit({ agentId, messageId, text, clientKey: crypto.randomUUID() }).then(
        (answer) => {
          if ("failure" in answer) {
            showToast({
              words: CHAT_EDIT_WORDS.REFUSED,
              tone: STATUS_TONE.DANGER,
              failure: {
                surface: FAILURE_SURFACE.ACT,
                act: ACT_KIND.AGENTS_CHAT_EDIT,
                cause: answer,
                about: failureAboutOf({ agentId }),
              },
            });
          }

          resolve();
        },
        () => resolve(),
      );
    },
    [agentId, client, edit],
  );

  return useMemo(
    () => ({
      editing,
      box,
      onOpen: setEditing,
      onClose: () => setEditing(undefined),
      onSave,
    }),
    [editing, box, onSave],
  );
}

/** A message's Edit among its actions, which opens its words for writing again where it stands. */
export function EditChatMessageAction({ onEdit }: { onEdit: () => void }): ReactNode {
  return (
    <MessageAction label={REWIND_WORDS.EDIT} tooltip={REWIND_WORDS.EDIT} onClick={onEdit}>
      <GLYPH.RENAME />
    </MessageAction>
  );
}

/** What the edit box is drawn with beside the chat's own box: the Manager, and the words a dictation may say and the skills a `/` offers, as the chat's box reads them. */
export interface ChatEditBox {
  readonly agentId: string;
  readonly keywords?: readonly string[] | undefined;
  readonly skills?: SkillSource | undefined;
}

/** How the edit box words its field and its round button. */
const EDIT_WORDING: ComposerWords = {
  placeholder: REWIND_WORDS.EDIT,
  label: REWIND_WORDS.EDIT,
  send: CHAT_EDIT_WORDS.SAVE,
};

const noop = () => undefined;

/**
 * The message's words open for writing again where it stands, in the box
 * the chat's own box is (`AgentComposer`), its `@` and `/` lists, Dictate,
 * its formatting and paste, and its keys alike, but for files, since an
 * edit writes words alone: Enter saves, and Cancel, or Escape where no list
 * or dictation takes it, closes it. Its draft is its own, kept by the
 * Manager and the message (`composer-drafts.ts`), so a Cancel, an Escape,
 * or a switch away keeps what was written, which Edit opens on again; Save
 * lets it go, and so does writing the words back as they stand.
 */
export function ChatEditField({
  messageId,
  words,
  box,
  onSave,
  onCancel,
}: {
  messageId: string;
  /** The message's words as they stand, which the box opens on. */
  words: string;
  box: ChatEditBox;
  onSave: (text: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const place: EditPlace = { kind: DRAFT_PLACE.EDIT, agentId: box.agentId, messageId };
  const kept = useDraft(place).draft;
  const writer = useDraftWriter();
  // A draft kept from an earlier Edit is what the box opens on.
  const [draft, setDraft] = useState(() => (kept === EMPTY_DRAFT ? words : kept.text));
  const held = useRef(draft);
  held.current = draft;

  // Note that every change lands the one way every box's does, moved on from what the box holds as it lands (`refused-send.ts`), and the draft is let go where the words stand as the message's.
  const updateHeld: HeldUpdate = (next) => {
    const moved = next({ text: held.current, attachments: [] });

    if (moved === undefined) return;
    held.current = moved.text;
    setDraft(moved.text);
    writer.update(place, (was) =>
      moved.text === words ? EMPTY_DRAFT : { ...was, text: moved.text },
    );
  };

  const composer: AgentComposerControl = {
    held: { words: useHandedWords(draft), attachments: [] },
    updateHeld,
    sending: false,
    note: undefined,
    closed: undefined,
    send: () => {
      writer.update(place, () => EMPTY_DRAFT);
      onSave(held.current);
    },
    retry: noop,
    sent: [],
  };

  return (
    <AgentComposer
      agentId={box.agentId}
      // Note that the box's round button saves while it is open, whatever the Manager is doing.
      status={AGENT_STATUS.COMPLETED}
      composer={composer}
      model={undefined}
      models={undefined}
      modelsFailed={false}
      readModels={noop}
      usage={undefined}
      servers={undefined}
      onStop={() => Promise.resolve(false)}
      followsUp
      keywords={box.keywords}
      skills={box.skills}
      takesFiles={false}
      wording={EDIT_WORDING}
      onLeave={onCancel}
      beforeSend={() => (
        <Button variant={BUTTON_VARIANT.QUIET} size={BUTTON_SIZE.COMPACT} onClick={onCancel}>
          <ReplayUnmask>{CHAT_EDIT_WORDS.CANCEL}</ReplayUnmask>
        </Button>
      )}
    />
  );
}
