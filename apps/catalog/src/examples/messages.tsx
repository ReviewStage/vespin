/**
 * messages.tsx -- a chat's bubbles in runs, and a turn of a conversation, the line over a received one naming who sent it and what they did, and the line under every one: when, then its actions, or, where a sent one did not go, Not delivered before when and a red alert beside it, flush with an agent's words where they stand on no bubble, the actions hidden until the pointer rests on the turn or the keyboard is on one of them, and on a touch screen shown by a tap on the turn.
 */

import { MANAGER_FACE_CHARACTER, MANAGER_FACE_COLOR } from "@repo/features/manager-face";
import {
  AVATAR_SIZE,
  Avatar,
  BUTTON_SIZE,
  CHAT_RUN,
  CHAT_SIDE,
  ChatAside,
  ChatBubble,
  CopyIcon,
  chatRunOf,
  HeldMessageAction,
  IconButton,
  INLINE_REF_LOOK,
  InlineRef,
  MESSAGE_LINE_ALIGN,
  MESSAGE_LINE_INSET,
  MessageActions,
  MessageFailedMark,
  MessageFrame,
  MessageHead,
  MessageLine,
  RetryIcon,
  SUBJECT_FIT,
  SubjectLine,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { MANAGER_FACE_SIZE, ManagerFace } from "@repo/ui/manager-face";
import { CATALOG_FAILURE } from "../catalog-failure";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/** The other side's face beside its run, as a Manager's chat stands it: beside the run's last bubble, its room kept beside the others. */
const MANAGER_AVATAR = (
  <ManagerFace
    face={{ character: MANAGER_FACE_CHARACTER.GHOST, color: MANAGER_FACE_COLOR.PURPLE }}
    size={MANAGER_FACE_SIZE.MESSAGE}
  />
);

/** Oct 14, 2026, 3:42 PM, on the viewer's own clock. */
const SENT_AT = new Date(2026, 9, 14, 15, 42).getTime();

/** A sender as the transcript names one: their face and name, one wash target. */
const ADA = (
  <InlineRef
    look={INLINE_REF_LOOK.WASH}
    glyph={<Avatar name="Ada Lovelace" size={AVATAR_SIZE.INLINE} decorative />}
    label="Ada Lovelace"
    onPress={() => {}}
  />
);

/** One sender's run of short messages, as a chat stands them together. */
const RUN = ["Merged this morning.", "It's behind the Invites flag.", "Turning it on Monday."];

/** A turn's Copy, drawn once the turn's first frame has painted or the pointer comes onto it, a box of its size standing in until then. */
const COPY = (
  <MessageActions>
    <HeldMessageAction>
      <IconButton icon={<CopyIcon />} label="Copy" size={BUTTON_SIZE.COMPACT} onClick={() => {}} />
    </HeldMessageAction>
  </MessageActions>
);

function Messages(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="message-sent" title="A sent message's line, at the column's right">
        <div className="catalog-frame">
          <MessageFrame revealActionsOnTap>
            <Text>Rerunning the spec on WebKit.</Text>
            <MessageLine sender="Dean" at={SENT_AT} actions={COPY} />
          </MessageFrame>
        </div>
      </CatalogSection>
      <CatalogSection id="message-received" title="A received message's line, at the column's left">
        <div className="catalog-frame">
          <MessageFrame revealActionsOnTap>
            <Text>Which browser is it failing on?</Text>
            <MessageLine
              align={MESSAGE_LINE_ALIGN.START}
              sender="Ada"
              at={SENT_AT}
              actions={COPY}
            />
          </MessageFrame>
        </div>
      </CatalogSection>
      <CatalogSection
        id="message-head"
        title="A received message names its sender over it, the time and actions under it"
      >
        <div className="catalog-frame">
          <MessageFrame revealActionsOnTap>
            <MessageHead sender="Ada" />
            <Text>Which browser is it failing on?</Text>
            <MessageLine align={MESSAGE_LINE_ALIGN.START} at={SENT_AT} actions={COPY} />
          </MessageFrame>
        </div>
      </CatalogSection>
      <CatalogSection
        id="message-head-thread"
        title="A received thread line names its sender, then what they did on the thread"
      >
        <div className="catalog-frame">
          <MessageFrame revealActionsOnTap>
            <MessageHead sender={ADA}>
              <SubjectLine lead="answered" fit={SUBJECT_FIT.OWN}>
                <InlineRef
                  look={INLINE_REF_LOOK.PILL}
                  label="Expire an invitation after a week?"
                  onPress={() => {}}
                />
              </SubjectLine>
            </MessageHead>
            <Text>Yes, a week.</Text>
            <MessageLine align={MESSAGE_LINE_ALIGN.START} at={SENT_AT} actions={COPY} />
          </MessageFrame>
        </div>
      </CatalogSection>
      <CatalogSection
        id="message-flush"
        title="An agent's turn, its words on no bubble, leads its line flush with them"
      >
        <div className="catalog-frame">
          <MessageFrame revealActionsOnTap>
            <Text>The spec passes on WebKit now.</Text>
            <MessageLine
              align={MESSAGE_LINE_ALIGN.START}
              inset={MESSAGE_LINE_INSET.FLUSH}
              sender="Worked for 2m 29s · Today, 3:42 PM"
              actions={COPY}
            />
          </MessageFrame>
        </div>
      </CatalogSection>
      <CatalogSection
        id="message-not-delivered"
        title="A sent message that did not go: the red alert beside it, its menu saying why, and Not delivered leading its time"
      >
        <div className="catalog-frame">
          <MessageFrame revealActionsOnTap>
            <div className="flex items-center justify-end gap-tight-gap">
              <Text>Rebase on main and fix the lint errors.</Text>
              <MessageFailedMark
                label="Not delivered"
                reason="No answer came back."
                groups={[[{ label: "Retry", icon: <RetryIcon />, onSelect: () => {} }]]}
                failure={CATALOG_FAILURE}
              />
            </div>
            <MessageLine status="Not delivered" at={SENT_AT} />
          </MessageFrame>
        </div>
      </CatalogSection>
      <CatalogSection id="message-own" title="The reader's own line names no one">
        <div className="catalog-frame">
          <MessageFrame revealActionsOnTap>
            <Text>Looks good, merging.</Text>
            <MessageLine at={SENT_AT} actions={COPY} />
          </MessageFrame>
        </div>
      </CatalogSection>
      <CatalogSection
        id="chat-bubbles"
        title="A chat's bubbles: the reader's at the right, the other side's at the left under its name and beside its face, what stands with a message outside its bubble at the bubble's inset, one sender's run close, its corners tightened, one time under its last, and a reply opening on the words it answers"
      >
        <div className="catalog-frame">
          <div className="flex flex-col gap-ui-4">
            <MessageFrame revealActionsOnTap className="ml-auto flex flex-col items-end">
              <ChatBubble side={CHAT_SIDE.SENT} run={CHAT_RUN.ALONE} beside={COPY}>
                <Text>Is the invite flow out?</Text>
              </ChatBubble>
              <MessageLine at={SENT_AT} />
            </MessageFrame>
            {RUN.map((words, index) => (
              <MessageFrame
                key={words}
                revealActionsOnTap
                className="mr-auto flex flex-col items-start"
              >
                {index === 0 ? (
                  <MessageHead inset={MESSAGE_LINE_INSET.AVATAR} sender="Iris" />
                ) : null}
                {index === 0 ? (
                  <ChatAside inset={MESSAGE_LINE_INSET.AVATAR}>
                    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                      Thought: Ada asked whether it is out.
                    </Text>
                  </ChatAside>
                ) : null}
                <ChatBubble
                  side={CHAT_SIDE.RECEIVED}
                  run={chatRunOf(index === 0, index === RUN.length - 1)}
                  avatar={MANAGER_AVATAR}
                  beside={COPY}
                >
                  <Text>{words}</Text>
                </ChatBubble>
                {index === RUN.length - 1 ? (
                  <MessageLine
                    align={MESSAGE_LINE_ALIGN.START}
                    inset={MESSAGE_LINE_INSET.AVATAR}
                    at={SENT_AT}
                  />
                ) : null}
              </MessageFrame>
            ))}
            <MessageFrame revealActionsOnTap className="ml-auto flex flex-col items-end">
              <ChatBubble
                side={CHAT_SIDE.SENT}
                run={CHAT_RUN.ALONE}
                beside={COPY}
                quote={{
                  words: RUN[RUN.length - 1] ?? "",
                  label: "Show the message this answers",
                  onPress: () => {},
                }}
              >
                <Text>Can it go out Friday instead?</Text>
              </ChatBubble>
              <MessageLine at={SENT_AT} />
            </MessageFrame>
          </div>
        </div>
      </CatalogSection>
    </>
  );
}

export const MESSAGES_EXAMPLE: Example = {
  id: "messages",
  title: "Messages",
  Render: Messages,
};
