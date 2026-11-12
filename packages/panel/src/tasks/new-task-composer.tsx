import type { AgentPermissionMode } from "@repo/features/agent-approval-wire";
import { AGENT_BOUNDS, AGENT_STATUS, hasWordsOrFiles } from "@repo/features/agent-wire";
import { FAILURE_REASON, type Failure, rejectedFailure } from "@repo/features/failure-remedy";
import { wordsWithoutMarkers } from "@repo/features/file-marker";
import { encodeMention, MENTION_KIND } from "@repo/features/mention-link";
import type { MacOffer, ModelChoice } from "@repo/features/models-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  TASK_CREATE_RELATION_KIND,
  type TaskCreateRelation,
  type TaskCreateRelationKind,
  type TaskRunsOnRequest,
} from "@repo/features/task-wire";
import { workspaceReaches } from "@repo/features/tasks-model";
import { TERM } from "@repo/features/words";
import { EXPERIMENT } from "@repo/settings";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { SHORTCUT_KEY, type ShortcutChord, shortcutMatches } from "@repo/settings/shortcuts";
import {
  CHIP_WIDTH,
  POPOVER_ALIGN,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  VisuallyHidden,
} from "@repo/ui";
import { useAsyncAction } from "@repo/ui/use-async-action";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAgentDefault } from "../account-choices.js";
import { appPlatform } from "../app-platform.js";
import {
  type Draft,
  EMPTY_DRAFT,
  type KeptStart,
  useDraft,
  useDraftWriter,
} from "../composer-drafts.js";
import { automationAgentBrief } from "../desktop/automation-agent-brief.js";
import { MemberDirectory } from "../member-directory.js";
import { useOpenSettings } from "../open-settings.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
import { useNewAgentPermissionMode } from "./agent-approvals.js";
import { AgentComposer, COMPOSER_DOCK_CLASS, type ComposerWords } from "./agent-composer.js";
import { unrunnableChoice } from "./agent-model.js";
import { repositorySkillsQueryOptions } from "./agent-reads.js";
import type { AgentServersControl } from "./agent-servers.js";
import { ConnectAgentBanner, NOTICE_LOOK, type NoticeLook } from "./connect-agent-banner.js";
import type { MentionMenuSide } from "./mention-picker.js";
import { useMentionedReader } from "./mentioned-place.js";
import { NEW_TASK_PURPOSE, type NewTaskPurpose } from "./new-task-purpose.js";
import {
  type NewTaskRelation,
  NewTaskRelationRows,
  type NewTaskRelations,
  relationMenuPanel,
  relationsAsked,
  treeKind,
  treeRelationOf,
} from "./new-task-relation.js";
import { NoRepositoriesBanner } from "./no-repositories-banner.js";
import { joinedAhead, putBackRefused } from "./refused-send.js";
import { CHIP_PLACE, RepositoryChip } from "./repository-chip.js";
import { keptSkills } from "./repository-skills.js";
import { NewTaskRunsOnChip, newTaskRunsOn, useNewTaskRunsOn } from "./runs-on.js";
import { SkillFiles } from "./skill-chip.js";
import type { SkillWithFile } from "./skill-ref.js";
import { TaskMentions, tasklessMentions, useMentionAgentsReader } from "./task-mentions.js";
import type { AgentComposerControl } from "./use-agent-composer.js";
import { MODELS_READ } from "./use-agents.js";
import {
  keptStartOf,
  type NewTaskAgent,
  type NewTaskRefusal,
  type NewTaskStart,
  newTaskPlace,
  startUnknownNote,
} from "./use-new-task.js";
import type { TasksControl } from "./use-tasks-tab.js";

