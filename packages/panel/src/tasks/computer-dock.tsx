import { AGENT_PART, agentParts } from "@repo/features/agent-parts";
import { calledPicturesOf } from "@repo/features/agent-pictures-model";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import type { KeptPicture } from "@repo/features/conversation-picture-wire";
import { computerAppIcon, computerAppName } from "@repo/features/tool-call-model";
import {
  APP_ICON_SIZE,
  AppIcon,
  AppWindowStack,
  CollapseIcon,
  ExpandIcon,
  GAP,
  IconButton,
  Inline,
  LIST_VARIANT,
  List,
  ListRow,
  StopIcon,
  WorkingMark,
} from "@repo/ui";
import { rejectionWords, useAsyncAction } from "@repo/ui/use-async-action";
import { MESSAGE_ROLE } from "@repo/wire";
import { type ReactNode, useMemo, useState } from "react";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";
import { KeptAppIcon, useKeptPicture, useKeptPictureViewer } from "./agent-pictures.js";

/**
 * computer-dock.tsx -- the apps an agent is using on the developer's Mac, as a dock's row over its message box with their windows floating above it, while it works in them.
 *
 * While the agent works and has used an app this turn (`computer`), a row
 * docks over the box as the pull request's and the Inbox's do: the app it
 * used last by its icon, "Using" and its name while its newest call is still
 * on that app, the working mark, how many other apps it used, a press that
 * hides or shows their windows, and Stop, which stops the turn as the box's
 * own Stop does. Over the row's end float the apps' windows
 * (`AppWindowStack`): the app used last on top at its own shape, every other
 * app behind it as a card's edge; a press on the window opens the viewer,
 * which walks every app's newest window. While they float the transcript's
 * end makes room for them (`tasks.css`), so its newest lines stand clear.
 * Put away, they stay down for that agent this window's session. The row
 * goes as the turn ends, the transcript's rows being where what it did is
 * read from then on.
 */

/** What the stack says. */
const WORDS = {
  LABEL: "Apps in use",
  USING: "Using",
  SHOW: "Show the apps' windows",
  HIDE: "Hide the apps' windows",
  STOP: "Stop",
  STOPPING: "Stopping",
} as const;

/** How many other apps the agent used this turn, in words. */
function othersWords(count: number): string {
  return count === 1 ? "+1 app" : `+${String(count)} apps`;
}

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

/** Every agent whose windows the reader put away this window's session, so its stack stays down as the tab comes back. */
const WINDOWS_HIDDEN = new Set<string>();

/** The apps in use as a dock's row, their windows floating over it; nothing while the agent uses no app. */
export function ComputerDock({
  agentId,
  messages,
  working,
  onStop,
}: {
  agentId: string;
  messages: readonly AgentTranscriptMessage[];
  working: boolean;
  /** Stops the agent's turn, answering whether the service took it; none where the reader may not stop it. */
  onStop: (() => Promise<boolean>) | undefined;
}): ReactNode {
  const inUse = useMemo(() => appsInUse(messages, working), [messages, working]);
  const top = inUse?.apps[0];
  const window = useKeptPicture(top?.window?.id);
  const { open, viewer } = useKeptPictureViewer();
  const stop = useAsyncAction(rejectionWords);
  const [hidden, setHidden] = useState(() => WINDOWS_HIDDEN.has(agentId));
  if (inUse === undefined || top === undefined) return null;
  const windows = inUse.apps.flatMap((each) =>
    each.window === undefined ? [] : [{ picture: each.window, words: each.app }],
  );
  const shown = top.window;
  const others = inUse.apps.length - 1;
  const toggle = () => {
    if (hidden) WINDOWS_HIDDEN.delete(agentId);
    else WINDOWS_HIDDEN.add(agentId);
    setHidden(!hidden);
  };
  return (
    <div className={`agent-computer-dock ${COMPOSER_DOCK_CLASS}`}>
      {hidden ? null : (
        <AppWindowStack
          label={WORDS.LABEL}
          className="agent-computer-float"
          apps={inUse.apps.map((each, index) =>
            index === 0 && shown !== undefined
              ? {
                  name: each.app,
                  window: { state: window, width: shown.width, height: shown.height },
                }
              : { name: each.app },
          )}
          onOpen={() => {
            if (shown !== undefined) open(windows, shown.id);
          }}
        />
      )}
      <List label={WORDS.LABEL} variant={LIST_VARIANT.CARD} fingerTall>
        <ListRow
          leading={
            top.icon === undefined ? (
              <AppIcon size={APP_ICON_SIZE.LEAD} />
            ) : (
              <KeptAppIcon id={top.icon} size={APP_ICON_SIZE.LEAD} />
            )
          }
          title={inUse.using ? `${WORDS.USING} ${top.app}` : top.app}
          meta={
            <Inline gap={GAP.TIGHT} wrap={false}>
              {inUse.using ? <WorkingMark /> : null}
              {others === 0 ? null : othersWords(others)}
            </Inline>
          }
          actions={
            <>
              <IconButton
                icon={hidden ? <ExpandIcon /> : <CollapseIcon />}
                label={hidden ? WORDS.SHOW : WORDS.HIDE}
                onClick={toggle}
              />
              {onStop === undefined ? null : (
                <IconButton
                  icon={<StopIcon />}
                  label={WORDS.STOP}
                  busy={stop.running}
                  busyLabel={WORDS.STOPPING}
                  onClick={() =>
                    void stop.run(async () => {
                      await onStop();
                    })
                  }
                />
              )}
            </>
          }
        />
      </List>
      {viewer}
    </div>
  );
}
