import { calledPicturesOf } from "@repo/features/agent-pictures-model";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import type { KeptPicture } from "@repo/features/conversation-picture-wire";
import { AppWindowStack } from "@repo/ui";
import { PICTURE_STATE } from "@repo/ui/picture-read";
import { MESSAGE_ROLE } from "@repo/wire";
import { type ReactNode, useMemo } from "react";
import { useBusyPress } from "../settings/busy-press.js";
import { AGENT_PART, agentParts } from "./agent-model.js";
import { useKeptPicture, useKeptPictureViewer } from "./agent-pictures.js";
import { computerAppIcon, computerAppName } from "./tool-call-model.js";

/**
 * computer-dock.tsx -- the apps an agent is using on the developer's Mac, floating over the top of its message box while it works in them.
 *
 * While the agent works and has used an app this turn (`computer`), a small
 * stack of the apps' windows floats at the box's top right, over the
 * transcript's foot: the app it used last on top, its newest window at its
 * own shape, its icon and name, the working mark while its newest call is
 * still on that app, and Stop, which stops the turn as the box's own Stop
 * does; every other app it used this turn stands behind as a card's edge
 * (`AppWindowStack`). A press on the window opens the viewer on it, which
 * walks every app's newest window. The stack goes as the turn ends, the
 * transcript's rows being where what it did is read from then on. Where the
 * tab is too narrow to float it, it stands in the docks' column instead
 * (`tasks.css`).
 */

/** What the stack says. */
const WORDS = {
  LABEL: "Apps in use",
} as const;

/** An app the agent used this turn: its name, its icon as a call kept it, and the newest window it read of it. */
export interface UsedApp {
  readonly app: string;
  readonly icon: string | undefined;
  readonly window: KeptPicture | undefined;
}

/** The apps an agent used this turn, the one it used last first, and whether its newest call is still on that one. */
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

/** Every call of the turn under way, the newest first: back to the developer's line that opened it. */
function* turnCallsNewestFirst(messages: readonly AgentTranscriptMessage[]): Generator<ReadCall> {
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const message = messages[at];
    if (message === undefined || message.role === MESSAGE_ROLE.USER) return;
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

/**
 * The apps the agent used this turn while it works, each once, the one it
 * used last first, each with its icon and newest window from the newest of
 * its calls that kept them; nothing while it works in none, or once it is
 * done. A call that names no app, listing them, adds none.
 */
export function appsInUse(
  messages: readonly AgentTranscriptMessage[],
  working: boolean,
): AppsInUse | undefined {
  if (!working) return undefined;
  const found = new Map<string, UsedApp>();
  let newest: ReadCall | undefined;
  for (const call of turnCallsNewestFirst(messages)) {
    newest ??= call;
    const app =
      call.tool === AGENT_TOOL.COMPUTER ? computerAppName(call.input, call.output) : undefined;
    if (app === undefined) continue;
    const held = found.get(app);
    found.set(app, {
      app,
      icon: held?.icon ?? computerAppIcon(call.output),
      window: held?.window ?? keptWindow(call),
    });
  }
  const apps = [...found.values()];
  const top = apps[0];
  if (top === undefined || newest === undefined) return undefined;
  const using =
    newest.tool === AGENT_TOOL.COMPUTER && computerAppName(newest.input, newest.output) === top.app;
  return { apps, using };
}

/** The stack, floating over the box's top right; nothing while the agent uses no app. */
export function ComputerDock({
  messages,
  working,
  onStop,
}: {
  messages: readonly AgentTranscriptMessage[];
  working: boolean;
  /** Stops the agent's turn, answering whether the service took it; none where the reader may not stop it. */
  onStop: (() => Promise<boolean>) | undefined;
}): ReactNode {
  const inUse = useMemo(() => appsInUse(messages, working), [messages, working]);
  const top = inUse?.apps[0];
  const window = useKeptPicture(top?.window?.id);
  const icon = useKeptPicture(top?.icon);
  const { open, viewer } = useKeptPictureViewer();
  const stop = useBusyPress(() => onStop?.());
  if (inUse === undefined || top === undefined) return null;
  const windows = inUse.apps.flatMap((each) =>
    each.window === undefined ? [] : [{ picture: each.window, words: each.app }],
  );
  const shown = top.window;
  return (
    <>
      <AppWindowStack
        label={WORDS.LABEL}
        className="agent-computer-float"
        apps={inUse.apps.map((each, index) =>
          index === 0
            ? {
                name: each.app,
                iconSrc: icon.kind === PICTURE_STATE.READY ? icon.url : undefined,
                window:
                  shown === undefined
                    ? undefined
                    : { state: window, width: shown.width, height: shown.height },
              }
            : { name: each.app },
        )}
        using={inUse.using}
        onOpen={() => {
          if (shown !== undefined) open(windows, shown.id);
        }}
        onStop={onStop === undefined ? undefined : stop.onPress}
        stopping={stop.busy}
      />
      {viewer}
    </>
  );
}
