/**
 * design-b.tsx -- B · Thread inside the agent. The agent is the frame: its
 * head names it, its standing, its model and its ⋯ with Fork, over two tabs,
 * Chat and Threads. An Inbox row lands on the Threads tab with its thread
 * open under the crumbs "Agent › Thread", only that thread's messages in
 * it, over the agent's full composer labeled "Reply on thread". The chat is
 * a tab away, and opens at its newest line.
 */

import {
  AVATAR_SIZE,
  BackButton,
  Breadcrumbs,
  CHOICE_BAR_LOOK,
  ChoiceBar,
  GAP,
  GlyphSlot,
  Inline,
  LAYOUT_ELEMENT,
  LIST_ROW_META,
  List,
  ListRow,
  Stack,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TOOLBAR_LOOK,
  Toolbar,
  UnreadMark,
} from "@repo/ui";
import { GLYPH, ICON_SIZE } from "@repo/ui/icons";
import { useState } from "react";
import { AGENT, ageOf, THREADS, type ThreadId } from "./data";
import type { DesignProps } from "./design-a";
import { FRAME, FrameLayout, InboxList } from "./inbox-list";
import {
  ActivityLine,
  AGENT_FORK,
  AgentFace,
  AgentMenu,
  Answering,
  ChatComposer,
  ChatTranscript,
  DecideBlock,
  ForkNotice,
  REPLY_LOOK,
  ReplyBox,
  ReplyNote,
  StateBadge,
  ThreadMessageCard,
} from "./parts";
import { useWorld } from "./world";

const TAB = {
  CHAT: "chat",
  THREADS: "threads",
} as const;

type Tab = (typeof TAB)[keyof typeof TAB];

const B_PLACE = {
  INBOX: "inbox",
  AGENT: "agent",
} as const;

/** Where design B stands: the Inbox, or the agent on one of its tabs, a thread open on Threads or none. */
type BPlace =
  | { readonly at: typeof B_PLACE.INBOX }
  | { readonly at: typeof B_PLACE.AGENT; readonly tab: Tab; readonly thread: ThreadId | undefined };