/**
 * new-task-composer.tsx -- New task's composer card: the words a coding agent starts on, and the chips that say where and how the task starts.
 *
 * The card is the agent box's own (`agent-composer.tsx`): the words field,
 * the "+", which raises a menu of Attachment, which attaches files, with an
 * image pasted or files dropped taken too, MCP servers, which opens the
 * servers popover beside the menu (`agent-servers.tsx`), and, on a task's
 * card, Task relation, which opens the task search beside it
 * (`new-task-relation.tsx`), dictation, the model chip, which `/model` opens as in an agent's box, and the round Start agent button, with File for
 * later before it, drawing the backlog's mark alone where the card is too
 * narrow for its words, as on a phone, where the model chip's words are cut
 * short too, so Start stays at the row's end in the card.
 * New task's repository chip stands in a head row over the card, the same in the
 * dialog and on Home: the repository the task is about
 * (`repository-chip.tsx`), its title, "New task", named to a reader alone,
 * since the card says what it is, and an automation's drawn before it; on a
 * phone the row wraps, each chip cut short rather than overflowing.
 * The Runs on chip stands after the box's "+", as an agent's box draws where its
 * agent runs, its glyph alone where the card is too narrow for its words:
 * Cloud and the member's
 * devices, which the agent it starts runs on (`runs-on.tsx`); an automation's
 * card draws none. Note that the card reads the member's devices as it opens and, where the last
 * pick is a device, holds Start, saying so, until that read lands, a list read before it opened not
 * counting, and says a read that failed, or one still out past its bound,
 * with Retry, because a start sent before the list is read names no device, and
 * the service starts such an agent in the cloud for good: Cloud is only ever
 * where an agent runs because the chip said Cloud. The repository chip starts on the one the press chose
 * (a repository group's +), else the newest the workspace's tasks were about
 * that its GitHub reaches, else the first its read lists, and stands on none
 * only where it reaches none or No repository was picked. A repository a read
 * does not list is dropped, so a later read listing it does not bring it back.
 * A tree's card holds the other task's repository, saying why.
 *
 * The words are a coding agent's prompt. Start stands once there are
 * words or files, with a repository or with none, which the chip offers
 * as No repository and the agent then works in. It starts the task with an empty description and no
 * call, Untitled until the
 * agent names it, and the agent on the words, the files, and the model
 * picked on the chip, in the one start (`use-tasks-tab.ts`), then opens the
 * task on the agent's tab; an agent refused opens it on a draft agent's tab
 * holding the words, why under the box, and Retry (`draft-agent-tab.tsx`).
 * The model chip shows the account's default as the card read it, and a
 * pick here runs this one agent alone: only Settings changes the default.
 * The + menu's MCP servers switch the servers the agent is handed, every
 * one on as the card opens, as on a draft agent's tab, with no Built in
 * section, since no agent has started to read its own tools from, and no
 * chip naming them; the start names those switched off, and only where
 * there are any, so a card left alone starts the agent as one started
 * anywhere else with none named.
 * Until the chip is picked the start names no model, so the agent runs on
 * the default Settings holds as Start is pressed, which may be newer than
 * the one the chip read, as on Home's card left standing; a draft
 * handed over on a refusal names none either, and its tab reads the
 * default afresh. A call starts only from an agent's own tab, so starting
 * a task never opens one.
 *
 * An agent's start carries a key the card mints, and the id its task is
 * made under beside it, and a press asking the same again, as Retry after a
 * start the service never answered does, carries the same pair, so a
 * service that made the task and its agent answers them rather than a
 * second pair; a press asking anything else, other servers among it, mints
 * another. A start whose outcome is unknown, never answered or failed on its
 * way, may have made its task, so the card opens again on no words: it keeps
 * the press with its draft (`../composer-drafts.ts`), which a relaunch keeps,
 * says the task may have started, and its Retry asks that press again
 * whatever the box holds; Edit takes its words and files back into the box,
 * where a Start of them unchanged is still that start and words changed are
 * another, and Remove lets it go. A read of the tasks listing the press's
 * task settles it, and the card lets it go and says the task started, with Open.
 *
 * Return starts, Shift+Return is a new line, and ⌘Return on a box with
 * neither words nor files starts a bare task: an empty description, no call, and
 * no agent, which needs no repository. While the box holds nothing,
 * the round button's hint says so, with its chord, since
 * nothing else on screen would. Escape closes a menu or a
 * dictation standing first,
 * and then whatever the owner says (`onLeave`), the dialog's card. A start
 * that was refused keeps the card, its words, and its servers, with why
 * under it and Retry; one whose task started but whose agent was refused
 * hands the servers to the draft agent's tab it opens on. Nothing typed here reaches the model as conversation.
 *
 * An `@` offers what it offers on the page of an agent no task holds
 * (`task-mentions.tsx`'s `tasklessMentions`): the servers, the
 * workspace's coding agents and people, the card standing among that
 * workspace's members as a task's page does, so a person picked or pasted
 * is named and drawn as there, and, once a repository is chosen, its files,
 * folders, and skills; a `/` offers its skills too, whose chip opens the
 * skill's `SKILL.md` on GitHub. Note that the box takes mentions with or
 * without a repository, because its editor reads that as it mounts, and a
 * repository is often chosen after. A mention is written into the words as
 * its link, so the agent's prompt holds it as any message does.
 *
 * The words and files are New task's draft in the workspace it starts in,
 * kept apart from the card (`../composer-drafts.ts`), so a card put away
 * and opened again, or Home's, finds them where they were left, the words
 * after a relaunch too; a task started lets them go, as emptying the box
 * does, an agent's start as it is pressed, so a New task opened while it is
 * out opens empty, and a card opened again on a refusal the service gave
 * brings its own words and files back ahead of whatever was written there
 * since (`refused-send.ts`). The card holds its own repository and model, so the owner
 * mounts it afresh to start those over; the workspace it starts in is the
 * owner's.
 *
 * A task's card may start its task related to others of its workspace,
 * each picked from the + menu's Task relation and drawn as a row docked over
 * the card, where an agent's box docks its pull request, reading as a
 * sentence: its kind, the task's key, its status, its name, and ×
 * (`new-task-relation.tsx`). The add menu's New task opens the card with one
 * row from the new task's side, and New sub-task, from a task's menu or ⌘K,
 * one as Sub-task of that task; each row's kind, task, and × change it as
 * the card's own. A task takes one relation, a task one parent, and a start
 * at most `TASK_BOUNDS.MAX_START_RELATIONS`, which the card holds itself,
 * since the service refuses a task named twice or two parents. The start
 * names them all (`relations`), which the service writes with the task in
 * one transaction, and a refused card opened again keeps them. Once a
 * Sub-task of or Parent of stands the repository chip is held to its task's,
 * saying why, because a tree works in one repository, so every tree
 * relation must share it, and the start leaves the repository to the
 * service. A sub-task holds no place to run, as no task does, so its card
 * draws Runs on as any other.
 *
 * The Automations page's Create with an agent opens this same card for the
 * agent that makes an automation (`NEW_TASK_PURPOSE.AUTOMATION`), so making
 * one looks and works as starting any agent does. Its title and placeholder
 * say so, its words are kept as a draft of their own, and the agent is handed
 * the fixed brief with the words fenced after it (`automation-agent-brief.ts`),
 * refused here where that would pass an agent's first message's bound. It
 * starts on words alone, and
 * ⌘Return on an empty box starts no bare task, so its hint never names one.
 * A start refused after the card closed opens it again for the same purpose.
 */

/** ⌘Return: a bare task from a box with nothing in it. */
const BARE_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER };

/** Each purpose's head row title, before the repository's chip: drawn for an automation's, and named to a reader alone for a task's. */
const PURPOSE_HEADING = {
  [NEW_TASK_PURPOSE.TASK]: "New task",
  [NEW_TASK_PURPOSE.AUTOMATION]: "Create with an agent",
} as const satisfies Record<NewTaskPurpose, string>;

/** What each purpose's card asks for, calls its field, and calls its round button. */
const PURPOSE_WORDS = {
  [NEW_TASK_PURPOSE.TASK]: {
    placeholder: "Describe the task",
    label: "Task prompt",
    send: "Start agent",
  },
  [NEW_TASK_PURPOSE.AUTOMATION]: {
    placeholder: "Describe what to automate",
    label: "What to automate",
    send: "Start agent",
  },
} as const satisfies Record<NewTaskPurpose, ComposerWords>;

