// row-preview-model.ts -- what a row's long press preview says, a thread's newest messages, a task's Overview at a glance, or an agent's latest step, and the plain tree of words and marks the app's native module draws it from when the menu opens.

import { accountPictureAt, pinnedPictureUrl } from "@repo/features/account-picture";
import type { AgentStatus, PullRequestState } from "@repo/features/agent-wire";
import { agentGlyphState, agentStateWords, GLYPH_STATE } from "@repo/features/glyph-state";
import { type InboxThreadMessage, needsYouWords } from "@repo/features/inbox-list-model";
import type { ManagerFace } from "@repo/features/manager-face";
import type { ModelProvider } from "@repo/features/models-wire";
import { plainWords } from "@repo/features/plain-words";
import { pullRequestMarkState } from "@repo/features/pull-request-model";
import { TASK_STATUS_TONE, TASK_STATUS_WORDS } from "@repo/features/task-standing-words";
import type { TaskStatus } from "@repo/features/task-wire";
import { sinceText } from "@repo/features/time-format";
import { CALL_KIND, madeCallLine } from "@repo/features/turn-rows";
import { identityLetter } from "@repo/features/workspace-tile";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { managerFaceAsset } from "./manager-face-look.js";
import {
  HARNESS_MARK_ASSET,
  LETTER_SCALE,
  TILE_GLYPH_SCALE,
  TILE_MARK_SCALE,
  TILE_ROUNDING,
  WORKING_CELL,
  WORKING_DOTS,
  WORKING_INSET,
  WORKING_OPACITY,
  WORKING_PITCH,
  WORKING_SIDE,
  WORKING_TRACK,
} from "./mark-look.js";
import { STATUS_MARK_SYMBOL } from "./status-mark-model.js";
import type { BrandColors } from "./tokens/colors.js";
import { ON_IDENTITY } from "./tokens/identity-hues.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import type { StatusTone } from "./tokens/status-tone.js";
import { TYPE_ROLE } from "./tokens/type.js";
import { TRANSCRIPT_ITEM, type TranscriptItem } from "./transcript-model.js";
import { tileHue } from "./workspace-tile-model.js";

/** How many of a thread's newest messages its preview draws: enough to read where it stands at a glance, as Mail's preview shows a message's start. */
const PREVIEW_MESSAGES = 3;

/** What parts an answer's stamp from the words sent with it. */
const STAMP_PART = " · ";

/** One message as a thread's preview draws it: its writer, when, and its words on a line or two. */
export interface PreviewMessage {
  readonly id: string;
  readonly writer: string;
  /** Whether the agent wrote it, whose tile stands beside it rather than a member's face. */
  readonly agent: boolean;
  /** A member writer's sign-in picture, where one is known. */
  readonly picture?: string | undefined;
  /** The provider whose harness the agent writer runs in, whose mark its tile wears; none for a member, or where it is not known. */
  readonly harness?: ModelProvider | undefined;
  readonly at: number;
  readonly words: string;
}

/**
 * A thread's newest messages as its preview draws them, oldest first: each
 * said as plain words (`plainWords`), an answer's stamp before them ("Chose
 * 7 days · and say it in the docs"), and a message that says nothing in
 * words, a file sent alone, passed over.
 */
export function previewMessages(
  messages: readonly InboxThreadMessage[],
  pictureOf: (userId: string | undefined) => string | undefined = () => undefined,
  harness?: ModelProvider | undefined,
): readonly PreviewMessage[] {
  return messages
    .flatMap((message) => {
      const words = [message.stamp?.words, plainWords(message.words)]
        .filter((part) => part !== undefined && part !== "")
        .join(STAMP_PART);

      if (words === "") return [];

      return [
        {
          id: message.id,
          writer: message.writer.name,
          agent: message.writer.agent,
          picture: message.writer.agent ? undefined : pictureOf(message.writer.userId),
          harness: message.writer.agent ? harness : undefined,
          at: message.at,
          words,
        },
      ];
    })
    .slice(-PREVIEW_MESSAGES);
}

