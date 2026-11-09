/**
 * design-c.tsx -- C · Thread with a live peek. A's ticket, with a fold
 * under the agent's strip saying what the agent is doing now: its last three
 * steps, live while it works, and Open full chat, which opens the chat at its
 * newest line. On a phone the fold is a dock over the reply box that rises
 * as a sheet inside the screen.
 */

import {
  BUTTON_VARIANT,
  Button,
  CARD_LOOK,
  CARD_PADDING,
  CARD_SHADOW,
  Card,
  DISCLOSURE_LOOK,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  GAP,
  Inline,
  JUSTIFY,
  LAYOUT_ELEMENT,
  LIST_VARIANT,
  List,
  ListRow,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  WorkingMark,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useState } from "react";
import { AGENT, AGENT_STATE, type AgentState, CHAT_KIND, STATE_WORDS } from "./data";
import { ChatPlace, type DesignProps, PLACE, TicketThread, usePlace } from "./design-a";
import { FRAME, FrameLayout, InboxList } from "./inbox-list";
import { LiveRun, useLiveSteps } from "./parts";
import { useWorld, type World } from "./world";

const PEEK_TITLE = `What ${AGENT.name} is doing now`;

/** The last three steps the chat shows, for an agent not working now. */
function lastSteps(world: World): readonly string[] {
  return world.chat
    .filter((item) => item.kind === CHAT_KIND.TURN)
    .flatMap((item) => item.steps ?? [item.text])
    .slice(-3);
}

/** The peek's words: the live run, or the last steps and where the agent stands. */
function PeekBody({
  state,
  world,
  onOpenChat,
}: {
  state: AgentState;
  world: World;
  onOpenChat: () => void;
}): React.JSX.Element {
  return (
    <Stack gap={GAP.CONTROL}>
      {state === AGENT_STATE.WORKING ? (
        <LiveRun />
      ) : (
        <Stack gap={GAP.TIGHT}>
          <Text variant={TEXT_VARIANT.LABEL}>{STATE_WORDS[state].activity}</Text>
          <Stack gap={GAP.NONE} as={LAYOUT_ELEMENT.UL}>
            {lastSteps(world).map((step) => (
              <li key={step}>
                <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                  {step}
                </Text>
              </li>
            ))}
          </Stack>
        </Stack>
      )}
      <Inline justify={JUSTIFY.END}>
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={onOpenChat}>
          Open full chat
        </Button>
      </Inline>
    </Stack>
  );
}

/** The peek on a desktop: a fold under the strip, open while the agent works. */
function PeekFold(props: {
  state: AgentState;
  world: World;
  onOpenChat: () => void;
}): React.JSX.Element {
  return (
    <Disclosure
      look={DISCLOSURE_LOOK.CARD}
      defaultOpen={props.state === AGENT_STATE.WORKING}
      key={props.state}
    >
      <DisclosureSummary>
        <span>{PEEK_TITLE}</span>
      </DisclosureSummary>
      <DisclosureBody>
        <PeekBody {...props} />
      </DisclosureBody>
    </Disclosure>
  );
}

/** The peek on a phone: a dock over the reply box saying the step now, which rises as a sheet in the screen. */
function PeekSheet({
  state,
  world,
  onOpenChat,
}: {
  state: AgentState;
  world: World;
  onOpenChat: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [step] = useLiveSteps(1);
  const now = state === AGENT_STATE.WORKING ? step : STATE_WORDS[state].activity;
  return (
    <>
      <div className="inbox-proto-dock">
        <List label="Agent" variant={LIST_VARIANT.CARD} fingerTall>
          <ListRow
            leading={state === AGENT_STATE.WORKING ? <WorkingMark /> : <GLYPH.AGENT />}
            title={PEEK_TITLE}
            description={now}
            chevron
            more={false}
            onPress={() => setOpen(true)}
          />
        </List>
      </div>
      <div className="inbox-proto-sheet" data-open={open ? "true" : "false"} inert={!open}>
        <div className="inbox-proto-scrim" />
        <div className="inbox-proto-sheet-card">
          <Card look={CARD_LOOK.RAISED} padding={CARD_PADDING.REGULAR} shadow={CARD_SHADOW.MENU}>
            <Stack gap={GAP.FIELD}>
              <Inline justify={JUSTIFY.BETWEEN} wrap={false}>
                <Text variant={TEXT_VARIANT.LABEL}>{PEEK_TITLE}</Text>
                <Button variant={BUTTON_VARIANT.QUIET} onClick={() => setOpen(false)}>
                  Done
                </Button>
              </Inline>
              <PeekBody state={state} world={world} onOpenChat={onOpenChat} />
            </Stack>
          </Card>
        </div>
      </div>
    </>
  );
}

export function DesignC({ frame, state }: DesignProps): React.JSX.Element {
  const world = useWorld(state);
  const { place, setPlace, open } = usePlace(world);
  const inbox = () => setPlace({ at: PLACE.INBOX });
  const current =
    place.at === PLACE.THREAD ? place.thread : place.at === PLACE.CHAT ? place.from : undefined;
  const phone = frame === FRAME.PHONE;
  const detail =
    place.at === PLACE.THREAD ? (
      <TicketThread
        frame={frame}
        state={state}
        world={world}
        id={place.thread}
        onBack={inbox}
        onOpenChat={() => setPlace({ at: PLACE.CHAT, from: place.thread })}
        between={
          phone ? null : (
            <PeekFold
              state={state}
              world={world}
              onOpenChat={() => setPlace({ at: PLACE.CHAT, from: place.thread })}
            />
          )
        }
        dock={
          phone ? (
            <PeekSheet
              state={state}
              world={world}
              onOpenChat={() => setPlace({ at: PLACE.CHAT, from: place.thread })}
            />
          ) : null
        }
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
