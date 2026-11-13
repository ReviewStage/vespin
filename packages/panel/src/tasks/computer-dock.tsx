import { AGENT_PART, agentParts } from "@repo/features/agent-parts";
import { calledPicturesOf } from "@repo/features/agent-pictures-model";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import type { KeptPicture } from "@repo/features/conversation-picture-wire";
import {
  computerAppIcon,
  computerAppName,
  computerCallRefused,
} from "@repo/features/tool-call-model";
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
 * The apps the agent used this turn while it works, each once, the one it
 * used last first, each with its icon and newest window from the newest of
 * its calls that kept them; nothing while it works in none, or once it is
 * done. A call that names no app, listing them, adds none, nor does one the
 * Mac refused, such as for a grant it lacks, so a refused app never floats
 * a window it never read or says it is in use.
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
    const app = usedApp(call);

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
  const using = usedApp(newest) === top.app;

  return { apps, using };
}

/** Every agent whose windows the reader put away this window's session, so its stack stays down as the tab comes back. */
const WINDOWS_HIDDEN = new Set<string>();

/** Stops the agent's turn, answering whether the service took it; none where the reader may not stop it. */
type StopTurn = (() => Promise<boolean>) | undefined;

/**
 * The apps in use as a dock's row, their windows floating over it; nothing
 * while the agent uses no app. Note that the row is its own component, so
 * the viewer it opened goes with it as the turn ends rather than standing
 * open into the next.
 */
export function ComputerDock({
  agentId,
  messages,
  working,
  onStop,
}: {
  agentId: string;
  messages: readonly AgentTranscriptMessage[];
  working: boolean;
  onStop: StopTurn;
}): ReactNode {
  const inUse = useMemo(() => appsInUse(messages, working), [messages, working]);
  const top = inUse?.apps[0];

  if (inUse === undefined || top === undefined) return null;

  return <AppsDock agentId={agentId} inUse={inUse} top={top} onStop={onStop} />;
}

/** The row and the windows of the apps in use this turn. */
function AppsDock({
  agentId,
  inUse,
  top,
  onStop,
}: {
  agentId: string;
  inUse: AppsInUse;
  top: UsedApp;
  onStop: StopTurn;
}): ReactNode {
  const window = useKeptPicture(top.window?.id);
  const { open, viewer } = useKeptPictureViewer();
  const stop = useAsyncAction(rejectionWords);
  const [hidden, setHidden] = useState(() => WINDOWS_HIDDEN.has(agentId));

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
            // Note that an app on top whose window was never read opens the newest window another app's call kept.
            const first = shown ?? windows[0]?.picture;

            if (first !== undefined) open(windows, first.id);
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