/** An item's step as the preview says it, where it is one of the agent's own: its words, a call's line or the card it stands as, a worker's job, or a fold's summary. */
function stepOf(item: TranscriptItem): string | undefined {
  switch (item.kind) {
    case TRANSCRIPT_ITEM.WORDS:
      return plainWords(item.words);
    case TRANSCRIPT_ITEM.CALL: {
      const { verb, subject } = item.line;

      return subject === undefined || subject === "" ? verb : `${verb} ${subject}`;
    }

    case TRANSCRIPT_ITEM.WORKER:
      return item.job;
    case TRANSCRIPT_ITEM.FOLD:
      return item.summary;
    // Note that a card a call stands as alone says the call as its row would, its verb then what it showed or opened, since the call's own line is left out.
    case TRANSCRIPT_ITEM.PAGE:
      return `${madeCallLine(CALL_KIND.SHOW_PAGE).verb} ${item.title}`;
    case TRANSCRIPT_ITEM.PULL_REQUEST:
      return `${madeCallLine(CALL_KIND.OPEN_PULL_REQUEST).verb} ${item.title}`;
    default:
      return undefined;
  }
}

/**
 * The agent's latest step, as the panel's card says one: its last words as
 * plain words, or its last call's line, or the card a call stands as alone
 * (a page it showed, a pull request it opened), or the fold its last calls
 * stand in; a line someone sent it, what a call showed, and the line a working
 * transcript ends on are passed over. Nothing where it has done nothing yet.
 */
export function latestStep(items: readonly TranscriptItem[]): string | undefined {
  for (let at = items.length - 1; at >= 0; at -= 1) {
    const item = items[at];
    const step = item === undefined ? undefined : stepOf(item);

    if (step !== undefined && step !== "") return step;
  }

  return undefined;
}

/** How wide a preview stands: a phone's column less the system's margin, which an iPad keeps too, as a preview reads best at a phone's measure. */
const PREVIEW_WIDTH = 340;

/** How many lines a preview's words take before they are cut: a path's, a heading's, a line's, a message's, and a step's. */
const PREVIEW_LINES = { PATH: 1, HEADING: 2, LINE: 2, MESSAGE: 3, STEP: 4 } as const;

/** What parts the pieces of a preview's line. */
const LINE_PART = " · ";

/** How many agents a task's preview names before it counts the rest. */
const PREVIEW_AGENTS = 4;

/** What a task's preview heads its agents with, and counts those it leaves out as. */
const AGENTS_WORDS = {
  HEAD: "Agents",
  MORE: (count: number) => `${count} more`,
} as const;

/** What kind of row a preview glances at. */
const ROW_PREVIEW = {
  THREAD: "thread",
  TASK: "task",
  AGENT: "agent",
} as const;

/** A task as a preview's path names it: its name, after its status's ring where it has one. */
type PreviewTask = { readonly name: string; readonly status?: TaskStatus | undefined };

/** An agent as a task's preview names it: its tile, its name, and where it stands. */
export type PreviewAgent = {
  readonly id: string;
  readonly name: string;
  /** The provider whose harness it runs in, whose mark its tile wears; the hard hat where it is not known. */
  readonly harness?: ModelProvider | undefined;
  readonly status: AgentStatus;
};

/** What a thread's preview draws: its task's ring and name, its title as the thread's page heads it, and its newest messages (`previewMessages`). */
type ThreadPreviewFacts = {
  readonly title: string;
  readonly task?: PreviewTask | undefined;
  readonly messages: readonly PreviewMessage[];
};

/** What a task's preview draws: its status, key and repository over its name, how many of its threads need the reader, and its agents. */
type TaskPreviewFacts = {
  readonly name: string;
  readonly status: TaskStatus;
  readonly taskKey?: string | undefined;
  readonly repository?: string | undefined;
  /** How many of its threads wait on the reader; none said at none. */
  readonly needsYou: number;
  readonly agents: readonly PreviewAgent[];
};

/** What an agent's preview draws: its task, its tile and name, where it stands with its model and where it runs, its latest step, its pull request, and how many of its threads need the reader. */
type AgentPreviewFacts = {
  readonly name: string;
  /** The provider whose harness it runs in, whose mark its tile wears; the hard hat where it is not known. */
  readonly harness?: ModelProvider | undefined;
  /** A Manager's face, which stands in its tile's place; none for any other agent. */
  readonly face?: ManagerFace | undefined;
  readonly status: AgentStatus;
  readonly task?: PreviewTask | undefined;
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
};

/** What a row's long press lifts over its menu, a glance at what the row opens, as the system's own apps lift one: a thread's, a task's, or an agent's. */
export type RowPreview =
  | ({ readonly kind: typeof ROW_PREVIEW.THREAD } & ThreadPreviewFacts)
  | ({ readonly kind: typeof ROW_PREVIEW.TASK } & TaskPreviewFacts)
  | ({ readonly kind: typeof ROW_PREVIEW.AGENT } & AgentPreviewFacts);

