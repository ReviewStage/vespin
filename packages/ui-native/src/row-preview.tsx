// row-preview.tsx -- what a row's long press lifts over its menu, as the system's own apps lift one: a thread's newest messages, a task's Overview at a glance, or an agent's latest step.

import { HStack, Divider as SwiftUIDivider, Text, VStack } from "@expo/ui/swift-ui";
import {
  background,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import type { AgentStatus, PullRequestState } from "@repo/features/agent-wire";
import { agentGlyphState, agentStateWords, GLYPH_STATE } from "@repo/features/glyph-state";
import { needsYouWords } from "@repo/features/inbox-list-model";
import type { ModelProvider } from "@repo/features/models-wire";
import { pullRequestMarkState } from "@repo/features/pull-request-model";
import { TASK_STATUS_WORDS } from "@repo/features/task-standing-words";
import type { TaskStatus } from "@repo/features/task-wire";
import type { ReactNode } from "react";
import { PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { RowTime } from "./list-row.js";
import { AgentTile, Avatar, FailedMark, TaskStatusMark, ToneGlyph, WorkingMark } from "./marks.js";
import type { PreviewMessage } from "./row-preview-model.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** How wide a preview stands: a phone's column less the system's margin, which an iPad keeps too, as a preview reads best at a phone's measure. */
const PREVIEW_WIDTH = 340;

/** How many lines a preview's words take before they are cut: a message's, and a step's. */
const PREVIEW_LINES = { MESSAGE: 3, STEP: 4 } as const;

/** What parts the pieces of a preview's line. */
const LINE_PART = " · ";

/** How many agents a task's preview names before it counts the rest. */
const PREVIEW_AGENTS = 4;

/** What a task's preview heads its agents with, and counts those it leaves out as. */
const AGENTS_WORDS = {
  HEAD: "Agents",
  MORE: (count: number) => `${count} more`,
} as const;

/** The pieces of a line that say something, joined. */
function lineOf(parts: readonly (string | undefined)[]): string {
  return parts.filter((part) => part !== undefined && part !== "").join(LINE_PART);
}

/** A preview's ground and measure: the brand's ground, padded to the screen's edge, at a phone's width. */
function PreviewCard({ children }: { readonly children: ReactNode }) {
  const colors = useColors();

  return (
    <VStack
      alignment="leading"
      spacing={SPACE.ROW}
      modifiers={[
        padding({ all: SPACE.EDGE }),
        frame({ width: PREVIEW_WIDTH, alignment: "topLeading" }),
        background(colors.GROUND),
      ]}
    >
      {children}
    </VStack>
  );
}

/** A preview's path over its heading: a mark and small muted words, as a pushed page's bar names its path. */
function PreviewPath({ mark, words }: { readonly mark: ReactNode; readonly words: string }) {
  const colors = useColors();

  return (
    <HStack spacing={SPACE.TIGHT + 2} alignment="center">
      {mark}
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE }),
          foregroundStyle(colors.TEXT_MUTED),
          lineLimit(1),
        ]}
      >
        {words}
      </Text>
    </HStack>
  );
}

/** A preview's heading, as the page it opens heads itself: 20 pt semibold. */
function PreviewHeading({ words }: { readonly words: string }) {
  const colors = useColors();

  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.PAGE_HEADING, weight: "semibold" }),
        foregroundStyle(colors.TEXT),
        lineLimit(2),
      ]}
    >
      {words}
    </Text>
  );
}

/** A preview's 13 pt line in an ink, the muted one where none is given. */
function PreviewLine({
  words,
  ink,
}: {
  readonly words: string;
  readonly ink?: string | undefined;
}) {
  const colors = useColors();

  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_LINE }),
        foregroundStyle(ink ?? colors.TEXT_MUTED),
        lineLimit(2),
      ]}
    >
      {words}
    </Text>
  );
}

/** A preview's hairline between its head and what follows, in the rows' own edge ink. */
function PreviewRule() {
  const colors = useColors();

  return <SwiftUIDivider modifiers={[foregroundStyle(colors.CHIP_EDGE)]} />;
}

