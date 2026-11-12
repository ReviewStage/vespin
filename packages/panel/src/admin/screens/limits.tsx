/**
 * limits.tsx -- the Limits screen: the caps, deadlines, sizes, and pinned versions the code holds, read from the very constants that enforce them.
 *
 * Every figure is imported from the module that enforces it, never copied,
 * so the page ships in the same deploy as the service and says what that
 * deploy enforces. A limit only the service holds is not here: the page
 * reads nothing from the service, so it draws what a browser bundle may
 * import (`@repo/features`, and the runner's pins, whose module reaches no
 * Node API). The search narrows the rows by what a limit bounds or by its
 * constant's name, which is what a reader greps for to change it.
 */

import {
  CLAUDE_CODE_PIN,
  CODEX_PIN,
  GH_MAC_PIN,
  NODE_MAC_PIN,
  PLAYWRIGHT_PIN,
} from "@repo/agent-runner/pins";
import { AGENT_QUEUE_BOUNDS } from "@repo/features/agent-queue-wire";
import { STARTING_GRACE_MILLIS } from "@repo/features/agent-status";
import { AGENT_BOUNDS } from "@repo/features/agent-wire";
import {
  AUTOMATION_BOUNDS,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_DEFAULT_SUBJECT_COOLDOWN_HOURS,
} from "@repo/features/automation-wire";
import { BROWSER_AGENT_LIMITS } from "@repo/features/browser-agent-actions";
import { CONVERSATION_PICTURE_BOUNDS } from "@repo/features/conversation-picture-wire";
import { DESCRIPTION_ATTACHMENT_BOUNDS } from "@repo/features/description-attachment-wire";
import { DICTATION_BOUNDS } from "@repo/features/dictation-wire";
import { INBOX_BOUNDS } from "@repo/features/inbox-wire";
import { MAC_COMMAND_BOUNDS } from "@repo/features/mac-command-wire";
import { MEMORY_BOUNDS } from "@repo/features/memory-wire";
import { formatBytes, formatCount } from "@repo/features/number-format";
import { PICTURE_BOUNDS } from "@repo/features/picture-wire";
import { SANDBOX_SIZE } from "@repo/features/sandbox-size";
import { TASK_BOUNDS } from "@repo/features/task-wire";
import { workingTime } from "@repo/features/time-format";
import { TURN_DEADLINE } from "@repo/features/turn-deadline";
import { COLLECTION_STATE, SearchField, TEXT_FONT, TEXT_TONE, Text } from "@repo/ui";
import {
  createDataTableColumnHelper,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
} from "@repo/ui/data-table";
import { useMemo, useState } from "react";
import { useAdminDoors } from "../admin-doors.js";
import { AdminSection } from "../charts/stat-card.js";
import { PageSections } from "../chrome/controls.js";
import { PageNote } from "../chrome/notes.js";
import { AdminCollectionPage } from "../chrome/page-header.js";

/** One limit: what it bounds, its figure, and the constant that holds it. */
interface Limit {
  readonly label: string;
  readonly figure: string;
  readonly constant: string;
}

/** A group of limits under the area they bound. */
interface LimitGroup {
  readonly title: string;
  readonly limits: readonly Limit[];
}

const SECOND_MS = 1000;

const HOUR_MS = 60 * 60 * SECOND_MS;

/** A span in milliseconds, as a run's time is said: "10m", "24h", "7d". */
const span = (ms: number) => workingTime(ms);

const seconds = (count: number) => span(count * SECOND_MS);

const hours = (count: number) => span(count * HOUR_MS);

const characters = (count: number) => `${formatCount(count)} characters`;

const limit = (label: string, figure: string, constant: string): Limit => ({
  label,
  figure,
  constant,
});

