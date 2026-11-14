import {
  AGENT_PART,
  agentParts,
  type ComputerApp,
  computerAppsOf,
} from "@repo/features/agent-parts";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import { computerCallRefused, computerCursor } from "@repo/features/tool-call-model";
import { ACT_KIND } from "@repo/host/acts";
import { AGENT_POINTER_KIND, AppStackPill, AppWindowStack } from "@repo/ui";
import { PICTURE_STATE } from "@repo/ui/picture-read";
import { MESSAGE_ROLE } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { pressMutation } from "../act-mutations.js";
import { useKeptPicture, useKeptPictures, useKeptPictureViewer } from "./agent-pictures.js";
import { useOnThatMac } from "./computer-permission-note.js";
import { MacAppChipCard } from "./mac-app-card.js";

/**
 * computer-dock.tsx -- the apps an agent is using on the developer's Mac, as a stack of their windows floating over its message box, or minimized to a pill.
 *
 * Once the agent has used an app this turn (`computer`), the apps float over
 * the end of what docks over its box as a stack (`AppWindowStack`): the app
 * it used last in front, by its newest window, the others behind it, each a
 * press that brings it forward, and the working mark on the app its newest
 * call is on. The front's name brings that app's own window forward on the
 * Mac the agent uses (`useOnThatMac`), and hangs the app's card
 * (`MacAppChipCard`): the machine it is on, whether that machine always
 * allows it, and that the agent is in it now; a press on its window opens
 * the viewer, which walks every app's newest window. As the agent moves on to
 * another app, that app comes forward. Where the agent's cursor last stood
 * over the window in front, as its calls this turn said, the agent's
 * pointer stands over the picture at that spot, gliding to each new one and
 * pressing where the agent pressed, until the turn ends; the enlarged
 * viewer draws none, since it is the window held still to be read.
 *
 * Minimize puts the stack down to its pill (`AppStackPill`), which brings it
 * back; put down while the agent works, it stays down for that agent this
 * window's session. Once the agent is done, the stack puts itself down, and
 * its pill stands until the next turn opens, a press bringing the turn's
 * windows back. What stops the turn is the box's own Stop.
 *
 * What floats takes room over the transcript's end, which the stack says to
 * its owner as it comes, changes, and goes (`onRoom`), so the transcript's
 * newest line stands clear of it and its way back to that line stands
 * above it (`Conversation`'s `overEnd`).
 */

/** What the stack is named to a reader. */
const LABEL = "Apps in use";

/** Where the agent's cursor last stood this turn, by the app whose window it stood over, as a share of that window, whether it pressed there, and the call that put it there. */
interface CursorInUse {
  readonly app: string;
  readonly x: number;
  readonly y: number;
  readonly pressed: boolean;
  readonly callId: string;
}

/** The apps an agent used this turn, the one it used last first, each as the conversation names it (`computerAppsOf`), whether its newest call is still on that one while it works, and where its cursor last stood, where a call this turn said. */
export interface AppsInUse {
  readonly apps: readonly ComputerApp[];
  readonly using: boolean;
  readonly cursor?: CursorInUse;
}

/** A call's tool, its id, and its answer, as the stack reads them. */
interface ReadCall {
  readonly tool: string;
  readonly callId: string;
  readonly output: Parameters<typeof computerCallRefused>[0];
}

/**
 * Every call of the turn under way, the newest first: back to the
 * developer's line that opened it. Note that a line the turn took in under
 * way (`arrivedIn`), or one that follows its journal while it is still open,
 * steers that turn rather than opening one, as the transcript places it
 * (`placedMessages`), so the apps used before it stay the turn's; a line
 * after a closed journal opens the next turn, even before it is read back,
 * so the turn before it is never shown as the one under way.
 */
function* turnCallsNewestFirst(messages: readonly AgentTranscriptMessage[]): Generator<ReadCall> {
  const journal = messages.findLastIndex((message) => message.role === MESSAGE_ROLE.ASSISTANT);
  const open = journal >= 0 && messages[journal]?.finishedAt === undefined;

  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const message = messages[at];

    if (message === undefined) return;

    if (message.role === MESSAGE_ROLE.USER) {
      const steers = message.arrivedIn !== undefined || (open && at > journal);

      if (steers) continue;

      return;
    }

    const parts = agentParts(message);

    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index];

      if (part?.kind === AGENT_PART.TOOL) yield part;
    }
  }
}