/** A thread's preview: its task's ring and name, its title, and its newest messages, each under its writer and time, cut to a few lines, as Mail's preview shows the message a long press lifts. */
export function threadPreview(facts: ThreadPreviewFacts): RowPreview {
  return { kind: ROW_PREVIEW.THREAD, ...facts };
}

/** A task's preview, its Overview at a glance: its status, key and repository over its name, how many of its threads need the reader, and its agents, the first few named and the rest counted. */
export function taskPreview(facts: TaskPreviewFacts): RowPreview {
  return { kind: ROW_PREVIEW.TASK, ...facts };
}

/** An agent's preview: its task's ring and name, its tile and name as its page heads it, where it stands, its latest step where the app holds its transcript, its pull request, and how many of its threads need the reader. */
export function agentPreview(facts: AgentPreviewFacts): RowPreview {
  return { kind: ROW_PREVIEW.AGENT, ...facts };
}

/** What a node of a preview's tree is: a column or a row of nodes, words, a glyph, the working mark, an agent's tile, a person's face, or a hairline. */
const PREVIEW_NODE = {
  COLUMN: "column",
  ROW: "row",
  TEXT: "text",
  GLYPH: "glyph",
  WORKING: "working",
  TILE: "tile",
  FACE: "face",
  RULE: "rule",
} as const;

/** A text style a preview's words and glyphs stand at, SwiftUI's own by its name. */
type PreviewTextStyle = (typeof TYPE_ROLE)[keyof typeof TYPE_ROLE];

/** A glyph by the asset catalog's name or an SF Symbol's. */
type PreviewGlyph = { readonly asset?: string | undefined; readonly system?: string | undefined };

/**
 * One node of a preview's tree, each holding what the native module needs to
 * draw it as the React Native marks drew it, its inks resolved and its sizes
 * scaled: a column, leading, or a row, centered, of nodes `spacing` apart;
 * words at a text style, cut to `lines`; a glyph at a text style or a size;
 * the working mark's grid; an agent's tile; a person's face, their photo or
 * their letter on their hue; or a hairline.
 */
type PreviewNode =
  | {
      readonly kind: typeof PREVIEW_NODE.COLUMN | typeof PREVIEW_NODE.ROW;
      readonly spacing: number;
      readonly nodes: readonly PreviewNode[];
    }
  | {
      readonly kind: typeof PREVIEW_NODE.TEXT;
      readonly words: string;
      readonly style: PreviewTextStyle;
      readonly weight?: "semibold" | "medium" | undefined;
      readonly ink: string;
      readonly lines?: number | undefined;
      /** Whether its figures stand tabular, as a time's do. */
      readonly digits?: boolean | undefined;
      /** Whether it keeps its whole width, as a time beside a name does. */
      readonly fixed?: boolean | undefined;
    }
  | (PreviewGlyph & {
      readonly kind: typeof PREVIEW_NODE.GLYPH;
      readonly ink: string;
      readonly style?: PreviewTextStyle | undefined;
      readonly size?: number | undefined;
    })
  | {
      readonly kind: typeof PREVIEW_NODE.WORKING;
      readonly ink: string;
      /** Its side, a cell's, a step from one cell to the next, and the grid's inset from its corner, each scaled. */
      readonly side: number;
      readonly cell: number;
      readonly pitch: number;
      readonly inset: number;
      readonly track: readonly (readonly [number, number])[];
      readonly dots: readonly { readonly restsOn: number; readonly tail: boolean }[];
      readonly opacity: { readonly track: number; readonly tail: number; readonly lead: number };
    }
  | {
      readonly kind: typeof PREVIEW_NODE.TILE;
      readonly size: number;
      readonly corner: number;
      readonly well: string;
      readonly ink: string;
      /** The harness's mark, at `side`; the hard hat's glyph at its size where the harness is not known. */
      readonly mark?: { readonly asset: string; readonly side: number } | undefined;
      readonly glyph?: (PreviewGlyph & { readonly size: number }) | undefined;
    }
  | {
      readonly kind: typeof PREVIEW_NODE.FACE;
      readonly size: number;
      readonly corner: number;
      readonly hue: string;
      readonly letter: string;
      readonly letterSize: number;
      readonly letterInk: string;
      /** The photo's address, asked for at the size it is drawn; their letter alone where none is given, or where it cannot be read. */
      readonly picture?: string | undefined;
    }
  | { readonly kind: typeof PREVIEW_NODE.RULE; readonly ink: string };

