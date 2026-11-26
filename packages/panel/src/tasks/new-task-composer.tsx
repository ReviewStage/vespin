import type { AgentPermissionMode } from "@repo/features/agent-approval-wire";
import { AGENT_BOUNDS, AGENT_STATUS, hasWordsOrFiles } from "@repo/features/agent-wire";
import {
  automationAgentBrief,
  CREATE_WITH_AGENT_WORDS,
} from "@repo/features/automation-agent-brief";
import { FAILURE_REASON, type Failure, rejectedFailure } from "@repo/features/failure-remedy";
import { wordsWithoutMarkers } from "@repo/features/file-marker";
import { encodeMention, MENTION_KIND } from "@repo/features/mention-link";
import type { MacOffer, ModelChoice } from "@repo/features/models-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import type { TaskSection } from "@repo/features/task-section-wire";
import { REMOVE_FROM_SECTION } from "@repo/features/task-sections-model";
import { TASK_CREATE_RELATION_KIND, type TaskCreateRelationKind } from "@repo/features/task-wire";
import { TERM } from "@repo/features/words";
import { EXPERIMENT } from "@repo/settings";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { SHORTCUT_KEY, type ShortcutChord, shortcutMatches } from "@repo/settings/shortcuts";
import {
  CHIP_LOOK,
  CHIP_WIDTH,
  Chip,
  ChipName,
  POPOVER_ALIGN,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  VisuallyHidden,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useAsyncAction } from "@repo/ui/use-async-action";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAgentDefault } from "../account-choices.js";
import { appPlatform } from "../app-platform.js";
import {
  DRAFT_PLACE,
  type Draft,
  type DraftPlace,
  EMPTY_DRAFT,
  useDraft,
  useDraftBeside,
  useDraftWords,
  useDraftWriter,
} from "../composer-drafts.js";
import { sectionGlyph } from "../desktop/section-icon-picker.js";
import { MemberDirectory } from "../member-directory.js";
import { useOpenSettings } from "../open-settings.js";
import { useRelatableTasks } from "../task-list-collections.js";
import { appStateQuery, selectExperiment, selectNewAgentServersOff } from "../use-app-state.js";
import type { CallWhenStarted } from "../voice-call.js";
import { useNewAgentPermissionMode } from "./agent-approvals.js";
import { AgentComposer, COMPOSER_DOCK_CLASS, type ComposerWords } from "./agent-composer.js";
import { modelsRunOn, unrunnableChoice } from "./agent-model.js";
import { repositorySkillsQueryOptions } from "./agent-reads.js";
import type { AgentServersControl } from "./agent-servers.js";
import { useWordsOf } from "./box-words.js";
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
import { heldUpdateOver, putBackRefused } from "./refused-send.js";
import { CHIP_PLACE, RepositoryChip } from "./repository-chip.js";
import { useRepositoryDefault } from "./repository-default.js";
import { keptSkills } from "./repository-skills.js";
import {
  deviceOfPlace,
  NewTaskRunsOnChip,
  newTaskRunsOn,
  placeIdOf,
  useDevicesRead,
  useNewTaskRunsOn,
  useOwnedMachines,
} from "./runs-on.js";
import { SkillFiles } from "./skill-chip.js";
import type { SkillWithFile } from "./skill-ref.js";
import { TaskMentions, useTasklessMentions } from "./task-mentions.js";
import type { AgentComposerControl } from "./use-agent-composer.js";
import {
  type AgentAsk,
  type NewTaskPreset,
  type NewTaskPress,
  type NewTaskRefusal,
  type NewTaskStart,
  useNewTaskShown,
} from "./use-new-task.js";
import { useTaskSections } from "./use-pin-writes.js";
import type { TasksControl } from "./use-tasks-tab.js";