/** A task's card while its box holds nothing: the round button's hint names what ⌘Return does there. */
const BARE_WORDS: ComposerWords = {
  ...PURPOSE_WORDS[NEW_TASK_PURPOSE.TASK],
  send: `Start a ${TERM.TASK.one} with no ${TERM.AGENT.one}`,
  chord: BARE_CHORD,
};

/** Why an automation's agent did not start where the brief and the words pass an agent's first message's bound. */
const TOO_LONG = "That request is too long.";

/** Why the chip is held on a tree's card, whose tasks share the other's repository. */
const REPOSITORY_HELD = "A sub-task and its parent share one repository";

/** What the card says where the member's devices could not be read, with Retry, rather than starting the task in the cloud. */
const DEVICES_UNREAD: Failure = {
  reason: FAILURE_REASON.OTHER,
  text: `Couldn't read your devices, so ${PRODUCT_NAME} can't tell where this task should run.`,
};

/** The servers a card switches off as it opens: none, as an agent started with none named runs with every one on. */
const NONE_OFF: readonly string[] = [];

/** The repositories a card's default passes over as it opens: none, until a read leaves one out. */
const NONE_DROPPED: readonly string[] = [];

/** The devices Runs on offers before a read lists any: none, so it offers Cloud alone. */
const NO_DEVICES: readonly MacOffer[] = [];

/**
 * The refusals a card has put back into its box. Note that each goes in
 * once however often a card mounts on it, as strict mode mounts one twice,
 * because a second time would lay its words in again ahead of themselves.
 */
const PUT_BACK = new WeakSet<NewTaskRefusal>();

/** What one Agent-mode press asked beside its key: the task's repository and workspace, and where its agents run, and the agent's words, files, and the model picked, none for the account's default. */
interface AgentAsk {
  readonly repository: string | null;
  readonly workspaceId: string | undefined;
  /** The device the task's agents run on, by its id; none for the cloud. */
  readonly deviceId?: string | undefined;
  /** Where the start runs its agent, as Runs on said; none on an automation's card, which draws none. */
  readonly runsOn?: TaskRunsOnRequest | undefined;
  /** The relations the task starts in, in the order they were picked. */
  readonly relations: readonly TaskCreateRelation[];
  readonly agent: Omit<NewTaskAgent, "idempotencyKey">;
}

/** One Agent-mode press: what it asked, and the key and task id it carried. */
export interface NewTaskPress {
  readonly ask: AgentAsk;
  readonly key: string;
  readonly taskId: string;
  /** How many files it carried that a relaunch let go, which a Start must attach again to be this press; none where the window holds its files. */
  readonly filesLost?: number | undefined;
}

/** Where a start goes beside its agent: the task's repository, none for a tree's, its workspace and relations, and where its agents run. */
interface StartGoes {
  readonly repository: string | null;
  readonly workspaceId: string | undefined;
  readonly relations: readonly TaskCreateRelation[];
  readonly runsOn: TaskRunsOnRequest | undefined;
  readonly device: MacOffer | undefined;
}

/** The kept starts a card has said were settled, each said once however often a card mounts on it, as strict mode mounts one twice. */
const SETTLED = new Set<string>();

/** The press a draft kept, its files none, since storage keeps none, counted as lost where it carried some. */
function pressOfKept({ key, taskId, ask, files }: KeptStart): NewTaskPress {
  const { agent } = ask;

  return {
    key,
    taskId,
    ...(files === undefined ? undefined : { filesLost: files }),
    ask: {
      repository: ask.repository,
      workspaceId: ask.workspaceId,
      deviceId: ask.deviceId,
      runsOn: ask.runsOn,
      relations: ask.relations,
      agent: {
        prompt: agent.prompt,
        attachments: [],
        choice: agent.choice,
        disabledServers: agent.disabledServers,
        ...(agent.permissionMode === undefined
          ? undefined
          : { permissionMode: agent.permissionMode }),
      },
    },
  };
}

/** A draft with no start kept. */
function withoutStart(draft: Draft): Draft {
  return { ...draft, start: undefined };
}

/** A draft with the start under `key` let go, as its outcome is known; any other kept start stays. */
function settledUnder(key: string): (draft: Draft) => Draft {
  return (draft) => (draft.start?.key === key ? withoutStart(draft) : draft);
}

/**
 * A draft once a read settled its kept start: the start let go, and the words and files Edit took back
 * with it where the box still holds them as they were, since a Start of them would make the task again;
 * a box changed since keeps what it holds.
 */
function settledByRead(draft: Draft): Draft {
  const { start } = draft;

  const asTaken =
    start?.edited === true &&
    draft.text === start.words &&
    draft.attachments.length === (start.files ?? 0);

  return asTaken ? EMPTY_DRAFT : withoutStart(draft);
}

/** What the card says where a Start asks a kept start again without the files a relaunch let go. */
function filesAgain(files: number): Failure {
  return {
    reason: FAILURE_REASON.OTHER,
    text: `Attach this task's ${files === 1 ? "file" : `${files} files`} again to try it once more, or change its words to start another.`,
  };
}

/** An agent's press lets the box's words go and keeps whatever start stands kept, until its own outcome is known. */
function boxLetGo(draft: Draft): Draft {
  return { ...EMPTY_DRAFT, start: draft.start };
}

/**
 * A held press's ask as a press now is weighed against it: one pressed before the workspaces were read
 * named none, which the workspace read since is, so it is not taken for another start.
 */
function heldAsk(held: NewTaskPress, ask: AgentAsk): AgentAsk {
  return held.ask.workspaceId === undefined
    ? { ...held.ask, workspaceId: ask.workspaceId }
    : held.ask;
}

/** Whether a press asks what a held one asked, files aside: `sameAsk` with the press's own files in the held one's place. */
function asksAsHeldBarFiles(held: NewTaskPress, ask: AgentAsk): boolean {
  const was = heldAsk(held, ask);

  return sameAsk({ ...was, agent: { ...was.agent, attachments: ask.agent.attachments } }, ask);
}