/** A preview's tree: its width, its inset, its ground, and its nodes in a column. */
export type PreviewTree = {
  readonly width: number;
  readonly padding: number;
  readonly ground: string;
  readonly root: PreviewNode;
};

/** What a preview is drawn in: the theme's inks, a status tone's, the reader's text scale for marks drawn at a size of their own (`useScaledSize`), whether the theme is dark, the screen's pixel ratio a photo is asked for at, and the moment its times count from. */
export type PreviewLook = {
  readonly colors: Pick<
    BrandColors,
    "GROUND" | "TEXT" | "TEXT_BODY" | "TEXT_MUTED" | "ACCENT_TEXT" | "CHIP_EDGE" | "WELL" | "DANGER"
  >;
  readonly tone: (tone: StatusTone) => string;
  readonly scale: number;
  readonly dark: boolean;
  readonly pixelRatio: number;
  readonly now: number;
};

/** The pieces of a line that say something, joined. */
function lineOf(parts: readonly (string | undefined)[]): string {
  return parts.filter((part) => part !== undefined && part !== "").join(LINE_PART);
}

/** A glyph by its catalog's name or the system's. */
function previewGlyph(glyph: Glyph): PreviewGlyph {
  const image = glyphImage(glyph);

  return "assetName" in image ? { asset: image.assetName } : { system: image.systemName };
}

function column(spacing: number, nodes: readonly (PreviewNode | undefined)[]): PreviewNode {
  return { kind: PREVIEW_NODE.COLUMN, spacing, nodes: nodes.filter((node) => node !== undefined) };
}

function row(spacing: number, nodes: readonly (PreviewNode | undefined)[]): PreviewNode {
  return { kind: PREVIEW_NODE.ROW, spacing, nodes: nodes.filter((node) => node !== undefined) };
}

/** A task's status as its ring, in its tone's ink, at the scaled glyph size, as `TaskStatusMark` draws it. */
function statusMark(status: TaskStatus, look: PreviewLook): PreviewNode {
  return {
    kind: PREVIEW_NODE.GLYPH,
    ...previewGlyph(STATUS_MARK_SYMBOL[status]),
    ink: look.tone(TASK_STATUS_TONE[status]),
    size: MARK_SIZE.GLYPH * look.scale,
  };
}

/** A glyph in a tone's ink at a text style's size, as `ToneGlyph` draws it. */
function toneGlyph(
  glyph: Glyph,
  tone: StatusTone,
  style: PreviewTextStyle,
  look: PreviewLook,
): PreviewNode {
  return { kind: PREVIEW_NODE.GLYPH, ...previewGlyph(glyph), ink: look.tone(tone), style };
}

/** The working mark, two pixels chasing round a 3×3 grid, its side scaled, as `WorkingMark` draws it. */
function workingMark(look: PreviewLook): PreviewNode {
  return {
    kind: PREVIEW_NODE.WORKING,
    ink: look.colors.TEXT_MUTED,
    side: WORKING_SIDE * look.scale,
    cell: WORKING_CELL * look.scale,
    pitch: WORKING_PITCH * look.scale,
    inset: WORKING_INSET * look.scale,
    track: WORKING_TRACK,
    dots: WORKING_DOTS,
    opacity: {
      track: WORKING_OPACITY.TRACK,
      tail: WORKING_OPACITY.TAIL,
      lead: WORKING_OPACITY.LEAD,
    },
  };
}

/** An agent's mark as a preview's line leads with it: the working mark while it works, the alert where it failed, nothing at rest. */
function agentStateMark(status: AgentStatus, look: PreviewLook): PreviewNode | undefined {
  const state = agentGlyphState(status);

  if (state === GLYPH_STATE.WORKING) return workingMark(look);

  if (state === GLYPH_STATE.FAILED)
    return {
      kind: PREVIEW_NODE.GLYPH,
      ...previewGlyph(GLYPH.FAILED),
      ink: look.colors.DANGER,
      style: TYPE_ROLE.TIME,
    };

  return undefined;
}

/** A tile with no well, so a Manager's face, which draws its own body, stands on the preview's ground alone. */
const NO_WELL = "#00000000";

