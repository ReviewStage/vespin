/**
 * design-a.tsx -- A · Thread as a ticket. The thread reads as a document,
 * as an issue or an email does: a subject over it, the agent's standing in a
 * strip under the subject, the messages as comment cards, the ask as a block
 * of its own, and a box that says it replies on this thread, its words also
 * sent to the agent's chat. No model picker: that is the chat's.
 */

import {
  BackButton,
  GAP,
  LAYOUT_ELEMENT,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TOOLBAR_LOOK,
  Toolbar,
} from "@repo/ui";
import type { ReactNode } from "react";
import { useState } from "react";
import { AGENT, type AgentState, momentOf, type ThreadId } from "./data";
import { FRAME, type Frame, FrameLayout, InboxList } from "./inbox-list";
import {
  AGENT_FORK,
  AgentMenu,
  AgentStatusStrip,
  Answering,
  ChatComposer,
  ChatTranscript,
  DecideBlock,
  ForkNotice,
  REPLY_LOOK,
  ReplyBox,
  ReplyNote,
  ThreadMessageCard,
} from "./parts";
import { useWorld, type World } from "./world";

/** Where a design stands: the Inbox, a thread, or the agent's chat, reached from a thread or not. */
export const PLACE = {
  INBOX: "inbox",
  THREAD: "thread",
  CHAT: "chat",
} as const;

export type Place =
  | { readonly at: typeof PLACE.INBOX }
  | { readonly at: typeof PLACE.THREAD; readonly thread: ThreadId }
  | { readonly at: typeof PLACE.CHAT; readonly from: ThreadId | undefined };

export interface DesignProps {
  readonly frame: Frame;
  readonly state: AgentState;
}

/** A pane's head: Back where the frame has somewhere to go back to, the title, and its ⋯. */
export function PaneHead({
  frame,
  back,
  title,
  actions,
}: {
  frame: Frame;
  back: { label: string; place: string; onBack: () => void } | undefined;
  title: ReactNode;
  actions?: ReactNode;
}): React.JSX.Element {
  return (
    <Toolbar
      look={frame === FRAME.PHONE ? TOOLBAR_LOOK.PHONE : TOOLBAR_LOOK.WINDOW}
      lead={
        back === undefined ? undefined : (
          <BackButton label={back.label} place={back.place} onBack={back.onBack} />
        )
      }
      title={title}
      actions={actions}
    />
  );
}

/** The agent's chat as a place of its own, opened at its newest line, Back leading to the thread it was opened from. */
export function ChatPlace({
  frame,
  state,
  world,
  from,
  onBack,
  onOpenThread,
}: {
  frame: Frame;
  state: AgentState;
  world: World;
  from: ThreadId | undefined;
  onBack: () => void;
  onOpenThread: (id: ThreadId) => void;
}): React.JSX.Element {
  const back =
    from === undefined
      ? { label: "Inbox", place: "Inbox", onBack }
      : { label: world.thread(from).title, place: "the thread", onBack };
  return (
    <div className="inbox-proto-column">
      <PaneHead
        frame={frame}
        back={back}
        title={AGENT.name}
        actions={<AgentMenu state={state} onFork={() => world.fork(AGENT_FORK)} />}
      />
      <ForkNotice forked={world.forked} />
      <div className="inbox-proto-scroll">
        <ChatTranscript
          items={world.chat}
          state={state}
          forked={world.forked}
          onFork={world.fork}
          onOpenThread={onOpenThread}
          threadTitle={(id) => world.thread(id).title}
        />
      </div>
      <div className="inbox-proto-foot">
        <ChatComposer state={state} onSend={world.say} onFork={() => world.fork(AGENT_FORK)} />
      </div>
    </div>
  );
}