/** The vCPUs a repository's sandbox is given over the default, one row each. */
const SANDBOX_OVERRIDES: readonly Limit[] = [...SANDBOX_SIZE.VCPUS_BY_REPOSITORY].map(
  ([repository, vcpus]) =>
    limit(`Sandbox vCPUs for ${repository}`, `${vcpus} vCPU`, "SANDBOX_SIZE.VCPUS_BY_REPOSITORY"),
);

/** Every limit the page draws, by area, in the order it draws them. */
const LIMIT_GROUPS: readonly LimitGroup[] = [
  {
    title: "Turns",
    limits: [
      limit(
        "Wait for a runner to take a queued turn",
        span(TURN_DEADLINE.PICKUP_MS),
        "TURN_DEADLINE.PICKUP_MS",
      ),
      limit(
        "Running turn held at work past its last progress",
        span(TURN_DEADLINE.PROGRESS_MS),
        "TURN_DEADLINE.PROGRESS_MS",
      ),
      limit(
        "Progress deadline pushed on once this much has run down",
        span(TURN_DEADLINE.RENEW_AFTER_MS),
        "TURN_DEADLINE.RENEW_AFTER_MS",
      ),
      limit("Turn left open after a Stop", span(TURN_DEADLINE.STOP_MS), "TURN_DEADLINE.STOP_MS"),
      limit("Longest any turn runs", span(TURN_DEADLINE.CAP_MS), "TURN_DEADLINE.CAP_MS"),
      limit(
        "Agent with no turn yet reads as failed after",
        span(STARTING_GRACE_MILLIS),
        "STARTING_GRACE_MILLIS",
      ),
    ],
  },
  {
    title: "Agents",
    limits: [
      limit(
        "Message to an agent",
        characters(AGENT_BOUNDS.MAX_MESSAGE_CHARS),
        "AGENT_BOUNDS.MAX_MESSAGE_CHARS",
      ),
      limit(
        "Prompt or note an agent is started with",
        characters(AGENT_BOUNDS.MAX_START_WORDS_CHARS),
        "AGENT_BOUNDS.MAX_START_WORDS_CHARS",
      ),
      limit(
        "Extra repositories one start names",
        formatCount(AGENT_BOUNDS.MAX_ALSO_REPOSITORIES),
        "AGENT_BOUNDS.MAX_ALSO_REPOSITORIES",
      ),
      limit(
        "Messages queued for an agent",
        formatCount(AGENT_QUEUE_BOUNDS.MAX_MESSAGES),
        "AGENT_QUEUE_BOUNDS.MAX_MESSAGES",
      ),
      limit(
        "Hold on a queued message while it is sent",
        span(AGENT_QUEUE_BOUNDS.CLAIM_MS),
        "AGENT_QUEUE_BOUNDS.CLAIM_MS",
      ),
      limit(
        "Items on an agent's to-do list",
        formatCount(AGENT_BOUNDS.MAX_TODOS),
        "AGENT_BOUNDS.MAX_TODOS",
      ),
    ],
  },
  {
    title: "Tasks",
    limits: [
      limit(
        "Task description",
        characters(TASK_BOUNDS.MAX_BODY_CHARS),
        "TASK_BOUNDS.MAX_BODY_CHARS",
      ),
      limit("Task brief", characters(TASK_BOUNDS.MAX_BRIEF_CHARS), "TASK_BOUNDS.MAX_BRIEF_CHARS"),
      limit(
        "Pictures in a description",
        formatCount(DESCRIPTION_ATTACHMENT_BOUNDS.MAX_PER_DESCRIPTION),
        "DESCRIPTION_ATTACHMENT_BOUNDS.MAX_PER_DESCRIPTION",
      ),
      limit(
        "Recordings in a description",
        formatCount(DESCRIPTION_ATTACHMENT_BOUNDS.MAX_VIDEOS_PER_DESCRIPTION),
        "DESCRIPTION_ATTACHMENT_BOUNDS.MAX_VIDEOS_PER_DESCRIPTION",
      ),
    ],
  },
  {
    title: "Automations",
    limits: [
      limit(
        "Concurrent runs an automation may allow",
        formatCount(AUTOMATION_BOUNDS.MAX_CONCURRENT_RUNS),
        "AUTOMATION_BOUNDS.MAX_CONCURRENT_RUNS",
      ),
      limit(
        "Concurrent runs by default",
        formatCount(AUTOMATION_DEFAULT_GUARDS.maxConcurrentRuns),
        "AUTOMATION_DEFAULT_GUARDS.maxConcurrentRuns",
      ),
      limit(
        "Runs a day an automation may allow",
        formatCount(AUTOMATION_BOUNDS.MAX_DAILY_RUNS),
        "AUTOMATION_BOUNDS.MAX_DAILY_RUNS",
      ),
      limit(
        "Runs a day by default",
        formatCount(AUTOMATION_DEFAULT_GUARDS.dailyRunCap),
        "AUTOMATION_DEFAULT_GUARDS.dailyRunCap",
      ),
      limit(
        "Cooldown on the same subject by default",
        hours(AUTOMATION_DEFAULT_SUBJECT_COOLDOWN_HOURS),
        "AUTOMATION_DEFAULT_SUBJECT_COOLDOWN_HOURS",
      ),
      limit(
        "Longest cooldown on the same subject",
        hours(AUTOMATION_BOUNDS.MAX_SUBJECT_COOLDOWN_HOURS),
        "AUTOMATION_BOUNDS.MAX_SUBJECT_COOLDOWN_HOURS",
      ),
      limit(
        "Automation prompt",
        characters(AUTOMATION_BOUNDS.MAX_PROMPT_CHARS),
        "AUTOMATION_BOUNDS.MAX_PROMPT_CHARS",
      ),
      limit(
        "Repositories an automation names",
        formatCount(AUTOMATION_BOUNDS.MAX_REPOSITORIES),
        "AUTOMATION_BOUNDS.MAX_REPOSITORIES",
      ),
    ],
  },
  {
    title: "Machines",
    limits: [
      limit("Sandbox vCPUs", `${SANDBOX_SIZE.VCPUS} vCPU`, "SANDBOX_SIZE.VCPUS"),
      limit(
        "Sandbox memory per vCPU",
        `${SANDBOX_SIZE.MEMORY_GB_PER_VCPU} GB`,
        "SANDBOX_SIZE.MEMORY_GB_PER_VCPU",
      ),
      ...SANDBOX_OVERRIDES,
      limit(
        "Command on a Mac, by default",
        seconds(MAC_COMMAND_BOUNDS.DEFAULT_TIMEOUT_SECONDS),
        "MAC_COMMAND_BOUNDS.DEFAULT_TIMEOUT_SECONDS",
      ),
      limit(
        "Command on a Mac, at most",
        seconds(MAC_COMMAND_BOUNDS.MAX_TIMEOUT_SECONDS),
        "MAC_COMMAND_BOUNDS.MAX_TIMEOUT_SECONDS",
      ),
      limit(
        "Output kept from a command on a Mac",
        characters(MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS),
        "MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS",
      ),
      limit(
        "Browser action",
        span(BROWSER_AGENT_LIMITS.ACTION_TIMEOUT_MS),
        "BROWSER_AGENT_LIMITS.ACTION_TIMEOUT_MS",
      ),
      limit(
        "Browser wait, at most",
        span(BROWSER_AGENT_LIMITS.WAIT_MAX_MS),
        "BROWSER_AGENT_LIMITS.WAIT_MAX_MS",
      ),
      limit(
        "Browser recording",
        seconds(BROWSER_AGENT_LIMITS.RECORDING_MAX_SECONDS),
        "BROWSER_AGENT_LIMITS.RECORDING_MAX_SECONDS",
      ),
      limit(
        "Browser tabs",
        formatCount(BROWSER_AGENT_LIMITS.MAX_TABS),
        "BROWSER_AGENT_LIMITS.MAX_TABS",
      ),
    ],
  },
  {
    title: "Uploads and media",
    limits: [
      limit(
        "Files on a message",
        formatCount(AGENT_BOUNDS.MAX_ATTACHMENTS),
        "AGENT_BOUNDS.MAX_ATTACHMENTS",
      ),
      limit(
        "All files on a message",
        formatBytes(AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES),
        "AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES",
      ),
      limit(
        "Image on a message",
        formatBytes(AGENT_BOUNDS.MAX_IMAGE_BYTES),
        "AGENT_BOUNDS.MAX_IMAGE_BYTES",
      ),
      limit(
        "PDF on a message",
        formatBytes(AGENT_BOUNDS.MAX_PDF_BYTES),
        "AGENT_BOUNDS.MAX_PDF_BYTES",
      ),
      limit(
        "Text file on a message",
        formatBytes(AGENT_BOUNDS.MAX_TEXT_BYTES),
        "AGENT_BOUNDS.MAX_TEXT_BYTES",
      ),
      limit("Picture", formatBytes(PICTURE_BOUNDS.MAX_BYTES), "PICTURE_BOUNDS.MAX_BYTES"),
      limit(
        "Recording posted to a thread",
        formatBytes(INBOX_BOUNDS.MAX_VIDEO_BYTES),
        "INBOX_BOUNDS.MAX_VIDEO_BYTES",
      ),
      limit(
        "Recording sent from the app",
        formatBytes(PICTURE_BOUNDS.MAX_SENT_VIDEO_BYTES),
        "PICTURE_BOUNDS.MAX_SENT_VIDEO_BYTES",
      ),
      limit(
        "Picture an agent shows",
        formatBytes(CONVERSATION_PICTURE_BOUNDS.MAX_BYTES),
        "CONVERSATION_PICTURE_BOUNDS.MAX_BYTES",
      ),
      limit(
        "Pictures an agent shows, per conversation",
        formatBytes(CONVERSATION_PICTURE_BOUNDS.MAX_BYTES_PER_CONVERSATION),
        "CONVERSATION_PICTURE_BOUNDS.MAX_BYTES_PER_CONVERSATION",
      ),
      limit(
        "Dictated clip",
        span(DICTATION_BOUNDS.MAX_DURATION_MS),
        "DICTATION_BOUNDS.MAX_DURATION_MS",
      ),
      limit(
        "Dictated clip's audio",
        formatBytes(DICTATION_BOUNDS.MAX_AUDIO_BYTES),
        "DICTATION_BOUNDS.MAX_AUDIO_BYTES",
      ),
    ],
  },
  {
    title: "Memory and inbox",
    limits: [
      limit(
        "Memories a workspace keeps",
        formatCount(MEMORY_BOUNDS.MAX_MEMORIES),
        "MEMORY_BOUNDS.MAX_MEMORIES",
      ),
      limit("One memory", characters(MEMORY_BOUNDS.MAX_CHARS), "MEMORY_BOUNDS.MAX_CHARS"),
      limit(
        "Message on a thread",
        characters(INBOX_BOUNDS.MAX_MESSAGE_CHARS),
        "INBOX_BOUNDS.MAX_MESSAGE_CHARS",
      ),
      limit(
        "Pictures on a thread's message",
        formatCount(INBOX_BOUNDS.MAX_MESSAGE_PICTURES),
        "INBOX_BOUNDS.MAX_MESSAGE_PICTURES",
      ),
      limit(
        "Options an ask offers",
        formatCount(INBOX_BOUNDS.MAX_OPTIONS),
        "INBOX_BOUNDS.MAX_OPTIONS",
      ),
      limit(
        "Messages a thread's read answers",
        formatCount(INBOX_BOUNDS.MAX_MESSAGES_READ),
        "INBOX_BOUNDS.MAX_MESSAGES_READ",
      ),
    ],
  },
  {
    title: "Versions",
    limits: [
      limit("Claude Code", CLAUDE_CODE_PIN.VERSION, "CLAUDE_CODE_PIN.VERSION"),
      limit("Claude Agent SDK", CLAUDE_CODE_PIN.SDK_VERSION, "CLAUDE_CODE_PIN.SDK_VERSION"),
      limit("Codex", CODEX_PIN.VERSION, "CODEX_PIN.VERSION"),
      limit("Node", NODE_MAC_PIN.VERSION, "NODE_MAC_PIN.VERSION"),
      limit("GitHub CLI on a Mac", GH_MAC_PIN.VERSION, "GH_MAC_PIN.VERSION"),
      limit("Playwright", PLAYWRIGHT_PIN.VERSION, "PLAYWRIGHT_PIN.VERSION"),
    ],
  },
];

