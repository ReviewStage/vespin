import { AGENT_PART, agentParts } from "@repo/features/agent-parts";
import { calledPicturesOf } from "@repo/features/agent-pictures-model";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import type { KeptPicture } from "@repo/features/conversation-picture-wire";
import {
  computerAppBundleId,
  computerAppIcon,
  computerAppName,
  computerCallRefused,
} from "@repo/features/tool-call-model";
import { ACT_KIND } from "@repo/host/acts";
import { AppStackPill, AppWindowStack } from "@repo/ui";
import { PICTURE_STATE } from "@repo/ui/picture-read";
import { MESSAGE_ROLE } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { pressMutation } from "../act-mutations.js";
import { useKeptPicture, useKeptPictures, useKeptPictureViewer } from "./agent-pictures.js";
import { useOnThatMac } from "./computer-permission-note.js";

/**
 * computer-dock.tsx -- the apps an agent is using on the developer's Mac, as a stack of their windows floating over its message box, or minimized to a pill.
 *
 * Once the agent has used an app this turn (`computer`), the apps float over
 * the end of what docks over its box as a stack (`AppWindowStack`): the app
 * it used last in front, by its newest window, the others behind it, each a
 * press that brings it forward, and the working mark on the app its newest
 * call is on. The front's name brings that app's own window forward on the
 * Mac the agent uses (`useOnThatMac`), and a press on its window opens the
 * viewer, which walks every app's newest window. As the agent moves on to
 * another app, that app comes forward.
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

/** An app the agent used this turn: its name, its bundle id and icon as a call answered them, and the newest window it read of it. */
export interface UsedApp {
  readonly app: string;
  readonly bundleId: string | undefined;
  readonly icon: string | undefined;
  readonly window: KeptPicture | undefined;
}

/** The apps an agent used this turn, the one it used last first, and whether its newest call is still on that one while it works. */
export interface AppsInUse {
  readonly apps: readonly UsedApp[];
  readonly using: boolean;
}