/**
 * The apps the agent used this turn, each once, the one it used last
 * first, each with its icon and newest window as the conversation names the
 * app (`computerAppsOf`), so a call still running, which names its app only
 * as the agent typed it, counts as the app it turns out to be; none in use
 * once it is done; nothing where the turn used none. A call that names no
 * app, listing them, adds none, nor does one the Mac refused, such as for a
 * grant it lacks, so a refused app never floats a window it never read or
 * says it is in use.
 */
export function appsInUse(
  messages: readonly AgentTranscriptMessage[],
  working: boolean,
): AppsInUse | undefined {
  const named = computerAppsOf(messages);
  const calls = [...turnCallsNewestFirst(messages)];

  const appOf = (call: ReadCall): ComputerApp | undefined =>
    call.tool !== AGENT_TOOL.COMPUTER || computerCallRefused(call.output)
      ? undefined
      : named.byCall.get(call.callId);

  const apps = [...new Set(calls.map(appOf))].filter((app) => app !== undefined);
  const top = apps[0];
  const newest = calls[0];

  if (top === undefined || newest === undefined) return undefined;
  const using = working && appOf(newest) === top;

  // Note that the Mac's cursor is one, so it stands where the newest call that placed it left it, over that call's app alone.
  for (const call of calls) {
    const app = appOf(call);
    const point = app === undefined ? undefined : computerCursor(call.output);

    if (app === undefined || point === undefined) continue;

    return { apps, using, cursor: { app: app.id, ...point, callId: call.callId } };
  }

  return { apps, using };
}

/** Every agent whose stack the reader put down while it worked, this window's session, so it stays down as the tab comes back. */
const STACKS_DOWN = new Set<string>();

/** The app a press names, by its id, from the apps in use. */
function appOfId(apps: readonly ComputerApp[], id: string): ComputerApp | undefined {
  return apps.find((each) => each.id === id);
}

/**
 * The apps in use as a stack floating over the box, or its pill; nothing
 * where the agent's turn used no app. Note that the stack is drawn anew for
 * each turn the agent works (`turn`), so the viewer it opened, and the app
 * the reader brought forward, go with the turn rather than standing into
 * the next.
 */
export function ComputerDock({
  agentId,
  messages,
  working,
  onRoom,
}: {
  agentId: string;
  messages: readonly AgentTranscriptMessage[];
  working: boolean;
  /** Hears the room, in pixels, what floats takes over the transcript's end; none once nothing does. */
  onRoom: (room: number) => void;
}): ReactNode {
  const inUse = useMemo(() => appsInUse(messages, working), [messages, working]);
  const top = inUse?.apps[0];
  // How many turns the agent has started working while the stack stood, which keys the stack.
  const [turn, setTurn] = useState(0);
  const [wasWorking, setWasWorking] = useState(working);

  if (wasWorking !== working) {
    setWasWorking(working);

    if (working) setTurn(turn + 1);
  }

  if (inUse === undefined || top === undefined) return null;

  return (
    <AppsFloat
      key={turn}
      agentId={agentId}
      inUse={inUse}
      top={top}
      working={working}
      onRoom={onRoom}
    />
  );
}

/** Says to `onRoom` how much room the element takes over the transcript's end, its margin under it included, as it changes and once it goes. */
function useRoomTaken(onRoom: (room: number) => void) {
  const float = useRef<HTMLDivElement>(null);
  const said = useRef(onRoom);
  said.current = onRoom;

  useLayoutEffect(() => {
    const element = float.current;

    if (element === null) return;

    const measure = () => {
      const margin = Number.parseFloat(getComputedStyle(element).marginBlockEnd);
      said.current(element.getBoundingClientRect().height + (Number.isFinite(margin) ? margin : 0));
    };

    measure();
    const heard = new ResizeObserver(measure);
    heard.observe(element);

    return () => {
      heard.disconnect();
      said.current(0);
    };
  }, []);

  return float;
}