const LIMIT_COLUMN = { LIMIT: "limit", VALUE: "value", CONSTANT: "constant" } as const;

const column = createDataTableColumnHelper<Limit>();

// Note that the value stands last, on the row's end, so it lines up from group to group however wide each group's constants run.
const LIMIT_COLUMNS = column.columns([
  column.display({
    id: LIMIT_COLUMN.LIMIT,
    header: "Limit",
    meta: { kind: DATA_TABLE_COLUMN_KIND.PROSE },
    cell: ({ row: { original: row } }) => row.label,
  }),
  column.display({
    id: LIMIT_COLUMN.CONSTANT,
    header: "Constant",
    cell: ({ row: { original: row } }) => (
      <Text font={TEXT_FONT.MONO} tone={TEXT_TONE.MUTED}>
        {row.constant}
      </Text>
    ),
  }),
  column.display({
    id: LIMIT_COLUMN.VALUE,
    header: "Value",
    meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
    cell: ({ row: { original: row } }) => row.figure,
  }),
]);

/** What the page says it holds, once, over its groups. */
const LIMITS_NOTE =
  "The caps, deadlines, sizes, and pinned versions this deploy enforces, read from the constants that hold them. Limits only the service holds are not listed yet.";

/** The groups whose limits a search finds, each keeping only the rows it finds; every group where the search is empty. */
function foundGroups(query: string): readonly LimitGroup[] {
  const term = query.trim().toLowerCase();
  if (term === "") return LIMIT_GROUPS;
  const found = (each: Limit) =>
    each.label.toLowerCase().includes(term) || each.constant.toLowerCase().includes(term);
  return LIMIT_GROUPS.map((group) => ({ ...group, limits: group.limits.filter(found) })).filter(
    (group) => group.limits.length > 0,
  );
}

