import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  readOnlyTerminalLook,
  TERMINAL_ACTION,
  TERMINAL_STATE,
  type TerminalAction,
  type TerminalBar,
  terminalLook,
} from "@repo/features/terminal-model";
import { SHORTCUT_KEY } from "@repo/settings/shortcuts";
import {
  ANNOUNCE,
  Badge,
  BUTTON_VARIANT,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FILL_FLOW,
  Fill,
  IconButton,
  PaneBar,
  PlayIcon,
  Shortcut,
  TEXT_BUTTON_TONE,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TextButton,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { STRIP_TAB_KIND } from "@repo/ui/tab-strip-model";
import { useQuery } from "@tanstack/react-query";
import { useContext, useEffect, useMemo, useState } from "react";
import { TERMINAL_LOAD_FAILED } from "../bundle-loader.js";
import { useTabActions } from "../desktop/strip-tabs.js";
import { unreadShown } from "../failure-report.js";
import { FIND_STEP, type FindSource, useFindSource } from "../find-in-tab.js";
import { usePhoneRoom } from "../stage-room.js";
import { TERMINAL_FIND, type TerminalFind } from "../terminal/contract.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { appStateQuery, selectMirrors } from "../use-app-state.js";
import { AgentRef, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { type RunTabLook, useRunTabLooks } from "./run-action-shells.js";
import { useRunActionPress } from "./run-actions-button.js";
import { AgentGlyph } from "./tab-look.js";
import { useHeldShells } from "./terminal-held.js";
import {
  TERMINAL_BODY_CLASS,
  TERMINAL_HOST_CLASS,
  TERMINAL_SCREEN_CLASS,
} from "./terminal-look.js";
import type { TerminalKind } from "./terminal-session.js";
import type { AgentsControl } from "./use-agents.js";
import { type ShellTab, TerminalsContext, useTerminalTabSession } from "./use-terminal-session.js";
import { useWindowAccount } from "./window-account.js";

/**
 * terminal-tab.tsx -- one terminal tab, "Cloud 1" in the agent's own sandbox or "Local 1" on this Mac in the agent's mirrored files: its shell's screen, under a bar naming the agent and where the connection stands.
 *
 * Each terminal is a tab of its own: the panel's "+", New terminal, and ⌘K
 * open another, and closing the tab ends its shell
 * (`use-terminal-session.ts`). The tab is the File tab's frame: a bar across
 * its top, here naming the agent (`AgentRef`, which hangs the agent's card
 * and opens its tab) and the connection in a word or two; then the
 * terminal's screen (`terminal/`), which fills the rest. A state with
 * something to do lays one slim bar over the screen with one text action and
 * its key, and the title bar says the rest (`terminal-model.ts`). The tab
 * keeps its terminal while it is hidden (`terminal-session.ts`).
 *
 * The screen draws on a canvas, which the screen recording leaves blank;
 * the bar over it records masked.
 */

/**
 * The screen's scrollback as the source ⌘F finds in, since the terminal
 * draws its words on a canvas the window's find cannot read: found as
 * typed, stepped, tallied, and seeded from the screen's selection.
 */
function useScrollbackFind(find: TerminalFind | undefined): FindSource | undefined {
  return useMemo(
    () =>
      find === undefined
        ? undefined
        : {
            search: (query) => find.find(query, TERMINAL_FIND.TYPED),
            step: (query, step) =>
              find.find(
                query,
                step === FIND_STEP.NEXT ? TERMINAL_FIND.NEXT : TERMINAL_FIND.PREVIOUS,
              ),
            clear: find.clear,
            onTally: find.onTally,
            // A selection over several lines seeds its first, the one line the field holds, its spaces kept.
            selection: () =>
              find
                .selection()
                .split(/\r?\n/)
                .find((line) => line.trim() !== ""),
          },
    [find],
  );
}

/** What an action's tab says it is, beside where the action stands. */
const READ_ONLY = "Read-only";

/** What the tab's Run and Stop say to a reader, its glyph saying it on screen. */
const RUN_WORDS = {
  RUN: (label: string) => `Run ${label}`,
  STOP: (label: string) => `Stop ${label}`,
} as const;

/** A run action's tab's own press: Stop while its process runs, Run otherwise, which runs it again in this tab, each held while it cannot be pressed. */
function runControlOf(
  run: RunTabLook,
  label: string,
  press: ReturnType<typeof useRunActionPress>,
): {
  readonly label: string;
  readonly icon: React.JSX.Element;
  readonly onPress: () => void;
  readonly held: boolean;
} {
  return run.running === true
    ? {
        label: RUN_WORDS.STOP(label),
        icon: <GLYPH.STOP />,
        onPress: () => press.stop(run.action),
        held: press.busy,
      }
    : {
        label: RUN_WORDS.RUN(label),
        icon: <PlayIcon />,
        onPress: () => press.run(run.action),
        held: press.busy || !press.runnable,
      };
}

/** What a phone's ⋯ calls the agent's name in the bar, which opens its tab. */
const OPEN_AGENT = "Open agent";

/** The slim bar over the screen: its words, a count or a note, and its one action with its key. */
function StateBar({
  bar,
  onAction,
}: {
  bar: TerminalBar;
  onAction: (action: TerminalAction) => void;
}): React.JSX.Element {
  const { action } = bar;
  // Note that a late bar is hidden until it has held a second, so its words are said once its reveal has run: a blip that mends first is never seen, so it is never said.
  const [revealed, setRevealed] = useState(false);
  useAnnounceShown(ANNOUNCE.POLITE, bar.late && !revealed ? "" : bar.words);

  return (
    <div
      className="terminal-bar flex min-h-7 flex-none flex-wrap items-center gap-x-control-gap gap-y-list-gap border-b border-border bg-muted py-tight-gap pr-list-inset pl-ui-16 font-mono text-caption text-muted-foreground"
      data-late={String(bar.late)}
      onAnimationEnd={() => setRevealed(true)}
    >
      {/* Note that the glyph and the words are one item, so a bar too narrow for its action puts the action on a line of its own rather than the glyph apart from its words. */}
      {/* Note that the words wrap rather than hold to one line, because they say what to do and a cut line loses that first; the glyph keeps to their first line's baseline. */}
      <span className="flex min-w-0 flex-initial items-baseline gap-control-gap">
        {bar.busy ? (
          <span className="flex-none tracking-busy text-muted-foreground" aria-hidden="true">
            ⋯
          </span>
        ) : null}
        <Text
          as={TEXT_ELEMENT.SPAN}
          variant={TEXT_VARIANT.INHERIT}
          className="terminal-bar-words min-w-0"
        >
          {bar.words}
        </Text>
      </span>
      <span className="terminal-bar-end ml-auto inline-flex items-center gap-control-gap whitespace-nowrap">
        {action === undefined ? null : (
          <TextButton tone={TEXT_BUTTON_TONE.ACCENT} onClick={() => onAction(action.kind)}>
            {action.label}
            <Shortcut
              chord={{ key: SHORTCUT_KEY.ENTER, bare: true }}
              className="ms-tight-gap [--ui-shortcut-ink:currentColor]"
            />
          </TextButton>
        )}
      </span>
    </div>
  );
}

export function TerminalTab({
  tab,
  agents,
  shown,
  onOpenAgent,
  onClose,
}: {
  tab: ShellTab;
  agents: AgentsControl;
  /** Whether the tab is on screen, the one moment its screen stands in its box. */
  shown: boolean;
  /** Opens the agent's own tab in the task's column. */
  onOpenAgent: () => void;
  /** Closes the tab, as an archived agent's does. */
  onClose: () => void;
}): React.JSX.Element {
  const agentId = tab.kind === STRIP_TAB_KIND.TERMINAL ? tab.terminal : tab.local;
  const subject = agentSubject(agents, agentId, NOTHING_HELD, false);
  const session = useTerminalTabSession(tab, shown, onClose);
  useFindSource(useScrollbackFind(session.find));
  // Note that a Local tab says which step of the agent's mirror it waits on while it connects, where the host said.
  const mirrors = useQuery({ ...appStateQuery, select: selectMirrors }).data;
  const mirror = tab.kind === STRIP_TAB_KIND.LOCAL ? mirrors?.[agentId] : undefined;
  // A run action's tab is read-only, and its bar says where the action stands and offers to run or stop it.
  const tabs = useMemo(() => [tab], [tab]);
  const runLook = useRunTabLooks(tabs, shown)(tab);

  const look =
    runLook === undefined
      ? terminalLook(session.state, mirror)
      : readOnlyTerminalLook(session.state);

  const press = useRunActionPress(agentId, tab.kind === STRIP_TAB_KIND.LOCAL);

  // A run action's tab whose shell went says it ended, and attaches again once its action runs again, from here or the Run button.
  const ranAgain =
    shown && runLook?.running === true && session.state.kind === TERMINAL_STATE.EXITED;

  const { onAction } = session;
  useEffect(() => {
    if (ranAgain) onAction(TERMINAL_ACTION.RETRY);
  }, [ranAgain, onAction]);
  const runControl = runLook === undefined ? undefined : runControlOf(runLook, tab.title, press);
  // A phone draws no bar over the screen: its header's ⋯ opens the agent.
  const phone = usePhoneRoom();
  // Note that a phone has no title bar to carry "connecting…", so a state only that bar says is said in a bar over the screen.
  const bar = look.bar ?? (phone ? look.phoneBar : undefined);
  useTabActions(
    phone
      ? [
          [
            {
              label: OPEN_AGENT,
              icon: <AgentGlyph agent={subject.agent} />,
              detail: subject.name,
              onSelect: onOpenAgent,
            },
            ...(runControl === undefined
              ? []
              : [
                  {
                    label: runControl.label,
                    icon: runControl.icon,
                    disabled: runControl.held,
                    onSelect: runControl.onPress,
                  },
                ]),
          ],
        ]
      : undefined,
  );

  return (
    <Fill className="terminal-tab file-view" data-state={session.state.kind}>
      {phone ? null : (
        <PaneBar
          middle={
            // Note that the name and where the connection stands share one shrinking box, so a long name is cut rather than running past the bar.
            // Note that each fact stands as its own element a gap apart, never joined by a dot: a run action's read-only as a badge, the connection as quiet words.
            <span className="terminal-tab-title inline-flex min-w-0 items-center gap-item-gap overflow-hidden whitespace-nowrap text-muted-foreground">
              <AgentRef
                subject={subject}
                models={agents.models}
                onOpen={onOpenAgent}
                glyph={<AgentGlyph agent={subject.agent} />}
                label={subject.name}
              />
              {runLook !== undefined && session.state.kind === TERMINAL_STATE.ATTACHED ? (
                <Badge>{READ_ONLY}</Badge>
              ) : (
                <span className="terminal-tab-standing flex-none">{look.words}</span>
              )}
            </span>
          }
          actions={
            runControl === undefined ? undefined : (
              <IconButton
                variant={BUTTON_VARIANT.QUIET}
                icon={runControl.icon}
                label={runControl.label}
                disabled={runControl.held}
                onClick={runControl.onPress}
              />
            )
          }
        />
      )}
      <Fill flow={FILL_FLOW.ROW} clip className={TERMINAL_BODY_CLASS}>
        <div className={TERMINAL_HOST_CLASS}>
          {bar === undefined ? null : (
            // Note that each entry into a state's bar is a bar of its own, because a late bar's reveal runs again and its words wait for it, even when the state it follows was late too.
            <StateBar key={session.state.kind} bar={bar} onAction={session.onAction} />
          )}
          {session.failed ? (
            <ErrorState
              failure={unreadShown(FAILURE_SURFACE.BUNDLE_LOAD)}
              placement={ERROR_STATE_PLACEMENT.CENTERED}
              onRetry={session.retryBundle}
            >
              {TERMINAL_LOAD_FAILED}
            </ErrorState>
          ) : (
            <div
              ref={session.screen}
              className={TERMINAL_SCREEN_CLASS}
              data-dim={String(look.dim)}
            />
          )}
        </div>
      </Fill>
    </Fill>
  );
}

/**
 * An agent's terminals of a kind, as its row in the panel's "+" says them
 * after the agent's name: how many this window holds, nothing before the
 * first. Whether the agent works is the row's glyph's to say.
 */
export function TerminalCount({
  kind,
  agentId,
}: {
  kind: TerminalKind;
  agentId: string;
}): React.JSX.Element {
  const count = useHeldShells(
    useContext(TerminalsContext).held,
    useWindowAccount(),
    kind,
    agentId,
  ).length;

  return <>{count === 0 ? null : `${count} ${count === 1 ? "terminal" : "terminals"}`}</>;
}