/** The stack, or its pill, of the apps in use this turn, floating over the box. */
function AppsFloat({
  agentId,
  inUse,
  top,
  working,
  onRoom,
}: {
  agentId: string;
  inUse: AppsInUse;
  top: ComputerApp;
  working: boolean;
  onRoom: (room: number) => void;
}): ReactNode {
  const float = useRoomTaken(onRoom);
  const { open, viewer } = useKeptPictureViewer();
  const onThatMac = useOnThatMac(agentId);
  const { mutate: showApp } = useMutation(pressMutation(ACT_KIND.MAC_APP_SHOW));
  const [putDown, setPutDown] = useState(() => STACKS_DOWN.has(agentId));
  // Note that the stack is drawn anew as the agent works again (`ComputerDock`), so one the reader brought back once it was done stands only until then.
  const [doneOpen, setDoneOpen] = useState(false);
  // Note that an app the reader brought forward stays in front only until the agent moves to another app, even one it moves back from.
  const [picked, setPicked] = useState<string>();
  const [pickedOver, setPickedOver] = useState(top.id);

  if (pickedOver !== top.id) {
    setPickedOver(top.id);
    setPicked(undefined);
  }

  const front = (picked === undefined ? undefined : appOfId(inUse.apps, picked)) ?? top;
  const window = useKeptPicture(front.window?.id);
  const icons = useKeptPictures(inUse.apps.map((each) => each.icon));
  const down = working ? putDown : !doneOpen;
  const using = inUse.using ? top.id : undefined;
  const cursor = inUse.cursor;

  // Note that the pointer shows while the agent works and fades once its turn ends, as the Mac puts its cursor away.
  const pointer =
    cursor === undefined
      ? undefined
      : {
          x: cursor.x,
          y: cursor.y,
          kind: cursor.pressed ? AGENT_POINTER_KIND.CLICK : AGENT_POINTER_KIND.MOVE,
          move: cursor.callId,
          shown: working,
        };

  const apps = inUse.apps.map((each, at) => {
    const icon = icons[at];
    const iconSrc = icon?.kind === PICTURE_STATE.READY ? icon.url : undefined;

    const card = (
      <MacAppChipCard
        name={each.name}
        bundleId={each.bundleId}
        iconSrc={iconSrc}
        machine={each.machine}
        inUse={each.id === using}
      />
    );

    return each === front && front.window !== undefined
      ? {
          id: each.id,
          name: each.name,
          iconSrc,
          card,
          window: {
            state: window,
            width: front.window.width,
            height: front.window.height,
            pointer: cursor?.app === each.id ? pointer : undefined,
          },
        }
      : { id: each.id, name: each.name, iconSrc, card };
  });

  const putAway = () => {
    if (!working) return setDoneOpen(false);
    STACKS_DOWN.add(agentId);
    setPutDown(true);
  };

  const bringBack = () => {
    if (!working) return setDoneOpen(true);
    STACKS_DOWN.delete(agentId);
    setPutDown(false);
  };

  const windows = inUse.apps.flatMap((each) =>
    each.window === undefined ? [] : [{ picture: each.window, words: each.name }],
  );

  return (
    <div className="agent-computer-dock">
      <div ref={float} className="agent-computer-float">
        {down ? (
          <AppStackPill apps={apps} using={using} onRestore={bringBack} />
        ) : (
          <AppWindowStack
            label={LABEL}
            apps={apps}
            shown={front.id}
            using={using}
            onPick={setPicked}
            onMinimize={putAway}
            onOpen={() => {
              // Note that an app in front whose window was never read opens the newest window another app's call kept.
              const first = front.window ?? windows[0]?.picture;

              if (first !== undefined) open(windows, first.id);
            }}
            onShowApp={
              onThatMac === true && front.bundleId !== undefined
                ? (id) => {
                    const bundleId = appOfId(inUse.apps, id)?.bundleId;

                    if (bundleId !== undefined) showApp({ bundleId });
                  }
                : undefined
            }
          />
        )}
      </div>
      {viewer}
    </div>
  );
}
