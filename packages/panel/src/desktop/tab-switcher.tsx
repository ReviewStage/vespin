/**
 * tab-switcher.tsx -- ⌃Tab and ⌃⇧Tab: the screens the window stood on last, across every task, as cards to step through while ⌃ is held, as ⌘Tab steps through apps.
 *
 * The screens are Back's own steps, most recent first
 * (`places/window-history.ts`'s `recent`): what is one screen, which
 * screens can still be gone to, and what each is called are Back's rules
 * and no others, so Settings, a version history, an Inbox item, and an
 * automation's page are each a screen as they are a step of Back's, and a
 * tab chosen in the side panel's strip takes the screen standing in place
 * as it takes Back's step. A quick tap of ⌃Tab goes to the screen before
 * this one without drawing anything, so two taps flip between two. Held a
 * beat, the cards show over the window: the screen here first and dimmed,
 * the one after it chosen. Tab and → step on, ⇧Tab and ← back, wrapping
 * around; letting go of ⌃, or ⏎, goes to the card chosen, Escape goes
 * nowhere, and a press on a card goes to it. Going is a visit after the
 * screen standing, which stands the step as Back stands one it lands on
 * (`onVisitStep`), asking first where a page holds unsaved work.
 *
 * The keys are heard before anything under them, a terminal's or a text
 * field's, since a Control chord is otherwise theirs: a cloud Browser tab
 * and a Terminal tab hand ⌃Tab on to the window for it (`chordIsWindows`,
 * `terminal-keys.ts`). It is a desktop app's alone, since a browser keeps
 * ⌃Tab for its own tabs, and it holds off the menu bar's Back and Forward
 * while it stands, as ⌘K's palette does, and leaves ⌃Tab to a dialog over
 * the window.
 *
 * A card is named as Back's list names the step now (`history-titles.ts`):
 * a task's by its status glyph and name, then its panes' tabs, "Fix token
 * refresh · Code", the column's agent wearing its glyph as its tab drew it
 * (`switcher-looks.ts`), at work or failed as everywhere; an agent's page
 * by the agent, on a task or with none, wearing its glyph as its tab would,
 * and an automation's agent by its automation under it, as its page's bar
 * leads with it; a person's by their face; and any other place by the
 * glyph its door wears.
 * Its preview is a still of the whole work area, taken once the window has
 * stood on the screen with nothing pressed or scrolled for a beat, and as ⌃Tab
 * leaves a screen that has none yet: main takes a downscaled picture of that
 * part of the window (`window.capture`). Note that a still is taken once a
 * screen, and only once the window is quiet, because each costs main about
 * 10 ms of its own thread, a resize and a JPEG, that a press landing then
 * waits behind, so a run of steps between tasks takes one, of the screen it
 * ends on. A window with no switcher takes none. A still is a picture
 * of the window's words, so it is kept in this window's memory alone, a few
 * at a time, never written, traced, or counted, and the session recording
 * masks its address, so it draws empty there. Until a screen has one, its card shows its
 * glyph.
 */