/** An agent's tile, its harness's mark on the brand's well, or the hard hat where the harness is not known, as `AgentTile` draws it; a Manager's face in its place, at rest, as its row wears it (`managerFaceAsset`). */
function agentTile(
  harness: ModelProvider | undefined,
  size: number,
  look: PreviewLook,
  face?: ManagerFace | undefined,
): PreviewNode {
  if (face !== undefined)
    return {
      kind: PREVIEW_NODE.TILE,
      size,
      corner: 0,
      well: NO_WELL,
      ink: look.colors.TEXT,
      mark: { asset: managerFaceAsset(face, false), side: size },
    };

  return {
    kind: PREVIEW_NODE.TILE,
    size,
    corner: size * TILE_ROUNDING,
    well: look.colors.WELL,
    ink: look.colors.TEXT,
    ...(harness === undefined
      ? { glyph: { ...previewGlyph(GLYPH.AGENT), size: size * TILE_GLYPH_SCALE } }
      : { mark: { asset: HARNESS_MARK_ASSET[harness], side: size * TILE_MARK_SCALE } }),
  };
}

/** A person's face, their photo where one is given and their letter on their name's hue otherwise, as `Avatar` draws it. */
function face(
  name: string,
  picture: string | undefined,
  size: number,
  look: PreviewLook,
): PreviewNode {
  const pinned = pinnedPictureUrl(picture);

  return {
    kind: PREVIEW_NODE.FACE,
    size,
    corner: size / 2,
    hue: tileHue(name, look.dark),
    letter: identityLetter(name),
    letterSize: size * LETTER_SCALE,
    letterInk: ON_IDENTITY,
    picture: pinned === undefined ? undefined : accountPictureAt(pinned, size * look.pixelRatio),
  };
}

/** A preview's path over its heading: a mark and small muted words, as a pushed page's bar names its path. */
function path(mark: PreviewNode | undefined, words: string, look: PreviewLook): PreviewNode {
  return row(SPACE.TIGHT + 2, [
    mark,
    {
      kind: PREVIEW_NODE.TEXT,
      words,
      style: TYPE_ROLE.ROW_LINE,
      ink: look.colors.TEXT_MUTED,
      lines: PREVIEW_LINES.PATH,
    },
  ]);
}

/** A task's path, its ring and name; none for a row with no task. */
function taskPath(task: PreviewTask | undefined, look: PreviewLook): PreviewNode | undefined {
  if (task === undefined) return undefined;

  return path(
    task.status === undefined ? undefined : statusMark(task.status, look),
    task.name,
    look,
  );
}

/** A preview's heading, as the page it opens heads itself: 20 pt semibold. */
function heading(words: string, look: PreviewLook): PreviewNode {
  return {
    kind: PREVIEW_NODE.TEXT,
    words,
    style: TYPE_ROLE.PAGE_HEADING,
    weight: "semibold",
    ink: look.colors.TEXT,
    lines: PREVIEW_LINES.HEADING,
  };
}

/** A preview's line, in the row line's style, in an ink, the muted one where none is given. */
function line(words: string, look: PreviewLook, ink: string = look.colors.TEXT_MUTED): PreviewNode {
  return {
    kind: PREVIEW_NODE.TEXT,
    words,
    style: TYPE_ROLE.ROW_LINE,
    ink,
    lines: PREVIEW_LINES.LINE,
  };
}

/** A preview's hairline between its head and what follows, in the rows' own edge ink. */
function rule(look: PreviewLook): PreviewNode {
  return { kind: PREVIEW_NODE.RULE, ink: look.colors.CHIP_EDGE };
}

/** Words in a row's title style and the body's ink, cut to `lines`, as a message's or a step's words stand. */
function body(words: string, lines: number | undefined, look: PreviewLook): PreviewNode {
  return {
    kind: PREVIEW_NODE.TEXT,
    words,
    style: TYPE_ROLE.ROW_TITLE,
    ink: look.colors.TEXT_BODY,
    lines,
  };
}

/** One message of a thread's preview: its writer's tile or face and name, its time, and its words under them. */
function messageNode(message: PreviewMessage, look: PreviewLook): PreviewNode {
  return column(SPACE.TIGHT, [
    row(SPACE.TIGHT + 2, [
      message.agent
        ? agentTile(message.harness, MARK_SIZE.WRITER, look)
        : face(message.writer, message.picture, MARK_SIZE.WRITER, look),
      {
        kind: PREVIEW_NODE.TEXT,
        words: message.writer,
        style: TYPE_ROLE.ROW_LINE,
        weight: "semibold",
        ink: look.colors.TEXT,
        lines: 1,
      },
      {
        kind: PREVIEW_NODE.TEXT,
        words: sinceText(message.at, look.now),
        style: TYPE_ROLE.TIME,
        ink: look.colors.TEXT_MUTED,
        digits: true,
        fixed: true,
      },
    ]),
    body(message.words, PREVIEW_LINES.MESSAGE, look),
  ]);
}