/**
 * new-task-composer.tsx -- New task's composer card: the words a coding agent starts on, and the chips that say where and how the task starts.
 *
 * The card is the agent box's own (`agent-composer.tsx`): the words field,
 * the "+", which raises a menu of Attachment, which attaches files, with an
 * image pasted or files dropped taken too, MCP servers, which opens the
 * servers popover beside the menu (`agent-servers.tsx`), and, on a task's
 * card, Task relation, which opens the task search beside it
 * (`new-task-relation.tsx`), dictation, the model chip, which `/model` opens as in an agent's box, and the round Start agent button,
 * which stays at the row's end in the card: where the card is too narrow,
 * as on a phone, the model chip's words are cut short instead.
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
 * default afresh. A Start on words opens no call. Talk, in the round
 * button's place while the box is empty, starts the task and its agent
 * blank, handed nothing, on the card's chips, opens the task on the agent's
 * tab as any start does, and calls the agent once it lands, so its first
 * words are the caller's (`agent-talk.tsx`); a call that ends with nothing
 * said lets the agent and its empty task go. An automation's card offers no
 * Talk.
 *
 * An agent's start carries a key the card mints, and a press asking the
 * same again, as Retry after a start the service never answered does,
 * carries the same key, so a service that made the task and its agent
 * answers them rather than a second pair; a press asking anything else,
 * other servers among it, mints another, and so does the card mounted afresh.
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
 * out opens empty, and a refused card opened again brings its own words
 * and files back ahead of whatever was written there since
 * (`refused-send.ts`). The card holds its own repository and model, so the owner
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
 * A section's + and its menu's New task open the card on that section of
 * the account's, drawn as a chip beside the repository's whose × lets it go;
 * the start files the task on top of it (`use-new-task.ts`), and a refused
 * card opened again keeps it. A plain New task draws no such chip. The
 * section is the card's workspace's, so a switch of workspace, as Home's,
 * lets it go.
 *
 * The Automations page's Create with an agent opens this same card for the
 * agent that makes an automation (`NEW_TASK_PURPOSE.AUTOMATION`), so making
 * one looks and works as starting any agent does. Its title and placeholder
 * say so, its words are kept as a draft of their own, and the agent is handed
 * the fixed brief with the words fenced after it (`@repo/features/automation-agent-brief`),
 * refused here where that would pass an agent's first message's bound. It
 * starts on words alone, and
 * ⌘Return on an empty box starts no bare task, so its hint never names one.
 * A start refused after the card closed opens it again for the same purpose.
 */

/** ⌘Return: a bare task from a box with nothing in it. */
const BARE_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER };

/** Each purpose's head row title, before the repository's chip: drawn for an automation's, and named to a reader alone for a task's; a phone's sheet draws it in its own head (`titledByOwner`). */
export const PURPOSE_HEADING = {
  [NEW_TASK_PURPOSE.TASK]: "New task",
  [NEW_TASK_PURPOSE.AUTOMATION]: CREATE_WITH_AGENT_WORDS.TITLE,
} as const satisfies Record<NewTaskPurpose, string>;

/** What each purpose's card asks for, calls its field, and calls its round button. */
const PURPOSE_WORDS = {
  [NEW_TASK_PURPOSE.TASK]: {
    placeholder: "Describe the task",
    label: "Task prompt",
    send: "Start agent",
  },
  [NEW_TASK_PURPOSE.AUTOMATION]: {
    placeholder: CREATE_WITH_AGENT_WORDS.PLACEHOLDER,
    label: CREATE_WITH_AGENT_WORDS.LABEL,
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
const TOO_LONG = CREATE_WITH_AGENT_WORDS.TOO_LONG;

/** Why the chip is held on a tree's card, whose tasks share the other's repository. */
const REPOSITORY_HELD = "A sub-task and its parent share one repository";

/** What the card says where the member's devices could not be read, with Retry, rather than starting the task in the cloud. */
const DEVICES_UNREAD: Failure = {
  reason: FAILURE_REASON.OTHER,
  text: `Couldn't read your devices, so ${PRODUCT_NAME} can't tell where this task should run.`,
};

/** The servers a card switches off as it opens: none, as an agent started with none named runs with every one on. */
const NONE_OFF: readonly string[] = [];

/** The devices Runs on offers before a read lists any: none, so it offers Cloud alone. */
const NO_DEVICES: readonly MacOffer[] = [];

/**
 * The refusals a card has put back into its box. Note that each goes in
 * once however often a card mounts on it, as strict mode mounts one twice,
 * because a second time would lay its words in again ahead of themselves.
 */
const PUT_BACK = new WeakSet<NewTaskRefusal>();

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
    sameServers(a.agent.disabledServers, b.agent.disabledServers) &&
    a.agent.permissionMode === b.agent.permissionMode
  );
}