import type { AgentSummary } from "@repo/features/agent-wire";
import { ENTITY_KIND } from "@repo/features/entity-kind";
import { agentName, automationRun } from "@repo/features/model-label";
import type { TaskSummary } from "@repo/features/task-wire";
import { ACT_KIND } from "@repo/host/acts";
import { HOST_CAPABILITY } from "@repo/settings";
import { APP_COMMAND, commandForKey } from "@repo/settings/shortcuts";
import {
  createWait,
  DIALOG_SIZE,
  Dialog,
  TabCard,
  TabCards,
  useRest,
  VisuallyHidden,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import { HistoryIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { overlayHoldsKeyboard, useAppCommand, useOverlayHold } from "../app-commands.js";
import { EntityGlyph } from "../entities/entity-glyph.js";
import {
  ADMIN_WORDS,
  AUTOMATIONS_WORDS,
  HOME_WORDS,
  INBOX_WORDS,
  MERGE_QUEUE_WORDS,
  SETTINGS_WORDS,
  VERSION_HISTORY_WORDS,
} from "../history-titles.js";
import { MemberDirectory, usePerson } from "../member-directory.js";
import { useMutationCalls } from "../mutation-calls.js";
import { ROUTED_PLACE, type RoutedPlace } from "../places/routed-places.js";
import type { TaskStep } from "../places/task-step.js";
import type { RecentStep, RecentSteps } from "../places/window-history.js";
import { type Place, type StepTitle, sameScreen } from "../places/window-steps.js";
import { useNamedTask } from "../task-list-collections.js";
import { stripTabLook } from "../tasks/strip-tab-kinds.js";
import { agentEndMark, type KindLook, PlanGlyph, TAB_KIND, tabLook } from "../tasks/tab-look.js";
import type { MainTab } from "../tasks/use-main-tabs.js";
import type { SidePanelTab } from "../tasks/use-side-panel.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";
import { AutomationGlyph } from "./automation-agent-run.js";
import { type HeldLook, heldLook, LOOK_STRIP } from "./switcher-looks.js";
import {
  SWITCH_STEP,
  SWITCHER_LET_GO,
  type SwitcherState,
  type SwitchStep,
  switcherChose,
  switcherPressed,
  switcherShown,
  switcherTarget,
} from "./tab-switcher-model.js";

/** How long ⌃ is held after ⌃Tab before the cards show, so a quick tap flips without drawing them. */
const HOLD_SHOWS = "150 millis";

/** How long the window stands on a screen with nothing pressed or scrolled before its still is taken: longer than a step through tasks at reading pace, so a run of them takes one still, of the screen it ends on. */
const STILL_SETTLES = "1500 millis";

/** What the window hears as it being used, each holding off the still a screen is owed: a press, a key, a scroll. */
const BUSY_EVENTS = ["keydown", "pointerdown", "wheel"] as const;

/** How many stills the window keeps, the most recent screens': as many as the cards, and a few the cards may reach once a tab closes. */
const STILLS_KEPT = 8;

/** The two chords, each the step it takes. */
const SWITCH_COMMANDS = [APP_COMMAND.NEXT_RECENT_TAB, APP_COMMAND.PREVIOUS_RECENT_TAB] as const;

const STEP_OF = {
  [APP_COMMAND.NEXT_RECENT_TAB]: SWITCH_STEP.ON,
  [APP_COMMAND.PREVIOUS_RECENT_TAB]: SWITCH_STEP.BACK,
} as const satisfies Record<(typeof SWITCH_COMMANDS)[number], SwitchStep>;

/** The part of the window a screen's still is of: the work area beside the sidebar, both of a task's panes as they stand. */
const WORK_AREA = ".desktop-main";

/** What a place's card wears where nothing names it otherwise: the glyph its door wears, and the app's word for it where Back's list names it nothing. */
const PLACE_LOOKS: ReadonlyMap<
  RoutedPlace,
  { readonly icon: React.JSX.Element; readonly word: string }
> = new Map<RoutedPlace, { readonly icon: React.JSX.Element; readonly word: string }>([
  [ROUTED_PLACE.HOME, { icon: <EntityGlyph kind={ENTITY_KIND.HOME} />, word: HOME_WORDS }],
  [ROUTED_PLACE.INBOX, { icon: <EntityGlyph kind={ENTITY_KIND.INBOX} />, word: INBOX_WORDS }],
  [ROUTED_PLACE.BOARD, { icon: <EntityGlyph kind={ENTITY_KIND.BOARD} />, word: "Tasks" }],
  [
    ROUTED_PLACE.AUTOMATIONS,
    { icon: <EntityGlyph kind={ENTITY_KIND.AUTOMATIONS} />, word: AUTOMATIONS_WORDS },
  ],
  [
    ROUTED_PLACE.SETTINGS,
    { icon: <EntityGlyph kind={ENTITY_KIND.SETTINGS} />, word: SETTINGS_WORDS },
  ],
  [ROUTED_PLACE.ADMIN, { icon: <EntityGlyph kind={ENTITY_KIND.ADMIN} />, word: ADMIN_WORDS }],
  [ROUTED_PLACE.MERGE_QUEUE, { icon: <GLYPH.QUEUED />, word: MERGE_QUEUE_WORDS }],
  [ROUTED_PLACE.VERSION_HISTORY, { icon: <HistoryIcon />, word: VERSION_HISTORY_WORDS }],
]);

/** What a screen's card is called where the window names it nothing. */
const SCREEN_WORDS = "Page";

/** What a task's card is called where the window lists no name for it. */
const TASK_WORDS = "Task";

/** What a person's page is called where the name is not known. */
const PERSON_WORDS = "Profile";

/** The hold before the cards show: the window's one, as it has one switcher, so each press held afresh calls off the one before. */
const holdWait = createWait();

/** A still kept of a screen. */
interface HeldStill {
  readonly place: Place;
  readonly src: string;
}

/** How a card wears its screen: its glyph and name, and under them the words a task's tabs are named by, its agent's glyph before them and its end mark after. */
interface CardLook extends KindLook {
  /** Whether the name is the app's own word, a place's or the word for a thing no name is known for, which a screen recording shows as it reads (`TabCard`'s). */
  readonly labelReplayUnmasked?: boolean | undefined;
  readonly detail: string | undefined;
  readonly detailIcon?: React.JSX.Element | undefined;
  readonly endMark?: React.JSX.Element | undefined;
}

/** A tab's look where its strip never drew it in this window: its kind's glyph and word, Overview's its own, the Plan's named for its task where the window lists it. */
function tabWordLook(tab: SidePanelTab | MainTab, task: TaskSummary | undefined): KindLook {
  const plan = task === undefined ? undefined : { name: task.name, status: task.status };

  return tabLook(stripTabLook(tab, { plan }));
}

/** What an automation's agent's card says under its name: the automation whose run started it, wearing the glyph of what fires it, as the agent's page leads its bar with it (`automation-agent-run.tsx`); nothing for any other agent. */
function automationDetail(
  agent: AgentSummary,
  workspaceId: string,
): Pick<CardLook, "detail" | "detailIcon"> {
  const name = automationRun(agent)?.name;

  return name === undefined
    ? { detail: undefined }
    : {
        detail: name,
        detailIcon: <AutomationGlyph workspaceId={workspaceId} automationId={agent.automationId} />,
      };
}

/** A person's page wears their face, read against the members around it as every person is drawn. */
function PersonStopFace({ userId, name }: { userId: string; name: string }): React.JSX.Element {
  return <ActorMark actor={usePerson({ userId, name })} size={ACTOR_SIZE.INLINE} />;
}

/** A task's card: its status glyph and its name as Back's list names the step now, then its panes' tabs as their strips drew them where nothing names them, `task` the step's task as the window lists it. */
function taskLook(
  step: TaskStep,
  title: StepTitle | undefined,
  task: TaskSummary | undefined,
): CardLook {
  const { taskId } = step;
  const side = step.side ?? (step.panel?.open === true ? step.panel.tab : undefined);

  const column: HeldLook | undefined =
    step.column === undefined
      ? undefined
      : (heldLook(LOOK_STRIP.COLUMN, taskId, step.column) ?? tabWordLook(step.column, task));

  const panel =
    side === undefined
      ? undefined
      : (heldLook(LOOK_STRIP.PANEL, taskId, side) ?? tabWordLook(side, task));

  // The words are the tabs as their strips drew them, where nothing names the screen now or as it stood.
  const words = [column?.label, panel?.label].filter((word) => word !== undefined);

  return {
    icon: <PlanGlyph status={task?.status} />,
    label: title?.label ?? TASK_WORDS,
    labelReplayUnmasked: title?.label === undefined,
    detail: title?.detail ?? (words.join(" · ") || undefined),
    detailIcon: column?.icon,
    endMark: column?.endMark,
  };
}

/** An agent's card: the agent as its tab would wear it, read off every agent the window lists, its automation under it. */
function agentLook(agentId: string, tasks: TasksControl): CardLook {
  const agent = tasks.liveAgents?.find((each) => each.id === agentId);

  if (agent === undefined) {
    return {
      ...tabLook({ kind: TAB_KIND.AGENT, name: undefined, agent: undefined }),
      labelReplayUnmasked: true,
      detail: undefined,
    };
  }

  return {
    ...tabLook({ kind: TAB_KIND.AGENT, name: agentName(agent, tasks.agents.models), agent }),
    ...automationDetail(agent, agent.workspaceId),
    endMark: agentEndMark(agent, false),
  };
}

/** How a card wears its screen, from what Back's list calls the step now and what the window holds of what it names, `task` the step's task as the window lists it. */
function cardLook(step: RecentStep, tasks: TasksControl, task: TaskSummary | undefined): CardLook {
  const { place, title, routed, params } = step;

  if (place.task !== undefined) return taskLook(place.task, title, task);

  if (routed === ROUTED_PLACE.AGENT && params.agentId !== undefined) {
    return agentLook(params.agentId, tasks);
  }

  if (routed === ROUTED_PLACE.PERSON && params.userId !== undefined) {
    const name = title?.label ?? PERSON_WORDS;

    return {
      icon: <PersonStopFace userId={params.userId} name={name} />,
      label: name,
      labelReplayUnmasked: title?.label === undefined,
      detail: title?.detail,
    };
  }

  const look = routed === undefined ? undefined : PLACE_LOOKS.get(routed);

  return {
    icon: look?.icon ?? <EntityGlyph kind={ENTITY_KIND.HOME} />,
    label: title?.label ?? look?.word ?? SCREEN_WORDS,
    labelReplayUnmasked: title?.label === undefined,
    detail: title?.detail,
  };
}

/** One card of a screen. */
function ScreenCard({
  step,
  tasks,
  still,
  here,
  chosen,
  onPoint,
  onPick,
}: {
  step: RecentStep;
  tasks: TasksControl;
  still: string | undefined;
  here: boolean;
  chosen: boolean;
  onPoint: () => void;
  onPick: () => void;
}): React.JSX.Element {
  // The step's task as the window lists it, read by its id, so a delivery moving another task leaves the card as it is.
  const task = useNamedTask(step.place.task?.taskId, tasks.typedNames);
  const look = cardLook(step, tasks, task);

  return (
    <TabCard
      icon={look.icon}
      label={look.label}
      labelReplayUnmasked={look.labelReplayUnmasked}
      detail={look.detail}
      detailIcon={look.detailIcon}
      endMark={look.endMark}
      still={still}
      here={here}
      chosen={chosen}
      // Note that the card is picked on the press, because ⌃ is held while it is pressed, which a Mac makes a right-click.
      pickOnPress
      onPoint={onPoint}
      onPick={onPick}
    />
  );
}

/** A part of the window, in whole CSS pixels. */
interface Area {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where an element stands in the window, in whole CSS pixels; none where it is not drawn. */
function areaOf(selector: string): Area | undefined {
  const box = document.querySelector(selector)?.getBoundingClientRect();

  if (box === undefined || box.width < 1 || box.height < 1) return undefined;
  const x = Math.max(0, Math.round(box.left));
  const y = Math.max(0, Math.round(box.top));

  return { x, y, width: Math.round(box.right) - x, height: Math.round(box.bottom) - y };
}

/** Whether the press is the switcher's to hold while it stands: every key but ⌃ itself. */
function claim(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * The switcher, answering ⌃Tab while `available`, past the sign-in, on a
 * desktop app, over the window's steps (`steps`). It is mounted once for
 * the window and draws nothing until its cards show.
 */
export function TabSwitcher({
  available,
  steps,
  tasks,
}: {
  available: boolean;
  /** The window's steps as ⌃Tab steps through them (`places/window-history.ts`). */
  steps: RecentSteps;
  tasks: TasksControl;
}): React.JSX.Element | null {
  const desktop =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.DESKTOP_APP) }).data ===
    true;

  const answers = available && desktop;
  // Note that a still is the window's own action, sent on its mutation; nothing the service holds.
  const { mutateAsync: sendCapture } = useMutationCalls(actMutation(ACT_KIND.WINDOW_CAPTURE));
  const [state, setState] = useState<SwitcherState<RecentStep>>(SWITCHER_LET_GO);
  // Counts the stills kept, so one landing while the cards show is drawn at once.
  const [, setStillsKept] = useState(0);
  // Note that these are refs, because the keys and the stills read them as they land, which no render stands between.
  const latest = useRef<SwitcherState<RecentStep>>(SWITCHER_LET_GO);
  const stills = useRef<readonly HeldStill[]>([]);
  // The screen the window last settled on, whose still is taken once it has stood a beat.
  const settled = useRef<Place | undefined>(undefined);
  const doors = useRef(steps);
  doors.current = steps;
  // The screen whose still is owed, taken once the window has stood on it quiet for a beat (`stillRest`).
  const owed = useRef<Place | undefined>(undefined);
  // The switcher's hold is called off as it leaves, since what it would do is draw it.
  useEffect(() => () => holdWait.stop(), []);
  useOverlayHold(state.held);
  const titleId = useId();
  const [face, setFace] = useState<SwitcherState<RecentStep>>(state);

  if (state.held && state.shown && face !== state) setFace(state);

  const move = (next: SwitcherState<RecentStep>) => {
    latest.current = next;
    setState(next);
  };

  // The screen the window stands on, where it stands on a step.
  const here = (): Place | undefined => doors.current.standingStep();

  const keep = (place: Place, src: string) => {
    stills.current = [
      { place, src },
      ...stills.current.filter((held) => !sameScreen(held.place, place)),
    ].slice(0, STILLS_KEPT);

    if (latest.current.held) setStillsKept((count) => count + 1);
  };

  // A still of the work area as it is drawn now, kept once main answers; a screen no longer on screen by then keeps what it had.
  const takeStill = (place: Place) => {
    const area = areaOf(WORK_AREA);

    if (area === undefined) return;

    // A screen taken is owed nothing more, so ⌃Tab's still of it is not taken again once the window is quiet.
    if (owed.current !== undefined && sameScreen(owed.current, place)) owed.current = undefined;
    sendCapture(area).then(
      (src) => {
        if (src !== null) keep(place, src);
      },
      () => undefined,
    );
  };

  // Note that one rest stands for every screen, re-aimed as the window moves or is used, so a run of steps forks one fiber and takes one still.
  const stillRest = useRest<Place>(STILL_SETTLES, (standing) => {
    const stillOwed = owed.current !== undefined && sameScreen(owed.current, standing);
    const standingOn = here();

    if (stillOwed && standingOn !== undefined && sameScreen(standingOn, standing)) {
      takeStill(standing);
    }
  });

  // The screen the window arrives on is owed a still, checked on each render; a window with no switcher owes none.
  useEffect(() => {
    const standing = answers ? here() : undefined;
    const before = settled.current;
    settled.current = standing;

    if (standing !== undefined && before !== undefined && sameScreen(before, standing)) return;
    owed.current = standing;
    stillRest.aim(standing);
  });

  // While a still is owed, the window being used holds it off, so it is taken in a pause rather than under a press.
  useEffect(() => {
    if (!answers) return undefined;

    const busy = () => {
      if (owed.current !== undefined) stillRest.aim(owed.current);
    };

    for (const each of BUSY_EVENTS) {
      window.addEventListener(each, busy, { capture: true, passive: true });
    }

    return () => {
      for (const each of BUSY_EVENTS) window.removeEventListener(each, busy, { capture: true });
    };
  }, [answers, stillRest]);

  const pressedNow = (state: SwitcherState<RecentStep>, step: SwitchStep) => {
    const screens = doors.current.recent();

    return switcherPressed(state, { screens, here: screens[0]?.standing === true, step });
  };

  const press = (step: SwitchStep) => {
    const before = latest.current;
    const next = pressedNow(before, step);

    if (!next.held) return;

    if (!before.held) {
      // The screen being left is taken before the cards can cover it, where it has no still yet; one it has stands, so flipping between two screens takes none.
      const leaving = here();

      const kept = stills.current.some(
        (held) => leaving !== undefined && sameScreen(held.place, leaving),
      );

      if (leaving !== undefined && !kept) takeStill(leaving);

      holdWait.start(
        Effect.andThen(
          Effect.sleep(HOLD_SHOWS),
          Effect.sync(() => move(switcherShown(latest.current))),
        ),
      );
    }

    move(next);
  };

  const letGo = (going: boolean) => {
    const target = going ? switcherTarget(latest.current) : undefined;
    holdWait.stop();
    move(SWITCHER_LET_GO);

    if (target !== undefined) doors.current.onVisitStep(target.place);
  };

  // The menu bar's items, and ⌘K's rows, go at once, as a tap would: no ⌃ is held to let go of.
  const tap = (step: SwitchStep) => () => {
    if (latest.current.held || overlayHoldsKeyboard()) return;
    const target = switcherTarget(pressedNow(SWITCHER_LET_GO, step));

    if (target !== undefined) doors.current.onVisitStep(target.place);
  };

  useAppCommand(APP_COMMAND.NEXT_RECENT_TAB, answers ? tap(SWITCH_STEP.ON) : undefined);
  useAppCommand(APP_COMMAND.PREVIOUS_RECENT_TAB, answers ? tap(SWITCH_STEP.BACK) : undefined);

  // The keys, heard before anything under them; while held, every key is the switcher's.
  const keys = useRef({ press, letGo });
  keys.current = { press, letGo };
  useEffect(() => {
    if (!answers) return undefined;

    const down = (event: KeyboardEvent) => {
      const command = commandForKey(SWITCH_COMMANDS, event);

      if (command === APP_COMMAND.NEXT_RECENT_TAB || command === APP_COMMAND.PREVIOUS_RECENT_TAB) {
        // A dialog or ⌘K's palette over the window keeps its keys, so nothing moves behind it.
        if (!latest.current.held && overlayHoldsKeyboard()) return;
        claim(event);
        keys.current.press(STEP_OF[command]);

        return;
      }

      const held = latest.current;

      if (!held.held) return;

      // A press without ⌃ is one made after it was let go where the window did not hear it.
      if (!event.ctrlKey && event.key !== "Control") {
        keys.current.letGo(true);

        return;
      }

      claim(event);

      if (event.key === "Escape") keys.current.letGo(false);
      else if (event.key === "Enter") keys.current.letGo(true);
      else if (event.key === "ArrowRight") keys.current.press(SWITCH_STEP.ON);
      else if (event.key === "ArrowLeft") keys.current.press(SWITCH_STEP.BACK);
    };

    const up = (event: KeyboardEvent) => {
      if (!latest.current.held || (event.key !== "Control" && event.ctrlKey)) return;
      claim(event);
      keys.current.letGo(true);
    };

    const moved = (event: PointerEvent) => {
      if (latest.current.held && !event.ctrlKey) keys.current.letGo(true);
    };

    const left = () => {
      if (latest.current.held) keys.current.letGo(true);
    };

    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("pointermove", moved, true);
    window.addEventListener("blur", left);

    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("pointermove", moved, true);
      window.removeEventListener("blur", left);
    };
  }, [answers]);

  // Note that the cards are held as they last showed, so the dialog fades them out as it closes rather than drawing nothing.
  if (!face.held || !face.shown) return null;
  const { cards, chosen } = face;

  return (
    <Dialog
      open={state.held && state.shown}
      size={DIALOG_SIZE.MEDIA}
      labelledBy={titleId}
      // Note that Escape and a press on the dimmed window go nowhere, as Escape does while ⌃ is held.
      onDismiss={() => letGo(false)}
    >
      <VisuallyHidden id={titleId}>Recent tabs</VisuallyHidden>
      <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
        <TabCards label="Recent tabs">
          {cards.map((screen, at) => (
            <ScreenCard
              key={at}
              step={screen}
              tasks={tasks}
              still={stills.current.find((held) => sameScreen(held.place, screen.place))?.src}
              here={face.here && at === 0}
              chosen={at === chosen}
              onPoint={() => move(switcherChose(latest.current, at))}
              onPick={() => {
                move(switcherChose(latest.current, at));
                letGo(true);
              }}
            />
          ))}
        </TabCards>
      </MemberDirectory>
    </Dialog>
  );
}