export function DesignB({ frame, state }: DesignProps): React.JSX.Element {
  const world = useWorld(state);
  const [place, setPlace] = useState<BPlace>({ at: B_PLACE.INBOX });
  const open = (thread: ThreadId) => {
    world.see(thread);
    setPlace({ at: B_PLACE.AGENT, tab: TAB.THREADS, thread });
  };
  const inbox = () => setPlace({ at: B_PLACE.INBOX });
  const phone = frame === FRAME.PHONE;
  const current = place.at === B_PLACE.AGENT ? place.thread : undefined;

  const agent =
    place.at === B_PLACE.AGENT ? (
      <div className="inbox-proto-column">
        <Toolbar
          look={phone ? TOOLBAR_LOOK.PHONE : TOOLBAR_LOOK.WINDOW}
          lead={phone ? <BackButton label="Inbox" place="Inbox" onBack={inbox} /> : undefined}
          title={AGENT.name}
          actions={<AgentMenu state={state} onFork={() => world.fork(AGENT_FORK)} />}
        />
        <div className="inbox-proto-agent-head">
          <Inline gap={GAP.CONTROL} wrap={false}>
            <AgentFace size={AVATAR_SIZE.CARD} />
            <div className="inbox-proto-grow">
              <Stack gap={GAP.NONE}>
                <Inline gap={GAP.TIGHT}>
                  <StateBadge state={state} />
                  <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.SPAN}>
                    {`${AGENT.model} · ${AGENT.task}`}
                  </Text>
                </Inline>
                <ActivityLine state={state} />
              </Stack>
            </div>
          </Inline>
          <ChoiceBar<Tab>
            label="Agent"
            look={CHOICE_BAR_LOOK.SEGMENTED}
            items={[
              { value: TAB.CHAT, label: "Chat" },
              { value: TAB.THREADS, label: "Threads", count: String(THREADS.length) },
            ]}
            value={place.tab}
            onChange={(tab) =>
              setPlace({
                at: B_PLACE.AGENT,
                tab,
                thread: tab === TAB.THREADS ? place.thread : undefined,
              })
            }
          />
        </div>
        <ForkNotice forked={world.forked} />
        {place.tab === TAB.CHAT ? (
          <>
            <div className="inbox-proto-scroll">
              <ChatTranscript
                items={world.chat}
                state={state}
                forked={world.forked}
                onFork={world.fork}
                onOpenThread={open}
                threadTitle={(id) => world.thread(id).title}
              />
            </div>
            <div className="inbox-proto-foot">
              <ChatComposer
                state={state}
                onSend={world.say}
                onFork={() => world.fork(AGENT_FORK)}
              />
            </div>
          </>
        ) : place.thread === undefined ? (
          <div className="inbox-proto-scroll">
            <List label="Threads">
              {THREADS.map((base) => {
                const thread = world.thread(base.id);
                const last = thread.messages.at(-1);
                return (
                  <ListRow
                    key={thread.id}
                    leading={<UnreadMark unread={!world.seen.has(thread.id)} />}
                    title={thread.title}
                    description={last?.text}
                    meta={ageOf(last?.at ?? thread.openedAt)}
                    metaAt={LIST_ROW_META.TITLE}
                    more={false}
                    onPress={() => open(thread.id)}
                  />
                );
              })}
            </List>
          </div>
        ) : (
          <ThreadOnTab
            id={place.thread}
            world={world}
            state={state}
            onUp={() => setPlace({ at: B_PLACE.AGENT, tab: TAB.THREADS, thread: undefined })}
          />
        )}
      </div>
    ) : null;

  return (
    <FrameLayout
      frame={frame}
      list={<InboxList frame={frame} world={world} current={current} onOpen={open} />}
      detail={agent}
    />
  );
}

/** A thread on the agent's Threads tab: its crumbs, its messages alone, and the agent's full composer. */
function ThreadOnTab({
  id,
  world,
  state,
  onUp,
}: {
  id: ThreadId;
  world: ReturnType<typeof useWorld>;
  state: DesignProps["state"];
  onUp: () => void;
}): React.JSX.Element {
  const thread = world.thread(id);
  return (
    <>
      <div className="inbox-proto-crumbs">
        <Breadcrumbs
          label="Path"
          crumbs={[
            { label: AGENT.name, onPress: onUp },
            { label: thread.title, current: true },
          ]}
        />
      </div>
      <div className="inbox-proto-scroll">
        <div className="inbox-proto-document">
          <Stack gap={GAP.FIELD}>
            <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.FIELD}>
              {thread.messages.map((message) => (
                <ThreadMessageCard
                  key={message.id}
                  message={message}
                  forked={world.forked.has(message.id)}
                  onFork={() => world.fork(message.id)}
                />
              ))}
            </Stack>
            {world.answering(id) ? <Answering /> : null}
            {thread.ask === undefined ? null : (
              <DecideBlock
                ask={thread.ask}
                decided={world.decided(id)}
                onDecide={(label) => world.decide(id, label)}
              />
            )}
          </Stack>
        </div>
      </div>
      <div className="inbox-proto-foot">
        <ReplyBox
          look={REPLY_LOOK.AGENT}
          label={
            <Inline gap={GAP.TIGHT}>
              <GlyphSlot size={ICON_SIZE.MEDIUM}>
                <GLYPH.THREAD />
              </GlyphSlot>
              <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
                {`Reply on thread · ${thread.title}`}
              </Text>
            </Inline>
          }
          placeholder="Reply on thread"
          state={state}
          onSend={(text) => world.reply(id, text)}
          onFork={() => world.fork(AGENT_FORK)}
          under={<ReplyNote state={state} />}
        />
      </div>
    </>
  );
}