/** Whether a press asks what a held one asked: as `sameAsk`, the files counted alone where a relaunch let the held press's go. */
function asksAsHeld(held: NewTaskPress, ask: AgentAsk): boolean {
  if (held.filesLost === undefined) return sameAsk(heldAsk(held, ask), ask);

  return ask.agent.attachments.length === held.filesLost && asksAsHeldBarFiles(held, ask);
}

/** Whether two presses ask the same: the same task, device, relations in the same order, words, files in the same order, model, servers switched off, and permission mode. */
function sameAsk(a: AgentAsk, b: AgentAsk): boolean {
  return (
    a.repository === b.repository &&
    a.workspaceId === b.workspaceId &&
    a.deviceId === b.deviceId &&
    a.relations.length === b.relations.length &&
    a.relations.every(
      (relation, index) =>
        relation.kind === b.relations[index]?.kind &&
        relation.taskId === b.relations[index]?.taskId,
    ) &&
    a.agent.prompt === b.agent.prompt &&
    a.agent.attachments.length === b.agent.attachments.length &&
    a.agent.attachments.every((file, index) => file === b.agent.attachments[index]) &&
    a.agent.choice?.model === b.agent.choice?.model &&
    a.agent.choice?.effort === b.agent.choice?.effort &&
    a.agent.choice?.contextWindow === b.agent.choice?.contextWindow &&
    a.agent.disabledServers.length === b.agent.disabledServers.length &&
    a.agent.disabledServers.every((server) => b.agent.disabledServers.includes(server)) &&
    a.agent.permissionMode === b.agent.permissionMode
  );
}