/** One message of a thread's preview: its writer's tile or face and name, its time, and its words under them. */
function PreviewMessageRow({
  message,
  now,
}: {
  readonly message: PreviewMessage;
  readonly now: number | undefined;
}) {
  const colors = useColors();

  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT}>
      <HStack spacing={SPACE.TIGHT + 2} alignment="center">
        {message.agent ? (
          <AgentTile name={message.writer} harness={message.harness} size={MARK_SIZE.WRITER} />
        ) : (
          <Avatar name={message.writer} picture={message.picture} size={MARK_SIZE.WRITER} />
        )}
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "semibold" }),
            foregroundStyle(colors.TEXT),
            lineLimit(1),
          ]}
        >
          {message.writer}
        </Text>
        <RowTime at={message.at} now={now} />
      </HStack>
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_TITLE }),
          foregroundStyle(colors.TEXT_BODY),
          lineLimit(PREVIEW_LINES.MESSAGE),
        ]}
      >
        {message.words}
      </Text>
    </VStack>
  );
}

/**
 * A thread's preview: its task's ring and name, its title as the thread's
 * page heads it, and its newest messages (`previewMessages`), each under
 * its writer and time, cut to a few lines, as Mail's preview shows the
 * message a long press lifts.
 */
export function ThreadPreview({
  title,
  task,
  messages,
  now,
}: {
  readonly title: string;
  readonly task?: { readonly name: string; readonly status?: TaskStatus | undefined } | undefined;
  readonly messages: readonly PreviewMessage[];
  readonly now?: number | undefined;
}) {
  return (
    <PreviewCard>
      {task === undefined ? null : (
        <PreviewPath
          mark={task.status === undefined ? null : <TaskStatusMark status={task.status} />}
          words={task.name}
        />
      )}
      <PreviewHeading words={title} />
      {messages.length === 0 ? null : <PreviewRule />}
      {messages.map((message) => (
        <PreviewMessageRow key={message.id} message={message} now={now} />
      ))}
    </PreviewCard>
  );
}

/** An agent as a task's preview names it: its tile, its name, and where it stands. */
export type PreviewAgent = {
  readonly id: string;
  readonly name: string;
  /** The provider whose harness it runs in, whose mark its tile wears; the sparkles where it is not known. */
  readonly harness?: ModelProvider | undefined;
  readonly status: AgentStatus;
};

/** An agent's mark as a preview's line leads with it: the spinner while it works, the alert where it failed, nothing at rest. */
function AgentStateMark({ status }: { readonly status: AgentStatus }) {
  const state = agentGlyphState(status);

  if (state === GLYPH_STATE.WORKING) return <WorkingMark />;

  if (state === GLYPH_STATE.FAILED) return <FailedMark />;

  return null;
}

/** One agent among a task's preview's: its tile, its name, and its mark and the word for where it stands. */
function PreviewAgentRow({ agent }: { readonly agent: PreviewAgent }) {
  const colors = useColors();
  const words = agentStateWords(agent.status);

  return (
    <HStack spacing={SPACE.TIGHT + 2} alignment="center">
      <AgentTile name={agent.name} harness={agent.harness} size={MARK_SIZE.WRITER} />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_TITLE }),
          foregroundStyle(colors.TEXT_BODY),
          lineLimit(1),
        ]}
      >
        {agent.name}
      </Text>
      <AgentStateMark status={agent.status} />
      {words === undefined ? null : <PreviewLine words={words} />}
    </HStack>
  );
}

/**
 * A task's preview, its Overview at a glance: its status, key and
 * repository over its name, how many of its threads need the reader, and
 * its agents, each with where it stands, the first few named and the rest
 * counted.
 */
