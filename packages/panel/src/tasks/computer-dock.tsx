import { calledPicturesOf } from "@repo/features/agent-pictures-model";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import type { KeptPicture } from "@repo/features/conversation-picture-wire";
import {
  APP_ICON_SIZE,
  AppIcon,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  LIST_VARIANT,
  List,
  ListRow,
} from "@repo/ui";
import { type ReactNode, useMemo } from "react";
import { useBusyPress } from "../settings/busy-press.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";
import { AGENT_PART, agentParts } from "./agent-model.js";
import { KeptAppIcon, KeptWindowThumb } from "./agent-pictures.js";
import { computerAppIcon, computerAppName } from "./tool-call-model.js";

/**
 * computer-dock.tsx -- the app an agent is using on the developer's Mac, docked over its message box while it works in it.
 *
 * While the agent works and its newest call is on an app (`computer`), one
 * row over the box says so: the app by its icon, "Using" and its name, the
 * newest window the agent read of that app as a small thumb that opens it
 * full size, and Stop, which stops the turn as the box's own Stop does. A
 * call that names no app, listing them, draws nothing, and the row goes as
 * the agent calls any other tool or its turn ends, the transcript's rows
 * being where what it did is read from then on.
 */

/** What the dock says. */
const WORDS = {
  LIST: "App in use",
  USING: "Using",
  STOP: "Stop",
  STOPPING: "Stopping",
} as const;

/** The app an agent is using: its name, its icon as a call kept it, and the newest window it read of it. */
export interface AppInUse {
  readonly app: string;
  readonly icon: string | undefined;
  readonly window: KeptPicture | undefined;
}

/** A call's tool, input, and answer, as the dock reads them. */
interface ReadCall {
  readonly tool: string;
  readonly input: Parameters<typeof computerAppName>[0];
  readonly output: Parameters<typeof computerAppName>[1];
}

/** Every call the transcript holds, the newest first. */
function* callsNewestFirst(messages: readonly AgentTranscriptMessage[]): Generator<ReadCall> {
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const message = messages[at];
    const parts = message === undefined ? [] : agentParts(message);
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
 * The app the agent is using: while it works and its newest call is on an
 * app, that app, its icon from the newest of its calls that kept one, and
 * the newest window it read of it; nothing otherwise. Note that the
 * transcript is read only as far back as the newest window of that app.
 */
export function appInUse(
  messages: readonly AgentTranscriptMessage[],
  working: boolean,
): AppInUse | undefined {
  if (!working) return undefined;
  const calls = callsNewestFirst(messages);
  const newest = calls.next();
  if (newest.done === true || newest.value.tool !== AGENT_TOOL.COMPUTER) return undefined;
  const app = computerAppName(newest.value.input, newest.value.output);
  if (app === undefined) return undefined;
  let icon = computerAppIcon(newest.value.output);
  let window = keptWindow(newest.value);
  for (const call of calls) {
    if (window !== undefined && icon !== undefined) break;
    if (call.tool !== AGENT_TOOL.COMPUTER || computerAppName(call.input, call.output) !== app) {
      continue;
    }
    icon ??= computerAppIcon(call.output);
    window ??= keptWindow(call);
  }
  return { app, icon, window };
}

/** The dock: one row naming the app in use, its newest window, and Stop; nothing while the agent uses none. */
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
  const using = useMemo(() => appInUse(messages, working), [messages, working]);
  const stop = useBusyPress(() => onStop?.());
  if (using === undefined) return null;
  const title = `${WORDS.USING} ${using.app}`;
  return (
    <div className={`agent-computer-dock ${COMPOSER_DOCK_CLASS}`}>
      <List label={WORDS.LIST} variant={LIST_VARIANT.CARD} fingerTall>
        <ListRow
          leading={
            using.icon === undefined ? (
              <AppIcon size={APP_ICON_SIZE.LEAD} />
            ) : (
              <KeptAppIcon id={using.icon} size={APP_ICON_SIZE.LEAD} />
            )
          }
          title={title}
          actions={
            <>
              {using.window === undefined ? null : (
                <KeptWindowThumb picture={using.window} words={using.app} />
              )}
              {onStop === undefined ? null : (
                <Button
                  size={BUTTON_SIZE.COMPACT}
                  variant={BUTTON_VARIANT.OUTLINE}
                  busy={stop.busy}
                  busyLabel={WORDS.STOPPING}
                  onClick={stop.onPress}
                >
                  {WORDS.STOP}
                </Button>
              )}
            </>
          }
        />
      </List>
    </div>
  );
}