/** A call's tool, input, and answer, as the stack reads them. */
interface ReadCall {
  readonly tool: string;
  readonly input: Parameters<typeof computerAppName>[0];
  readonly output: Parameters<typeof computerAppName>[1];
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

/** The window a computer call kept, where it read one. */
function keptWindow(call: ReadCall): KeptPicture | undefined {
  const [called] = calledPicturesOf(call.tool, call.input, call.output);

  return called?.kept === true ? called.picture : undefined;
}

/** The app a call used, by its name: none for a call that is no computer call, names no app, as listing them does, or that the Mac refused, which used none. */
function usedApp(call: ReadCall): string | undefined {
  if (call.tool !== AGENT_TOOL.COMPUTER || computerCallRefused(call.output)) return undefined;

  return computerAppName(call.input, call.output);
}

/**
 * The name each app came to, by the spelling a call asked for it in and by
 * the name the Mac answered, each folded to lower case, read off the calls
 * the Mac answered, so a call still running, which names its app only as
 * the agent spelled it, counts as the app it will turn out to be.
 */
function answeredNames(calls: readonly ReadCall[]): ReadonlyMap<string, string> {
  const names = new Map<string, string>();

  for (const call of calls) {
    const answered = computerAppName(undefined, call.output);

    if (call.tool !== AGENT_TOOL.COMPUTER || answered === undefined) continue;
    names.set(answered.toLowerCase(), answered);
    const asked = computerAppName(call.input, undefined);

    if (asked !== undefined) names.set(asked.toLowerCase(), answered);
  }

  return names;
}

/**
 * The apps the agent used this turn, each once, the one it used last
 * first, each with its icon and newest window from the newest of its calls
 * that kept them; none in use once it is done; nothing where the turn used
 * none. A call that names no app, listing them, adds none, nor does one the
 * Mac refused, such as for a grant it lacks, so a refused app never floats
 * a window it never read or says it is in use.
 */
export function appsInUse(
  messages: readonly AgentTranscriptMessage[],
  working: boolean,
): AppsInUse | undefined {
  const calls = [...turnCallsNewestFirst(messages)];
  const names = answeredNames(calls);

  const appOf = (call: ReadCall): string | undefined => {
    const app = usedApp(call);

    return app === undefined || call.output !== undefined
      ? app
      : (names.get(app.toLowerCase()) ?? app);
  };

  const found = new Map<string, UsedApp>();
  const newest = calls[0];

  for (const call of calls) {
    const app = appOf(call);

    if (app === undefined) continue;
    const held = found.get(app);
    found.set(app, {
      app,
      bundleId: held?.bundleId ?? computerAppBundleId(call.output),
      icon: held?.icon ?? computerAppIcon(call.output),
      window: held?.window ?? keptWindow(call),
    });
  }

  const apps = [...found.values()];
  const top = apps[0];

  if (top === undefined || newest === undefined) return undefined;
  const using = working && appOf(newest) === top.app;

  return { apps, using };
}

/** Every agent whose stack the reader put down while it worked, this window's session, so it stays down as the tab comes back. */
const STACKS_DOWN = new Set<string>();

/** The app a press names, by its name, from the apps in use. */
function appNamed(apps: readonly UsedApp[], name: string): UsedApp | undefined {
  return apps.find((each) => each.app === name);
}

/**
 * The apps in use as a stack floating over the box, or its pill; nothing
 * where the agent's turn used no app. Note that the stack is its own
 * component, so the viewer it opened goes with it as the turn ends rather
 * than standing open into the next.
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

  if (inUse === undefined || top === undefined) return null;

  return <AppsFloat agentId={agentId} inUse={inUse} top={top} working={working} onRoom={onRoom} />;
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
  top: UsedApp;
  working: boolean;
  onRoom: (room: number) => void;
}): ReactNode {
  const float = useRoomTaken(onRoom);
  const { open, viewer } = useKeptPictureViewer();
  const onThatMac = useOnThatMac(agentId);
  const { mutate: showApp } = useMutation(pressMutation(ACT_KIND.MAC_APP_SHOW));
  const [putDown, setPutDown] = useState(() => STACKS_DOWN.has(agentId));
  // Note that the stack the reader brought back once the agent was done stands only until the agent works again.
  const [doneOpen, setDoneOpen] = useState(false);
  const [wasWorking, setWasWorking] = useState(working);

  if (wasWorking !== working) {
    setWasWorking(working);
    setDoneOpen(false);
  }

  // Note that an app the reader brought forward stays in front only while the agent stays in the app it was in then.
  const [picked, setPicked] = useState<{ readonly top: string; readonly app: string }>();
  const front = (picked?.top === top.app ? appNamed(inUse.apps, picked.app) : undefined) ?? top;
  const window = useKeptPicture(front.window?.id);
  const icons = useKeptPictures(inUse.apps.map((each) => each.icon));
  const down = working ? putDown : !doneOpen;
  const using = inUse.using ? top.app : undefined;

  const apps = inUse.apps.map((each, at) => {
    const icon = icons[at];
    const iconSrc = icon?.kind === PICTURE_STATE.READY ? icon.url : undefined;

    return each === front && front.window !== undefined
      ? {
          name: each.app,
          iconSrc,
          window: { state: window, width: front.window.width, height: front.window.height },
        }
      : { name: each.app, iconSrc };
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
    each.window === undefined ? [] : [{ picture: each.window, words: each.app }],
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
            shown={front.app}
            using={using}
            onPick={(name) => setPicked({ top: top.app, app: name })}
            onMinimize={putAway}
            onOpen={() => {
              // Note that an app in front whose window was never read opens the newest window another app's call kept.
              const first = front.window ?? windows[0]?.picture;

              if (first !== undefined) open(windows, first.id);
            }}
            onShowApp={
              onThatMac === true && front.bundleId !== undefined
                ? (name) => {
                    const bundleId = appNamed(inUse.apps, name)?.bundleId;

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