/** Whether two asks switched the same servers off, or both switched none. */
function sameServers(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;

  return a.length === b.length && a.every((server) => b.includes(server));
}

/** A card's draft place: its purpose's, in its workspace, none before the workspaces are read. */
function newTaskPlace(workspaceId: string | undefined, purpose: NewTaskPurpose): DraftPlace {
  const kind =
    purpose === NEW_TASK_PURPOSE.AUTOMATION ? DRAFT_PLACE.NEW_AUTOMATION : DRAFT_PLACE.NEW_TASK;

  return { kind, workspaceId: workspaceId ?? null };
}

/** The section a card files its task in, its icon and name, whose × files it in none. */
function SectionChip({
  section,
  onRemove,
}: {
  section: TaskSection;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <Chip look={CHIP_LOOK.FIELD} onRemove={onRemove} removeLabel={REMOVE_FROM_SECTION}>
      {sectionGlyph(section.icon) ?? <GLYPH.SECTION />}
      <ChipName>
        <ReplayMask>{section.title}</ReplayMask>
      </ChipName>
    </Chip>
  );
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
  preset,
  workspaceId,
  onStarting,
  onLeave,
  focusedByOwner = false,
  takesFocus = true,
  titleId,
  titledByOwner = false,
  listSide,
  purpose = NEW_TASK_PURPOSE.TASK,
  notices = NOTICE_LOOK.INSET,
}: {
  newTask: TasksControl["newTask"];
  /** What the press that opened the card chose, or the start refused that it opens again on (`NewTaskShown.preset`); none for a card opened bare. */
  preset?: NewTaskPreset | undefined;
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
  /** Whether the owner draws the purpose's title in a head of its own, as a phone's sheet does, so the head row draws none. */
  titledByOwner?: boolean | undefined;
  /** Which side of the caret's line an `@` or `/` list opens: over it in the dialog, under it on Home, whose card stands near the page's top, where a list risen over it is cut off under the page's head. */
  listSide: MentionMenuSide;
  /** What the card starts; a task's agent where none is named. */
  purpose?: NewTaskPurpose | undefined;
  /** How what holds a start is said: a line inside the card, as the dialog says it, or cards over it, as Home does, which also says the workspace has no repositories yet. */
  notices?: NoticeLook | undefined;
}): React.JSX.Element {
  const forAutomation = purpose === NEW_TASK_PURPOSE.AUTOMATION;
  // Note that the card reads its draft without the words, which the box reads where it stands and a press reads as it is pressed, so a word typed draws neither the card nor its chips.
  const draft = useDraftBeside(newTaskPlace(workspaceId, purpose));
  const typed = useDraftWords(newTaskPlace(workspaceId, purpose));
  const { attachments } = draft.draft;
  // Words typed before the workspaces were read become the workspace's
  // draft once it is known, over one it kept, as the words written last win.
  const loose = useDraft(newTaskPlace(undefined, purpose)).draft;
  const writer = useDraftWriter();
  useEffect(() => {
    if (workspaceId === undefined || !hasWordsOrFiles(loose.text, loose.attachments)) return;
    writer.update(newTaskPlace(workspaceId, purpose), () => loose);
    writer.update(newTaskPlace(undefined, purpose), () => EMPTY_DRAFT);
  }, [workspaceId, loose, writer, purpose]);
  // A card opened again on a start refused after it closed starts where it was left, saying why.
  const refused = preset?.refused;
  // A card opened on a tree's relation starts on the other task's repository, which it keeps once the relation is removed.
  const presetRelation = preset?.relation;

  const repositories = newTask.repositoriesIn(workspaceId);
  const workspace = newTask.workspaces.find((each) => each.id === workspaceId);

  const repositoryDefault = useRepositoryDefault(
    repositories,
    workspace,
    refused !== undefined
      ? refused.card.repository
      : presetRelation !== undefined && treeKind(presetRelation.kind)
        ? presetRelation.task.repository
        : preset?.repository,
  );

  const { chosen, choose: setChosen } = repositoryDefault;

  const [choice, pickedModel, choose] = useDefaultChoice(refused?.card.choice);

  // The section the press that opened the card chose, or the refused card's, which the chip's × lets go.
  const [sectionId, setSectionId] = useState<string | undefined>(
    refused !== undefined ? refused.card.sectionId : preset?.sectionId,
  );

  // A section is the card's workspace's, so the owner's switch, as Home's, lets it go for good, in the render that
  // brings it; the workspace first resolving keeps one chosen before the workspaces were read.
  const [sectionScope, setSectionScope] = useState(workspaceId);

  if (workspaceId !== sectionScope) {
    if (sectionScope !== undefined) setSectionId(undefined);
    setSectionScope(workspaceId);
  }

  const sections = useTaskSections();

  // Note that a section deleted meanwhile, or another workspace's, files nothing.
  const section = forAutomation
    ? undefined
    : sections.sections.find((each) => each.id === sectionId && each.workspaceId === workspaceId);

  // The servers the + menu switched off, a refused card's as it was pressed; none until switched, when the account's choice for new agents stands.
  const [disabledServers, setDisabledServers] = useState<readonly string[] | undefined>(
    refused?.card.press.ask.agent.disabledServers,
  );

  const { data: newAgentServersOff = NONE_OFF } = useQuery({
    ...appStateQuery,
    select: selectNewAgentServersOff,
  });

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

  // Note that no agent has started, so the popover offers no Built in section.
  const servers: AgentServersControl = {
    disabled: disabledServers ?? newAgentServersOff,
    onSwitch: setDisabledServers,
    onOpenSettings: () => openSettings({ page: SETTINGS_VIEW.INTEGRATIONS }),
  };

  const starts = useAsyncAction<Failure>(rejectedFailure);
  const starting = starts.running;
  // The refusal a refused card opened on, said until a start or an edit lets it go.
  const [handed, setHanded] = useState<Failure | undefined>(refused?.note);
  const note = starts.refusal ?? handed;

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
  // A refused card opened again puts the words and files it was pressed with back ahead of what the box holds since.
  // Note that the draft is found as the write lands, because the workspaces may be read after the card opened.
  useLayoutEffect(() => {
    if (refused === undefined || PUT_BACK.has(refused)) return;
    PUT_BACK.add(refused);
    const { words: kept, press } = refused.card;
    putBackRefused({
      went: { text: kept, attachments: press.ask.agent.attachments },
      most: AGENT_BOUNDS.MAX_MESSAGE_CHARS,
      update: heldUpdateOver<Draft>((next) =>
        writer.update(newTaskPlace(workspaceNow.current, purpose), next),
      ),
    });
  }, []);
  // The last agent press's key and what it asked, until a start lands.
  const pressed = useRef<NewTaskPress | undefined>(refused?.card.press);
  // Task relation offers the tasks of the card's workspace, in the sidebar's order.
  const relatable = useRelatableTasks(newTask.typedNames, workspaceId);

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
  const owned = useOwnedMachines(runsOnStands ? workspaceId : undefined);
  const [place, choosePlace, keptDevice] = useNewTaskRunsOn(devices, owned);
  const device = deviceOfPlace(place);

  // Start is held until a read made since the card opened lands, where the member's last pick is a device (`useDevicesRead`).
  const { modelsRead } = useNewTaskShown();

  const { unread: devicesUnread, failed: devicesFailed } = useDevicesRead(
    modelsRead,
    runsOnStands && keptDevice,
  );

  // Note that a model nothing of the account's pays for runs all the same on a picked device that runs its harness, on the device's own sign-in.
  const models = useMemo(() => modelsRunOn(newTask.models, device), [newTask.models, device]);

  // Note that a card whose chip says Cloud names the cloud, because the service keeps the pick as where the tasks an agent makes for the member run.
  const runsOn = runsOnStands ? newTaskRunsOn(place) : undefined;
  const { repository: picked, judged, drop } = repositoryDefault;

  // A tree's two tasks work in one repository, the other task's, which the chip is held to.
  const repository = treeRelation === undefined ? picked : treeRelation.task.repository;
  // Note that an automation's agent starts on words alone, since the brief fences them as the request, and a file's marker is no words of the request's.
  const requested = useWordsOf(typed, (text) => wordsWithoutMarkers(text.trim()).trim() !== "");
  const holdsWords = useWordsOf(typed, (text) => hasWordsOrFiles(text.trim(), attachments));
  const filled = forAutomation ? requested : holdsWords;

  // An agent needs something to work on, words or files, and works in no repository where none is chosen.
  // Note that an agent nothing of the account's pays for is held here, with the press that connects one, rather than refused once pressed; a bare task needs none.
  const unpaid =
    models === undefined || choice === undefined ? undefined : unrunnableChoice(models, choice);

  const canStart = !devicesUnread && unpaid === undefined && filled;
  // What an `@` and a `/` offer: the chosen repository's, read through the workspace, as on an agent's page no task holds.
  const reader = useMentionedReader();

  const mentions = useTasklessMentions(
    workspaceId === undefined
      ? undefined
      : { workspace: workspace?.slug ?? workspaceId, workspaceId, repository },
    { tasks: relatable, models: newTask.models },
    newTask.onShowMention,
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

  const begin = (handing: Pick<NewTaskStart, "handed" | "card"> = {}) => {
    if (devicesUnread) return;
    void starts.run(() => {
      onStarting?.(true);
      setHanded(undefined);
      // Note that an agent's start lets its words go as it is pressed, because the card closes at
      // once and a New task opened before the service answers must open empty; a refused card
      // opened again brings its own words back (`refused.card.words`).
      const agentStart = handing.handed !== undefined;

      if (agentStart) draft.update(() => EMPTY_DRAFT);

      // Note that a tree's start names no repository, because the service gives it the other task's.
      return newTask
        .start("", tree ? null : repository, workspaceId, {
          ...(runsOn === undefined ? undefined : { runsOn }),
          ...(device === undefined ? undefined : { device }),
          ...(relations.length === 0 ? undefined : { relations: relationsAsked(relations) }),
          ...(section === undefined ? undefined : { sectionId: section.id }),
          ...handing,
        })
        .then((refused) => {
          if (refused === undefined) {
            // A task started lets its words go, so the next New task opens empty.
            pressed.current = undefined;

            if (!agentStart) draft.update(() => EMPTY_DRAFT);
          }

          return refused;
        })
        .finally(() => onStarting?.(false));
    });
  };

  const start = () => {
    if (!canStart) return;
    const words = typed.get();
    const said = words.trim();
    const prompt = forAutomation ? automationAgentBrief(said) : said;

    if (forAutomation && prompt.length > AGENT_BOUNDS.MAX_MESSAGE_CHARS) {
      starts.refuse({ reason: FAILURE_REASON.OTHER, text: TOO_LONG });

      return;
    }

    const ask: AgentAsk = {
      repository,
      workspaceId,
      deviceId: placeIdOf(place),
      relations: relationsAsked(relations),
      agent: {
        prompt,
        attachments,
        choice: pickedModel,
        ...(disabledServers === undefined ? undefined : { disabledServers }),
        ...(pickedMode === undefined ? undefined : { permissionMode: pickedMode }),
      },
    };

    const held = pressed.current;
    const key = held !== undefined && sameAsk(held.ask, ask) ? held.key : crypto.randomUUID();
    const press = { ask, key };
    pressed.current = press;
    begin({
      handed: { idempotencyKey: key, ...ask.agent },
      card: {
        ...(forAutomation ? { purpose } : undefined),
        relations,
        repository,
        sectionId: section?.id,
        choice: pickedModel,
        press,
        words,
      },
    });
  };

  // Note that each press mints its own key, since a blank start carries nothing a Retry could ask again.
  const talk = (call: CallWhenStarted) => {
    if (devicesUnread || unpaid !== undefined) return call(undefined);

    const ask: AgentAsk = {
      repository,
      workspaceId,
      deviceId: placeIdOf(place),
      relations: relationsAsked(relations),
      agent: {
        prompt: "",
        attachments: [],
        choice: pickedModel,
        ...(disabledServers === undefined ? undefined : { disabledServers }),
        ...(pickedMode === undefined ? undefined : { permissionMode: pickedMode }),
      },
    };

    const press = { ask, key: crypto.randomUUID() };
    // Note that a refused Talk opens the card again on why, as a refused Start does, with its box empty.
    begin({
      handed: { idempotencyKey: press.key, ...ask.agent, talk: call },
      card: {
        relations,
        repository,
        sectionId: section?.id,
        choice: pickedModel,
        press,
        words: "",
      },
    });
  };

  // An automation's agent is handed its brief, so it starts on words alone and offers no Talk.
  const startsTalk = forAutomation
    ? undefined
    : { start: talk, starting: starting || devicesUnread || unpaid !== undefined };

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
      onListed={repositoryDefault.onListed}
      pending={!tree && chosen !== null && repository === null}
      held={tree ? REPOSITORY_HELD : undefined}
    />
  );

  const composer: AgentComposerControl = {
    held: { words: typed, attachments },
    updateHeld: (next) => {
      let edited = false;
      // Note that the words are told against the draft as the change lands, never a render's copy, so an echo of the
      // words it holds, as the field's of a refused card's, is no edit.
      heldUpdateOver<Draft>((move) =>
        draft.update((was) => {
          const moved = move(was);
          edited = moved.text !== was.text;

          return moved;
        }),
      )(next);

      // An edit of the words lets a refusal go.
      if (!edited) return;
      setHanded(undefined);
      starts.clear();
    },
    sending: starting,
    // Note that a read of the devices that failed is said over any note before it, and read again by its Retry.
    note: devicesFailed ? DEVICES_UNREAD : note,
    closed: undefined,
    send: start,
    retry: devicesFailed ? () => readModels.current() : start,
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
    unpaid === undefined || models === undefined ? null : (
      <ConnectAgentBanner models={models} unpaid={unpaid} look={notices} />
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
          {titledByOwner ? null : forAutomation ? (
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
          {section === undefined ? null : (
            <SectionChip section={section} onRemove={() => setSectionId(undefined)} />
          )}
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
        // Note that an automation's words are wrapped in its brief, so they can't open on `/goal`.
        startsGoal={!forAutomation}
        wording={startsBare ? BARE_WORDS : PURPOSE_WORDS[purpose]}
        // Note that an automation's agent is held without words, since its brief fences them as the request, files alone saying none.
        sendable={
          !devicesUnread && (startsBare || unpaid === undefined) && (!forAutomation || requested)
        }
        model={choice === undefined ? undefined : { choice, note: undefined, choose }}
        models={models}
        modelsFailed={newTask.modelsFailed}
        readModels={newTask.readModels}
        usage={undefined}
        mode={mode}
        servers={servers}
        plus={relationPlus}
        skills={skills}
        onStop={() => Promise.resolve(false)}
        startsTalk={startsTalk}
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
                  owned={owned}
                  place={place}
                  disabled={starting}
                  narrow={narrow}
                  onChoose={choosePlace}
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