export function LimitsScreen({
  frame,
}: {
  /** Applied around the page, past the gate's own cards, which stand alone. */
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  const { gate } = useAdminDoors();
  const [query, setQuery] = useState("");
  const groups = useMemo(() => foundGroups(query), [query]);
  // Note that the page reads nothing, so the gate's own hold is all that keeps it from a reader who has not signed in here.
  if (gate.heldAtGate()) return gate.signedOut();
  return frame(
    <AdminCollectionPage
      title="Limits"
      controls={null}
      filters={
        <SearchField
          label="Search limits by what they bound or their constant"
          placeholder="Search limits"
          value={query}
          onChange={setQuery}
          onClear={() => setQuery("")}
        />
      }
      state={groups.length === 0 ? COLLECTION_STATE.EMPTY : COLLECTION_STATE.READY}
      loadingLabel="Reading limits"
      empty="No limit matches that search."
    >
      <PageSections>
        <AdminSection>
          <PageNote>{LIMITS_NOTE}</PageNote>
        </AdminSection>
        {groups.map((group) => (
          <AdminSection key={group.title} title={group.title}>
            <DataTable
              label={group.title}
              columns={LIMIT_COLUMNS}
              rows={group.limits}
              getRowId={(row) => row.label}
              empty="No limits."
              minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
            />
          </AdminSection>
        ))}
      </PageSections>
    </AdminCollectionPage>,
  );
}