export function TaskPreview({
  name,
  status,
  taskKey,
  repository,
  needsYou,
  agents,
}: {
  readonly name: string;
  readonly status: TaskStatus;
  readonly taskKey?: string | undefined;
  readonly repository?: string | undefined;
  /** How many of its threads wait on the reader; none said at none. */
  readonly needsYou: number;
  readonly agents: readonly PreviewAgent[];
}) {
  const colors = useColors();
  const named = agents.slice(0, PREVIEW_AGENTS);
  const more = agents.length - named.length;

  return (
    <PreviewCard>
      <PreviewPath
        mark={<TaskStatusMark status={status} />}
        words={lineOf([TASK_STATUS_WORDS[status], taskKey, repository])}
      />
      <PreviewHeading words={name} />
      {needsYou === 0 ? null : (
        <PreviewLine words={needsYouWords(needsYou)} ink={colors.ACCENT_TEXT} />
      )}
      {agents.length === 0 ? null : (
        <>
          <PreviewRule />
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.GROUP_HEADER, weight: "medium" }),
              foregroundStyle(colors.TEXT_MUTED),
              monospacedDigit(),
            ]}
          >
            {`${AGENTS_WORDS.HEAD} ${agents.length}`}
          </Text>
          {named.map((agent) => (
            <PreviewAgentRow key={agent.id} agent={agent} />
          ))}
          {more === 0 ? null : <PreviewLine words={AGENTS_WORDS.MORE(more)} />}
        </>
      )}
    </PreviewCard>
  );
}

/**
 * An agent's preview: its task's ring and name, its tile and name as its
 * page heads it, where it stands with the model it runs on and where it
 * runs, its latest step (`latestStep`) where the app holds its transcript,
 * its pull request, and how many of its threads need the reader.
 */
export function AgentPreview({
  name,
  harness,
  status,
  task,
  model,
  runsOn,
  step,
  waiting,
  pullRequest,
}: {
  readonly name: string;
  /** The provider whose harness it runs in, whose mark its tile wears; the sparkles where it is not known. */
  readonly harness?: ModelProvider | undefined;
  readonly status: AgentStatus;
  readonly task?: { readonly name: string; readonly status?: TaskStatus | undefined } | undefined;
  /** The model it runs on, as the panel's chip names it. */
  readonly model?: string | undefined;
  /** Where it runs: "Cloud", or the device's name. */
  readonly runsOn: string;
  /** Its latest step as one line; none before the app holds its transcript. */
  readonly step?: string | undefined;
  readonly waiting: number;
  readonly pullRequest?:
    | {
        readonly number: number;
        readonly state: PullRequestState;
        readonly queued?: true | undefined;
      }
    | undefined;
}) {
  const colors = useColors();

  const pull =
    pullRequest === undefined ? undefined : PULL_REQUEST_LOOK[pullRequestMarkState(pullRequest)];

  return (
    <PreviewCard>
      {task === undefined ? null : (
        <PreviewPath
          mark={task.status === undefined ? null : <TaskStatusMark status={task.status} />}
          words={task.name}
        />
      )}
      <HStack spacing={SPACE.ROW} alignment="center">
        <AgentTile name={name} harness={harness} size={MARK_SIZE.AVATAR} />
        <PreviewHeading words={name} />
      </HStack>
      <HStack spacing={SPACE.TIGHT + 2} alignment="center">
        <AgentStateMark status={status} />
        <PreviewLine words={lineOf([agentStateWords(status), model, runsOn])} />
      </HStack>
      {step === undefined ? null : (
        <>
          <PreviewRule />
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_TITLE }),
              foregroundStyle(colors.TEXT_BODY),
              lineLimit(PREVIEW_LINES.STEP),
            ]}
          >
            {step}
          </Text>
        </>
      )}
      {pullRequest === undefined || pull === undefined ? null : (
        <HStack spacing={SPACE.TIGHT} alignment="center">
          <ToneGlyph glyph={pull.symbol} tone={pull.tone} textStyle={TYPE_ROLE.ROW_LINE} hidden />
          <PreviewLine words={`#${pullRequest.number}`} />
        </HStack>
      )}
      {waiting === 0 ? null : (
        <PreviewLine words={needsYouWords(waiting)} ink={colors.ACCENT_TEXT} />
      )}
    </PreviewCard>
  );
}