/** One agent among a task's preview's: its tile, its name, and its mark and the word for where it stands. */
function agentNode(agent: PreviewAgent, look: PreviewLook): PreviewNode {
  const words = agentStateWords(agent.status);

  return row(SPACE.TIGHT + 2, [
    agentTile(agent.harness, MARK_SIZE.WRITER, look),
    body(agent.name, 1, look),
    agentStateMark(agent.status, look),
    words === undefined ? undefined : line(words, look),
  ]);
}

/** A thread's preview's nodes. */
function threadNodes(
  facts: ThreadPreviewFacts,
  look: PreviewLook,
): readonly (PreviewNode | undefined)[] {
  return [
    taskPath(facts.task, look),
    heading(facts.title, look),
    facts.messages.length === 0 ? undefined : rule(look),
    ...facts.messages.map((message) => messageNode(message, look)),
  ];
}

/** A task's preview's nodes. */
function taskNodes(
  facts: TaskPreviewFacts,
  look: PreviewLook,
): readonly (PreviewNode | undefined)[] {
  const named = facts.agents.slice(0, PREVIEW_AGENTS);
  const more = facts.agents.length - named.length;

  return [
    path(
      statusMark(facts.status, look),
      lineOf([TASK_STATUS_WORDS[facts.status], facts.taskKey, facts.repository]),
      look,
    ),
    heading(facts.name, look),
    facts.needsYou === 0
      ? undefined
      : line(needsYouWords(facts.needsYou), look, look.colors.ACCENT_TEXT),
    ...(facts.agents.length === 0
      ? []
      : [
          rule(look),
          {
            kind: PREVIEW_NODE.TEXT,
            words: `${AGENTS_WORDS.HEAD} ${facts.agents.length}`,
            style: TYPE_ROLE.GROUP_HEADER,
            weight: "medium",
            ink: look.colors.TEXT_MUTED,
            digits: true,
          } as const,
          ...named.map((agent) => agentNode(agent, look)),
          more === 0 ? undefined : line(AGENTS_WORDS.MORE(more), look),
        ]),
  ];
}

/** An agent's preview's nodes. */
function agentNodes(
  facts: AgentPreviewFacts,
  look: PreviewLook,
): readonly (PreviewNode | undefined)[] {
  const pull =
    facts.pullRequest === undefined
      ? undefined
      : PULL_REQUEST_LOOK[pullRequestMarkState(facts.pullRequest)];

  return [
    taskPath(facts.task, look),
    row(SPACE.ROW, [
      agentTile(facts.harness, MARK_SIZE.AVATAR, look, facts.face),
      heading(facts.name, look),
    ]),
    row(SPACE.TIGHT + 2, [
      agentStateMark(facts.status, look),
      line(lineOf([agentStateWords(facts.status), facts.model, facts.runsOn]), look),
    ]),
    ...(facts.step === undefined ? [] : [rule(look), body(facts.step, PREVIEW_LINES.STEP, look)]),
    facts.pullRequest === undefined || pull === undefined
      ? undefined
      : row(SPACE.TIGHT, [
          toneGlyph(pull.symbol, pull.tone, TYPE_ROLE.ROW_LINE, look),
          line(`#${facts.pullRequest.number}`, look),
        ]),
    facts.waiting === 0
      ? undefined
      : line(needsYouWords(facts.waiting), look, look.colors.ACCENT_TEXT),
  ];
}

/**
 * A preview as the native module draws it when the menu opens, as the React
 * Native previews drew it: on the brand's ground, padded to the screen's
 * edge, at a phone's width, its nodes in a column, each with its inks
 * resolved and its marks' sizes scaled by the reader's text size.
 */
export function previewTree(preview: RowPreview, look: PreviewLook): PreviewTree {
  const nodes =
    preview.kind === ROW_PREVIEW.THREAD
      ? threadNodes(preview, look)
      : preview.kind === ROW_PREVIEW.TASK
        ? taskNodes(preview, look)
        : agentNodes(preview, look);

  return {
    width: PREVIEW_WIDTH,
    padding: SPACE.EDGE,
    ground: look.colors.GROUND,
    root: column(SPACE.ROW, nodes),
  };
}