/** Whether two names are one repository, as GitHub spells it or not. */
function sameRepository(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The model chip's choice: what it shows, the chip's pick over the account's
 * default as the host holds it (`useAgentDefault`), and the pick alone,
 * which runs this one agent and leaves the default as it stands. Note that a
 * start names only the pick, because a start naming no model runs on the
 * default stored as it is pressed, which a default drawn here may trail.
 */
function useDefaultChoice(
  kept: ModelChoice | undefined,
): readonly [ModelChoice | undefined, ModelChoice | undefined, (next: ModelChoice) => void] {
  const [picked, setPicked] = useState<ModelChoice | undefined>(kept);
  const { choice } = useAgentDefault();

  return [picked ?? choice, picked, setPicked];
}

export function NewTaskComposer({
  newTask,
  workspaceId,
  onStarting,
  onLeave,
  focusedByOwner = false,
  takesFocus = true,
  titleId,
  listSide,
  purpose = NEW_TASK_PURPOSE.TASK,
  notices = NOTICE_LOOK.INSET,
}: {
  newTask: TasksControl["newTask"];
  /** The workspace the task starts in, the owner's to choose; none before the workspaces are read. */
  workspaceId: string | undefined;
  /** Hears whether a start is out, during which the owner holds what it draws around the card. */
  onStarting?: ((starting: boolean) => void) | undefined;
  /** What Escape in the field does where nothing in the card takes it. */
  onLeave: () => void;
  /** Whether the owner hands the words focus as the card first draws, as the dialog does; the words take it themselves otherwise. */
  focusedByOwner?: boolean;
  /** Whether the words take the caret as the card shows at all; none on a phone's Home, where the keyboard would cover the places bar. */
  takesFocus?: boolean;
  /** The id the head row's title stands under, which names the dialog's card. */
  titleId?: string | undefined;
  /** Which side of the caret's line an `@` or `/` list opens: over it in the dialog, under it on Home, whose card stands near the page's top, where a list risen over it is cut off under the page's head. */
  listSide: MentionMenuSide;
  /** What the card starts; a task's agent where none is named. */
  purpose?: NewTaskPurpose | undefined;
  /** How what holds a start is said: a line inside the card, as the dialog says it, or cards over it, as Home does, which also says the workspace has no repositories yet. */
  notices?: NoticeLook | undefined;
}): React.JSX.Element {
  const forAutomation = purpose === NEW_TASK_PURPOSE.AUTOMATION;
  const draft = useDraft(newTaskPlace(workspaceId, purpose));
  const { text: words, attachments } = draft.draft;
  // Words typed before the workspaces were read become the workspace's
  // draft once it is known, over one it kept, as the words written last win.
  const loose = useDraft(newTaskPlace(undefined, purpose)).draft;
  const writer = useDraftWriter();
  // Note that a start kept before then moves with them, or alone where there are none, so its Retry and its settling find it.
  useEffect(() => {
    if (workspaceId === undefined) return;

    if (hasWordsOrFiles(loose.text, loose.attachments)) {
      writer.update(newTaskPlace(workspaceId, purpose), (now) => ({
        ...loose,
        start: loose.start ?? now.start,
      }));
      writer.update(newTaskPlace(undefined, purpose), () => EMPTY_DRAFT);
    } else if (loose.start !== undefined) {
      const { start } = loose;
      writer.update(newTaskPlace(workspaceId, purpose), (now) => ({ ...now, start }));
      writer.update(newTaskPlace(undefined, purpose), withoutStart);
    }
  }, [workspaceId, loose, writer, purpose]);
  // A card opened again on a start refused after it closed starts where it was left, saying why.
  const refused = newTask.preset?.refused;
  // A card opened on a tree's relation starts on the other task's repository, which it keeps once the relation is removed.
  const presetRelation = newTask.preset?.relation;

  const [chosen, setChosen] = useState<string | null | undefined>(
    refused !== undefined
      ? refused.card.repository
      : presetRelation !== undefined && treeKind(presetRelation.kind)
        ? presetRelation.task.repository
        : newTask.preset?.repository,
  );

  const [choice, pickedModel, choose] = useDefaultChoice(refused?.card.choice);

  // The servers the + menu switched off, a refused card's as it was pressed.
  const [disabledServers, setDisabledServers] = useState<readonly string[]>(
    refused?.card.press.ask.agent.disabledServers ?? NONE_OFF,
  );

  // The mode the chip's Permissions row picked, a refused card's as it was pressed; none for the member's Default permissions.
  const [pickedMode, pickMode] = useState<AgentPermissionMode | undefined>(
    refused?.card.press.ask.agent.permissionMode,
  );

  const mode = useNewAgentPermissionMode({
    model: choice?.model,
    picked: pickedMode,
    choose: pickMode,
  });

  const openSettings = useOpenSettings();

  // Note that no agent has started, so the popover offers no Built in section (`luke`).
  const servers: AgentServersControl = {
    disabled: disabledServers,
    onSwitch: setDisabledServers,
    onOpenSettings: () => openSettings({ page: SETTINGS_VIEW.INTEGRATIONS }),
  };

  const starts = useAsyncAction<Failure>(rejectedFailure);
  const starting = starts.running;

  // The refusal a refused card opened on, said until a start or an edit lets it go; a start whose outcome is unknown is said by its kept press.
  const [handed, setHanded] = useState<Failure | undefined>(
    refused?.unknown === true ? undefined : refused?.note,
  );

  // A start whose outcome is unknown, kept with the draft until a read or its Retry settles it, said as
  // the answer that left it so where the card opened on it, and plainly after a relaunch, until Edit
  // takes its words back into the box.
  const keptStart = draft.draft.start;

  // Note that a kept start whose files this window does not hold says so, and offers Edit to attach them again rather than Retry without them.
  const keptNote = useMemo(
    () =>
      keptStart === undefined || keptStart.edited === true
        ? undefined
        : refused?.unknown === true && refused.card.press.key === keptStart.key
          ? refused.note
          : startUnknownNote(undefined, keptStart.files !== undefined),
    [keptStart, refused],
  );

  // Note that a kept start asked again is out while it is, so the card says nothing of it meanwhile.
  const note = starts.refusal ?? handed ?? (starting ? undefined : keptNote);

  // The relations the press that opened the card chose, or the refused card's, which the + menu and the rows change.
  const [related, setRelated] = useState<readonly NewTaskRelation[]>(
    refused?.card.relations ?? (presetRelation === undefined ? [] : [presetRelation]),
  );

  // The kind Task relation's search stands on, kept from one opening to the next.
  const [relationKind, setRelationKind] = useState<TaskCreateRelationKind>(
    TASK_CREATE_RELATION_KIND.SUB_TASK_OF,
  );

  const relationSearchId = useId();

  // Note that a relation names a task of the card's workspace, so a switch of workspace, as Home's, lets it go.
  const relations = forAutomation
    ? []
    : related.filter((each) => each.task.workspaceId === workspaceId);

  // Every tree relation's task shares one repository, the first's, which the chip is held to.
  const treeRelation = treeRelationOf(relations);
  const tree = treeRelation !== undefined;

  // A tree's relation set takes the other task's repository as the card's own, so the card keeps it once the relations are removed.
  const relate = (next: readonly NewTaskRelation[]) => {
    setRelated(next);
    const nextTree = treeRelationOf(next);

    if (nextTree !== undefined) setChosen(nextTree.task.repository);
  };

  // The workspace the card stands in now, whose draft a Put back pressed later writes to.
  const workspaceNow = useRef(workspaceId);
  workspaceNow.current = workspaceId;
  // A refused card opened again puts the words and files it was pressed with back ahead of what the box holds since;
  // one whose outcome is unknown keeps its press with the draft instead, leaving the box as it stands.
  // Note that the draft is found as the write lands, because the workspaces may be read after the card opened.
  useLayoutEffect(() => {
    if (refused === undefined || PUT_BACK.has(refused)) return;
    PUT_BACK.add(refused);
    const { words: pressedWords, press } = refused.card;

    // Note that the flow kept it as it heard it (`use-new-task.ts`); the card keeps it again as it opens on it, the same.
    if (refused.unknown === true) {
      writer.update(newTaskPlace(workspaceNow.current, purpose), (now) => ({
        ...now,
        start: keptStartOf(press, pressedWords),
      }));

      return;
    }

    // Note that a kept start the service refused is settled, its words coming back below.
    writer.update(newTaskPlace(workspaceNow.current, purpose), settledUnder(press.key));

    putBackRefused({
      went: { text: pressedWords, attachments: press.ask.agent.attachments },
      most: AGENT_BOUNDS.MAX_MESSAGE_CHARS,
      update: (next) =>
        writer.update(newTaskPlace(workspaceNow.current, purpose), (now) => {
          const joined = next(now);

          return joined === undefined ? now : { ...now, ...joined };
        }),
    });
  }, []);
  // The last agent press's key and what it asked, until a start lands.
  const pressed = useRef<NewTaskPress | undefined>(refused?.card.press);
  const repositories = newTask.repositoriesIn(workspaceId);
  const workspace = newTask.workspaces.find((each) => each.id === workspaceId);

  // Task relation offers the tasks of the card's workspace.
  const relatable = useMemo(
    () => newTask.tasks.filter((each) => each.workspaceId === workspaceId),
    [newTask.tasks, workspaceId],
  );

  // Runs on stands on every card but an automation's agent's.
  const runsOnStands = !forAutomation;
  // Note that the devices are read as the card opens rather than when the
  // model chip first draws, which waits on the default's read, so Start is held for as short as can be.
  const readModels = useRef(newTask.readModels);
  readModels.current = newTask.readModels;
  useEffect(() => {
    if (runsOnStands) readModels.current();
  }, [runsOnStands]);
  const devices = (runsOnStands ? newTask.devices : undefined) ?? NO_DEVICES;
  const [device, chooseDevice, keptDevice] = useNewTaskRunsOn(devices);
  // Start is held until a read made since the card opened lands, where the member's last pick is a
  // device, since a start before then would name none. Note that a pick of the cloud, every member's
  // with no device among them, holds nothing, because a start before the read runs in the cloud as
  // the pick would after it; that a list read before the card opened does not count, because it may
  // be one read before a device was added, and a failed read leaves it standing; and that a read is
  // told by the generation it took, never by its list, which a read listing the same devices hands
  // back as it was.
  const { modelsRead } = newTask;
  const [readAsOpened] = useState(modelsRead.generation);
  const readSinceOpened = modelsRead.generation > readAsOpened;
  const [devicesLanded, setDevicesLanded] = useState(false);

  if (!devicesLanded && readSinceOpened && modelsRead.state === MODELS_READ.READ) {
    setDevicesLanded(true);
  }

  const devicesUnread = runsOnStands && keptDevice && !devicesLanded;
  const devicesFailed = devicesUnread && readSinceOpened && modelsRead.state === MODELS_READ.FAILED;
  // Note that a card whose chip says Cloud names the cloud, because the service keeps the pick as where the tasks an agent makes for the member run.
  const runsOn = runsOnStands ? newTaskRunsOn(device) : undefined;
  // The repositories the chip's last read listed, an App's and a member's token's alike.
  const [listed, setListed] = useState<readonly string[] | undefined>(undefined);
  // The repositories a read did not list, which the default passes over from then on.
  const [dropped, setDropped] = useState<readonly string[]>(NONE_DROPPED);
  // A repository picked in one workspace is none of another's,
  // so the owner's switch, as Home's, lets it go, in the render that brings it; the scope first
  // resolving keeps a pick made before the workspaces were read.
  const [scope, setScope] = useState(repositories.scope);

  if (repositories.scope !== scope) {
    setListed(undefined);

    if (scope !== undefined) {
      setChosen(undefined);
      setDropped(NONE_DROPPED);
    }

    setScope(repositories.scope);
  }

  const isListed = (name: string) =>
    listed === undefined || listed.some((each) => sameRepository(each, name));

  const kept = (name: string) => !dropped.some((each) => sameRepository(each, name));

  // Note that a null chosen is No repository picked, and an undefined one is no pick yet, which
  // falls to the newest recent repository still kept, then to the first the read lists.
  const fallback =
    repositories.recent.find((each) => kept(each) && isListed(each)) ?? listed?.find(kept) ?? null;

  const candidate = chosen === undefined ? fallback : chosen;
  // A pick, a preset, or the recent default a read does not list is dropped, so a later read
  // listing it does not bring it back and the default falls to the next; a read made before the
  // workspace resolved, or for the one before a switch still under way, judges none.
  const judged = repositories.scope !== undefined && repositories.scope === scope;

  const drop = (name: string) => {
    setDropped((was) => (was.some((each) => sameRepository(each, name)) ? was : [...was, name]));
    setChosen(undefined);
  };

  const unlisted = [candidate, ...repositories.recent].filter(
    (each): each is string => each !== null && kept(each) && !isListed(each),
  );

  if (judged && unlisted.length > 0) {
    setDropped([...dropped, ...unlisted]);

    if (chosen !== undefined && chosen !== null) setChosen(undefined);
  }

  // Note that a repository is not started on before the read lands unless
  // the workspace's GitHub reaches it, because the service would refuse it.
  const picked =
    candidate !== null &&
    (!isListed(candidate) ||
      (listed === undefined && workspace !== undefined && !workspaceReaches(workspace, candidate)))
      ? null
      : candidate;

  // A tree's two tasks work in one repository, the other task's, which the chip is held to.
  const repository = treeRelation === undefined ? picked : treeRelation.task.repository;
  const said = words.trim();
  // Note that an automation's agent starts on words alone, since the brief fences them as the request, and a file's marker is no words of the request's.
  const requested = wordsWithoutMarkers(said).trim() !== "";
  const filled = forAutomation ? requested : hasWordsOrFiles(said, attachments);

  // An agent needs something to work on, words or files, and works in no repository where none is chosen.
  // Note that an agent nothing of the account's pays for is held here, with the press that connects one, rather than refused once pressed; a bare task needs none.
  const unpaid =
    newTask.models === undefined || choice === undefined
      ? undefined
      : unrunnableChoice(newTask.models, choice);

  const canStart = !devicesUnread && unpaid === undefined && filled;
  // What an `@` and a `/` offer: the chosen repository's, read through the workspace, as on an agent's page no task holds.
  const readMentionAgents = useMentionAgentsReader(workspaceId, newTask.tasks, newTask.models);
  const reader = useMentionedReader();
  const slug = workspace?.slug;
  const { onShowMention } = newTask;

  const mentions = useMemo(
    () =>
      workspaceId === undefined
        ? undefined
        : tasklessMentions(
            { workspace: slug ?? workspaceId, workspaceId, repository },
            onShowMention,
            readMentionAgents,
          ),
    [workspaceId, slug, repository, onShowMention, readMentionAgents],
  );

  // A `/` offers no skill while the Skills experiment is off.
  const queryClient = useQueryClient();

  const skillsOn =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.SKILLS) }).data === true;

  const skills = useMemo(
    () =>
      workspaceId === undefined || !skillsOn
        ? undefined
        : keptSkills(() =>
            queryClient.fetchQuery(
              repositorySkillsQueryOptions(
                repository === null ? { workspaceId } : { workspaceId, repository },
              ),
            ),
          ),
    [queryClient, workspaceId, repository, skillsOn],
  );

  // A skill's chip opens its `SKILL.md` on GitHub, as on an agent's page no task holds, since no File tab stands here.
  const openSkill = (skill: SkillWithFile) => {
    if (mentions === undefined || repository === null) return;
    appPlatform().openGitHub(
      encodeMention({ kind: MENTION_KIND.FILE, path: skill.path }, mentions.doors.place),
    );
  };

  // Note that a tree's start names no repository, because the service gives it the other task's.
  const goesNow = (): StartGoes => ({
    repository: tree ? null : repository,
    workspaceId,
    relations: relationsAsked(relations),
    runsOn,
    device,
  });

  const begin = (
    handing: Pick<NewTaskStart, "handed" | "card" | "taskId"> = {},
    goes: StartGoes = goesNow(),
    letGo: (was: Draft) => Draft = boxLetGo,
  ) => {
    if (devicesUnread) return;
    void starts.run(() => {
      onStarting?.(true);
      setHanded(undefined);
      // Note that an agent's start lets its words go as it is pressed, because the card closes at
      // once and a New task opened before the service answers must open empty; a refused card
      // opened again brings its own words back (`refused.card.words`). A kept start stays until its
      // own outcome is known, so a relaunch meanwhile keeps its key, and one asked again leaves the
      // box's words alone, being none of its.
      const agentStart = handing.handed !== undefined;
      const key = handing.handed?.idempotencyKey;

      if (agentStart) draft.update(letGo);

      return newTask
        .start("", goes.repository, goes.workspaceId, {
          ...(goes.runsOn === undefined ? undefined : { runsOn: goes.runsOn }),
          ...(goes.device === undefined ? undefined : { device: goes.device }),
          ...(goes.relations.length === 0 ? undefined : { relations: goes.relations }),
          ...handing,
        })
        .then((refused) => {
          if (refused === undefined) {
            // A task started lets its words go, so the next New task opens empty, and a start kept under its key.
            pressed.current = undefined;

            if (!agentStart) draft.update(() => EMPTY_DRAFT);
            else if (key !== undefined) draft.update(settledUnder(key));
          }

          return refused;
        })
        .finally(() => onStarting?.(false));
    });
  };

  const start = () => {
    if (!canStart) return;
    const prompt = forAutomation ? automationAgentBrief(said) : said;

    if (forAutomation && prompt.length > AGENT_BOUNDS.MAX_MESSAGE_CHARS) {
      starts.refuse({ reason: FAILURE_REASON.OTHER, text: TOO_LONG });

      return;
    }

    const ask: AgentAsk = {
      repository,
      workspaceId,
      deviceId: device?.deviceId,
      runsOn,
      relations: relationsAsked(relations),
      agent: {
        prompt,
        attachments,
        choice: pickedModel,
        disabledServers,
        ...(pickedMode === undefined ? undefined : { permissionMode: pickedMode }),
      },
    };

    // Note that a press asking what a kept start asked is that start again, after a relaunch too, and
    // that one asking it without the files a relaunch let go is held, since a new key could make the
    // task again.
    const held = pressed.current ?? (keptStart === undefined ? undefined : pressOfKept(keptStart));

    if (
      held?.filesLost !== undefined &&
      ask.agent.attachments.length !== held.filesLost &&
      asksAsHeldBarFiles(held, ask)
    ) {
      starts.refuse(filesAgain(held.filesLost));

      return;
    }

    const press: NewTaskPress =
      held !== undefined && asksAsHeld(held, ask)
        ? { ask, key: held.key, taskId: held.taskId }
        : { ask, key: crypto.randomUUID(), taskId: crypto.randomUUID() };

    pressed.current = press;
    begin({
      handed: { idempotencyKey: press.key, ...ask.agent },
      taskId: press.taskId,
      card: {
        ...(forAutomation ? { purpose } : undefined),
        relations,
        repository,
        choice: pickedModel,
        press,
        words,
      },
    });
  };

  // A kept start's press: this window's where it pressed it, its files among it, else as the draft kept it.
  const keptPressOf = (start: KeptStart): NewTaskPress =>
    pressed.current?.key === start.key ? pressed.current : pressOfKept(start);

  // A kept start asked again goes as it was pressed, under its key and task id, whatever the card holds
  // now, its files this window's where it pressed it, and the relations it names that the window lists.
  // The relations a kept press names that the window lists, as the card draws them.
  const listedRelations = (asked: readonly TaskCreateRelation[]): NewTaskRelation[] =>
    asked.flatMap((relation) => {
      const task = newTask.tasks.find((each) => each.id === relation.taskId);

      return task === undefined ? [] : [{ kind: relation.kind, task }];
    });

  const resend = (start: KeptStart) => {
    const press = keptPressOf(start);
    const { ask } = press;
    pressed.current = press;
    const cardRelations = listedRelations(ask.relations);

    begin(
      {
        handed: { idempotencyKey: press.key, ...ask.agent },
        taskId: press.taskId,
        card: {
          ...(forAutomation ? { purpose } : undefined),
          relations: cardRelations,
          repository: ask.repository,
          choice: ask.agent.choice,
          press,
          words: start.words,
        },
      },
      {
        repository: ask.relations.some((relation) => treeKind(relation.kind))
          ? null
          : ask.repository,
        workspaceId: ask.workspaceId,
        relations: ask.relations,
        runsOn: ask.runsOn,
        device: devices.find((each) => each.deviceId === ask.deviceId),
      },
      (was) => was,
    );
  };

  // Edit takes a kept start's words, and its files where this window pressed it, back into the box
  // ahead of what it holds, keeping the press marked so, so a Start of them unchanged is still that
  // start, after a relaunch too, and words changed are another; Remove lets it go.
  // Note that the card's chips stand again as the press asked, after a relaunch too, so a Start of the
  // words unchanged asks the same.
  const editKept = (start: KeptStart) => {
    const held = keptPressOf(start);
    const { ask } = held;
    pressed.current = held;
    setChosen(ask.repository);
    setRelated(listedRelations(ask.relations));
    setDisabledServers(ask.agent.disabledServers);
    pickMode(ask.agent.permissionMode);

    if (ask.agent.choice !== undefined) choose(ask.agent.choice);

    if (runsOnStands) chooseDevice(ask.deviceId);

    draft.update((was) => ({
      ...was,
      ...joinedAhead({ text: start.words, attachments: held.ask.agent.attachments }, was),
      start: { ...start, edited: true },
    }));
  };

  const removeKept = (start: KeptStart) => {
    draft.update(withoutStart);

    if (pressed.current?.key === start.key) pressed.current = undefined;
  };

  // A kept start the window's tasks now list, an agent at work on it, made its task and its agent: the
  // card lets it go and says so, with Open. Note that a start out holds it, since the task it is making
  // is drawn in the list as it is asked, and that a task listed with no agent keeps it, since its Retry
  // starts the agent the task was made for under its key.
  const keptLanded =
    keptStart !== undefined &&
    !starting &&
    newTask.tasks.some((task) => task.id === keptStart.taskId && (task.agents?.total ?? 0) > 0);

  const settledTaskId = keptLanded ? keptStart.taskId : undefined;
  const settle = useRef({ said: newTask.onStartSettled, letGo: draft.update });
  settle.current = { said: newTask.onStartSettled, letGo: draft.update };
  useEffect(() => {
    if (settledTaskId === undefined) return;
    settle.current.letGo(settledByRead);

    if (pressed.current?.taskId === settledTaskId) pressed.current = undefined;

    if (SETTLED.has(settledTaskId)) return;
    SETTLED.add(settledTaskId);
    settle.current.said(settledTaskId);
  }, [settledTaskId]);

  // ⌘Return on a box with nothing in it starts a bare task: no call and no agent.
  const bare = () => begin();
  const startsBare = !forAutomation && !filled;

  const onKey = (event: KeyboardEvent): boolean => {
    if (!shortcutMatches(BARE_CHORD, event)) return false;

    if (filled) start();
    else if (!forAutomation) bare();

    return true;
  };

  const repositoryChip = (
    <RepositoryChip
      key={repositories.scope}
      place={CHIP_PLACE.FIELD}
      width={CHIP_WIDTH.AUTO}
      align={POPOVER_ALIGN.START}
      value={repository}
      chooser={repositories}
      onChoose={setChosen}
      onUnreached={judged && repository !== null ? () => drop(repository) : undefined}
      onClear={tree ? undefined : () => setChosen(null)}
      onListed={setListed}
      pending={!tree && chosen !== null && repository === null}
      held={tree ? REPOSITORY_HELD : undefined}
    />
  );

  const composer: AgentComposerControl = {
    draft: words,
    // Note that the words handed back as they stand, as the field echoes the words a refused card opens on, take no note down.
    setDraft: (text) => {
      if (text === words) return;
      draft.update((was) => ({ ...was, text }));
      setHanded(undefined);
      starts.clear();
    },
    attachments,
    setAttachments: (next) =>
      draft.update((was) => ({ ...was, attachments: next(was.attachments) })),
    sending: starting,
    // Note that a read of the devices that failed is said over any note before it, and read again by its Retry.
    note: devicesFailed ? DEVICES_UNREAD : note,
    closed: undefined,
    send: start,
    retry: devicesFailed
      ? () => readModels.current()
      : keptNote !== undefined && note === keptNote && keptStart !== undefined
        ? () => resend(keptStart)
        : start,
    noteActs:
      !devicesFailed && keptNote !== undefined && note === keptNote && keptStart !== undefined
        ? {
            edit: () => editKept(keptStart),
            remove: () => removeKept(keptStart),
            retries: keptPressOf(keptStart).filesLost === undefined,
          }
        : undefined,
    sent: [],
  };

  // A task's card relates its task to others from the + menu's Task relation, an automation's to none.
  const relationControl: NewTaskRelations = {
    relations,
    tasks: relatable,
    workspaceName: workspace?.name ?? "",
    repository,
    disabled: starting,
    onChange: relate,
  };

  const relationPlus = forAutomation
    ? undefined
    : [relationMenuPanel(relationSearchId, relationControl, relationKind, setRelationKind)];

  const agentNotice =
    unpaid === undefined || newTask.models === undefined ? null : (
      <ConnectAgentBanner models={newTask.models} unpaid={unpaid} look={notices} />
    );

  const carded = notices === NOTICE_LOOK.CARD;

  const card = (
    <div className="new-task-composer flex min-w-0 flex-col gap-control-gap">
      {/* Note that Home's cards stand over the head row, the agent's first, since it holds Start and a repository does not. */}
      {carded ? (
        <div className="new-task-notices mb-control-gap flex min-w-0 flex-col gap-control-gap empty:hidden">
          {agentNotice}
          <NoRepositoriesBanner chooser={repositories} />
        </div>
      ) : null}
      <div className="new-task-head flex min-w-0 flex-wrap items-center gap-item-gap">
        <div className="new-task-title flex min-w-0 max-w-full items-center gap-item-gap">
          {forAutomation ? (
            <Text
              variant={TEXT_VARIANT.DIALOG}
              as={TEXT_ELEMENT.H2}
              id={titleId}
              className="max-w-new-task-title shrink-0"
            >
              {PURPOSE_HEADING[purpose]}
            </Text>
          ) : (
            <VisuallyHidden id={titleId}>{PURPOSE_HEADING[purpose]}</VisuallyHidden>
          )}
          {repositoryChip}
        </div>
      </div>
      {relations.length === 0 ? null : (
        <div className={`new-task-relations-dock ${COMPOSER_DOCK_CLASS}`}>
          <NewTaskRelationRows control={relationControl} />
        </div>
      )}
      {carded ? null : agentNotice}
      <AgentComposer
        status={AGENT_STATUS.STARTING}
        composer={composer}
        wording={startsBare ? BARE_WORDS : PURPOSE_WORDS[purpose]}
        // Note that an automation's agent is held without words, since its brief fences them as the request, files alone saying none.
        sendable={
          !devicesUnread && (startsBare || unpaid === undefined) && (!forAutomation || requested)
        }
        model={choice === undefined ? undefined : { choice, note: undefined, choose }}
        models={newTask.models}
        modelsFailed={newTask.modelsFailed}
        readModels={newTask.readModels}
        usage={undefined}
        mode={mode}
        servers={servers}
        plus={relationPlus}
        skills={skills}
        onStop={() => Promise.resolve(false)}
        followsUp={false}
        onKey={onKey}
        onLeave={onLeave}
        focusedByOwner={focusedByOwner}
        takesFocus={takesFocus}
        listSide={listSide}
        tools={
          runsOnStands
            ? (narrow) => (
                <NewTaskRunsOnChip
                  devices={devices}
                  device={device}
                  disabled={starting}
                  narrow={narrow}
                  onChoose={chooseDevice}
                />
              )
            : undefined
        }
      />
    </div>
  );

  // Note that the card stands under the providers with or without a repository, so one chosen or let go keeps the card mounted.
  return (
    <MemberDirectory workspace={workspace} readerId={reader}>
      <TaskMentions value={mentions}>
        <SkillFiles source={skills} onOpen={openSkill}>
          {card}
        </SkillFiles>
      </TaskMentions>
    </MemberDirectory>
  );
}