/** A thread as a ticket: subject, strip, comment cards, the ask block, and the box. */
export function TicketThread({
  frame,
  state,
  world,
  id,
  onBack,
  onOpenChat,
  between,
  dock,
}: {
  frame: Frame;
  state: AgentState;
  world: World;
  id: ThreadId;
  onBack: () => void;
  onOpenChat: () => void;
  /** What stands between the strip and the messages: design C's peek. */
  between?: ReactNode;
  /** What stands over the reply box: design C's peek on a phone. */
  dock?: ReactNode;
}): React.JSX.Element {
  const thread = world.thread(id);
  const decided = world.decided(id);
  return (
    <div className="inbox-proto-column">
      <PaneHead
        frame={frame}
        back={frame === FRAME.PHONE ? { label: "Inbox", place: "Inbox", onBack } : undefined}
        title="Thread"
        actions={<AgentMenu state={state} onFork={() => world.fork(AGENT_FORK)} />}
      />
      <ForkNotice forked={world.forked} />
      <div className="inbox-proto-scroll">
        <div className="inbox-proto-document">
          <Stack gap={GAP.BLOCK}>
            <Stack gap={GAP.TIGHT}>
              <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H1}>
                {thread.title}
              </Text>
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {`Thread from ${AGENT.name} · ${AGENT.task} · opened ${momentOf(thread.openedAt)}`}
              </Text>
            </Stack>
            <AgentStatusStrip state={state} onOpenChat={onOpenChat} />
            {between}
            <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.FIELD}>
              {thread.messages.map((message) => (
                <ThreadMessageCard
                  key={message.id}
                  message={message}
                  forked={world.forked.has(message.id)}
                  onFork={() => world.fork(message.id)}
                  onOpenChat={onOpenChat}
                />
              ))}
            </Stack>
            {world.answering(id) ? <Answering /> : null}
            {thread.ask === undefined ? null : (
              <DecideBlock
                ask={thread.ask}
                decided={decided}
                onDecide={(label) => world.decide(id, label)}
              />
            )}
          </Stack>
        </div>
      </div>
      {dock}
      <div className="inbox-proto-foot">
        <ReplyBox
          look={REPLY_LOOK.THREAD}
          label={
            <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
              Reply on this thread
            </Text>
          }
          placeholder="Reply on this thread"
          state={state}
          onSend={(text) => world.reply(id, text)}
          under={
            <Stack gap={GAP.NONE}>
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {`Also sent to ${AGENT.name}’s chat.`}
              </Text>
              <ReplyNote state={state} />
            </Stack>
          }
        />
      </div>
    </div>
  );
}

/** A design's place and the moves between them, the thread opened marked seen. */
export function usePlace(world: World) {
  const [place, setPlace] = useState<Place>({ at: PLACE.INBOX });
  const open = (thread: ThreadId) => {
    world.see(thread);
    setPlace({ at: PLACE.THREAD, thread });
  };
  return { place, setPlace, open };
}

export function DesignA({ frame, state }: DesignProps): React.JSX.Element {
  const world = useWorld(state);
  const { place, setPlace, open } = usePlace(world);
  const inbox = () => setPlace({ at: PLACE.INBOX });
  const current =
    place.at === PLACE.THREAD ? place.thread : place.at === PLACE.CHAT ? place.from : undefined;
  const detail =
    place.at === PLACE.THREAD ? (
      <TicketThread
        frame={frame}
        state={state}
        world={world}
        id={place.thread}
        onBack={inbox}
        onOpenChat={() => setPlace({ at: PLACE.CHAT, from: place.thread })}
      />
    ) : place.at === PLACE.CHAT ? (
      <ChatPlace
        frame={frame}
        state={state}
        world={world}
        from={place.from}
        onBack={() => (place.from === undefined ? inbox() : open(place.from))}
        onOpenThread={open}
      />
    ) : null;
  return (
    <FrameLayout
      frame={frame}
      list={<InboxList frame={frame} world={world} current={current} onOpen={open} />}
      detail={detail}
    />
  );
}
