/**
 * design-d.tsx -- D · Card in the chat, the earlier proposal, with its
 * mitigations. An Inbox row opens the agent's chat narrowed to the thread's
 * card: the card, the member's replies to it and the agent's answers, under
 * a pill saying so. Show everything widens it to the whole chat, standing at
 * the card, which is how a reader judges whether the jump is jarring.
 */

import {
  ALIGN,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  GAP,
  GlyphSlot,
  Inline,
  Stack,
  StaticChip,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { GLYPH, ICON_SIZE } from "@repo/ui/icons";
import { useState } from "react";
import { AGENT, AGENT_STATE, type ThreadId } from "./data";
import { type DesignProps, PaneHead } from "./design-a";
import { FRAME, FrameLayout, InboxList } from "./inbox-list";
import {
  AGENT_FORK,
  AgentMenu,
  AgentStatusStrip,
  Answering,
  ChatTranscript,
  DecideBlock,
  ForkNotice,
  REPLY_LOOK,
  ReplyBox,
  ReplyNote,
} from "./parts";
import { useWorld } from "./world";

/** Where design D stands: the Inbox, or the chat, narrowed to a thread's card or not. */
interface DPlace {
  readonly open: boolean;
  readonly focus: ThreadId | undefined;
  /** The thread the chat was opened from, which Show everything stands at. */
  readonly from: ThreadId | undefined;
}

export function DesignD({ frame, state }: DesignProps): React.JSX.Element {
  const world = useWorld(state);
  const [place, setPlace] = useState<DPlace>({ open: false, focus: undefined, from: undefined });
  const open = (thread: ThreadId) => {
    world.see(thread);
    setPlace({ open: true, focus: thread, from: thread });
  };
  const inbox = () => setPlace({ open: false, focus: undefined, from: undefined });
  const phone = frame === FRAME.PHONE;
  const focus = place.focus;
  const items =
    focus === undefined ? world.chat : world.chat.filter((item) => item.thread === focus);
  const ask = focus === undefined ? undefined : world.thread(focus).ask;
  // Note that the whole chat stands at the card it was opened from, so the jump is the one a reader would meet.
  const cardLine = world.chat.find((item) => item.thread === place.from)?.id;

  const chat = place.open ? (
    <div className="inbox-proto-column">
      <PaneHead
        frame={frame}
        back={phone ? { label: "Inbox", place: "Inbox", onBack: inbox } : undefined}
        title={AGENT.name}
        actions={<AgentMenu state={state} onFork={() => world.fork(AGENT_FORK)} />}
      />
      <ForkNotice forked={world.forked} />
      <div className="inbox-proto-filter">
        <AgentStatusStrip state={state} />
        {focus === undefined ? (
          place.from === undefined ? null : (
            <Inline gap={GAP.TIGHT}>
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
                Showing everything
              </Text>
              <Button
                variant={BUTTON_VARIANT.QUIET}
                size={BUTTON_SIZE.COMPACT}
                onClick={() => setPlace({ ...place, focus: place.from })}
              >
                {`Only ${world.thread(place.from).title}`}
              </Button>
            </Inline>
          )
        ) : (
          <Inline gap={GAP.TIGHT} align={ALIGN.CENTER}>
            <StaticChip look={CHIP_LOOK.PILL}>
              <GlyphSlot size={ICON_SIZE.MEDIUM}>
                <GLYPH.THREAD />
              </GlyphSlot>
              {`Showing: ${world.thread(focus).title}`}
            </StaticChip>
            <Button
              variant={BUTTON_VARIANT.QUIET}
              size={BUTTON_SIZE.COMPACT}
              onClick={() => setPlace({ ...place, focus: undefined })}
            >
              Show everything
            </Button>
          </Inline>
        )}
      </div>
      <div className="inbox-proto-scroll">
        <Stack gap={GAP.FIELD}>
          <ChatTranscript
            items={items}
            state={focus === undefined ? state : AGENT_STATE.IDLE}
            forked={world.forked}
            highlight={focus === undefined ? place.from : undefined}
            scrollTo={focus === undefined ? cardLine : undefined}
            onFork={world.fork}
            onOpenThread={(id) => setPlace({ ...place, focus: id, from: id })}
            threadTitle={(id) => world.thread(id).title}
          />
          {focus === undefined ? null : (
            <div className="inbox-proto-document">
              <Stack gap={GAP.FIELD}>
                {world.answering(focus) ? <Answering /> : null}
                {ask === undefined ? null : (
                  <DecideBlock
                    ask={ask}
                    decided={world.decided(focus)}
                    onDecide={(label) => world.decide(focus, label)}
                  />
                )}
              </Stack>
            </div>
          )}
        </Stack>
      </div>
      <div className="inbox-proto-foot">
        <ReplyBox
          look={REPLY_LOOK.AGENT}
          label={
            focus === undefined ? null : (
              <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
                {`Replying to ${world.thread(focus).title}`}
              </Text>
            )
          }
          placeholder={focus === undefined ? "Send a follow-up" : "Reply to this card"}
          state={state}
          onSend={(text) => (focus === undefined ? world.say(text) : world.reply(focus, text))}
          onFork={() => world.fork(AGENT_FORK)}
          under={<ReplyNote state={state} />}
        />
      </div>
    </div>
  ) : null;

  return (
    <FrameLayout
      frame={frame}
      list={<InboxList frame={frame} world={world} current={place.from} onOpen={open} />}
      detail={chat}
    />
  );
}
