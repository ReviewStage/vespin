import type { DatabaseServices } from "@repo/database/core/query";
import { readAgentHeaderOfConversation } from "@repo/database/models/agent-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  CONVERSATION_MEDIA_TYPE,
  PICTURE_OMISSION,
} from "@repo/features/conversation-picture-wire";
import {
  COMPUTER_ACTION,
  COMPUTER_BOUNDS,
  COMPUTER_MOUSE_BUTTON,
  COMPUTER_RECORDING_BOUNDS,
  COMPUTER_SCROLL_DIRECTION,
  type ComputerAction,
  type ComputerApp,
  type ComputerCursor,
  type ComputerOutcome,
  type ComputerShot,
  MACHINE_COMMAND_KIND,
  type MacComputerAction,
  macComputerActionSchema,
} from "@repo/features/machine-command-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  RECORDING_FAILURE,
  type RecordingFailure,
  recordingCaptionSchema,
} from "@repo/features/recording-wire";
import { mp4Dimensions } from "@repo/features/video-signature";
import { isRecord, type UnparsedWireValue, unparsedWire } from "@repo/wire";
import { describeWire, readEither } from "@repo/wire/effect";
import { Effect, Option, Predicate, Result, Schema } from "effect";
import { logStoreFailure } from "../http/store-failure.js";
import { type KeptPictureNote, keepPictureNote } from "../storage/attachment-keeps.js";
import type { InboxSandboxDoor } from "./coder-host/inbox-image.js";
import { COMMAND_DESCRIPTION } from "./command-description.js";
import {
  askMachine,
  MACHINE_COMMAND_STATUS,
  type MachineCommandAnswer,
  machineCommandNotRun,
  NO_MACHINE_INPUT,
  namesMachine,
  routedCall,
} from "./machine-command.js";
import { keepRecording, RECORDING_WORDS, recordingTooLarge } from "./recording-keep.js";

/**
 * computer-tool.ts -- the `computer` tool: an agent sees and uses one app on the developer's own Mac at a time, in the background, through the Mac's computer-use helper.
 *
 * Every agent may call it, the brain, a coding agent, and either's workers,
 * wherever it runs, since the Mac it reaches is routed as `run_on_mac`'s is
 * (`machine-routing.ts`): the agent's pick, or else its owner's default
 * machine; a call names none. One call is one action, queued as a computer command for that
 * machine (`machine-command.ts`'s `askMachine`): the Mac asks the developer
 * about the app the first time it is used, for as long as its ask stands
 * (`machineAskSeconds`), and the action then runs within
 * `COMPUTER_TOOL_TIMEOUT_SECONDS`.
 *
 * Reading an app answers its window twice, as the browser's screenshot
 * does: a copy at most `COMPUTER_SHOTS.MODEL.edge` pixels long, which the
 * model is handed as an image, and one at its own size up to
 * `COMPUTER_SHOTS.KEPT.edge`, kept beside the transcript the call is written
 * to (`keepPictureBytesOne`) and named in the result by id, so the
 * window draws it. The app's icon is kept the same way, once per
 * transcript, since pictures are kept by their bytes. Neither picture's
 * base64 is spelled out in the result the conversation stores.
 *
 * An action that can change the window asks the Mac for one picture of it
 * once it has settled, at the kept copy's size, so the people watching see
 * it catch up with the agent's cursor; it is kept beside the transcript as
 * a read's is, and answered under `watched`, which the model is never
 * handed: the agent's text leaves it out (`storedComputerOutput`), and the
 * call carries it apart, in its result's `_meta` (`computerWatched`), to
 * the transcript alone. A Mac from before it answers no picture.
 *
 * An app's window is recorded as the browser is, with `record` and
 * `stop_recording`, under the same limits and words where they mean the
 * same (`recording-keep.ts`): the Mac records the window, the agent's
 * cursor drawn over it, as an H.264 MP4 on its own disk, where it stays
 * until the next recording; the stop posts its video up apart from the
 * result (`askMacHeard`), and the video is kept beside the transcript as
 * it came, which every player plays, and saved on the agent's machine,
 * where it has one, so the agent can post it. The model is never handed it.
 */

/** How long one action may run once its app is allowed; the ask before it stands apart (`machineAskSeconds`). */
const COMPUTER_TOOL_TIMEOUT_SECONDS = 120;

/** The two screenshots a read asks for: the model's copy, and the one kept beside the transcript. */
const COMPUTER_SHOTS = {
  MODEL: { edge: 1280, quality: 0.7 },
  KEPT: { edge: 2560, quality: 0.8 },
} as const;

/** The actions that can change their app's window, after which the Mac is asked for one picture of it as it settled. */
const SETTLING_ACTIONS: ReadonlySet<string> = new Set([
  COMPUTER_ACTION.CLICK,
  COMPUTER_ACTION.TYPE_TEXT,
  COMPUTER_ACTION.PRESS_KEY,
  COMPUTER_ACTION.SCROLL,
  COMPUTER_ACTION.DRAG,
  COMPUTER_ACTION.SET_VALUE,
  COMPUTER_ACTION.PERFORM_SECONDARY_ACTION,
]);

const elementIndexValue = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: COMPUTER_BOUNDS.MAX_ELEMENT_INDEX }),
);

const coordinateValue = (words: string) =>
  describeWire(
    Schema.Finite.check(
      Schema.isBetween({
        minimum: -COMPUTER_BOUNDS.MAX_COORDINATE,
        maximum: COMPUTER_BOUNDS.MAX_COORDINATE,
      }),
    ),
    words,
  );

const coordinate = (words: string) => Schema.optionalKey(coordinateValue(words));

/** Where a click presses: an element by its number, or a point in the app's last screenshot. */
const clickTarget = describeWire(
  Schema.Union([
    Schema.Struct({
      element_index: describeWire(
        elementIndexValue,
        "An element's number, as the app's last get_app_state numbered it.",
      ),
    }),
    Schema.Struct({
      x: coordinateValue("A point's x in the pixels of the app's last screenshot."),
      y: coordinateValue("A point's y in the pixels of the app's last screenshot."),
    }),
  ]),
  "Where click presses: {element_index} for an element by the number the app's last " +
    "get_app_state gave it, or {x, y} for a point in the pixels of its last screenshot.",
);

/**
 * The tool's input. Note that it stays one flat object, because a tool's
 * input must be an object at its top, and because the panel, released
 * desktops' among them, reads `action` and `app` off a stored call, and
 * `machine` off one from before the tool took none; which fields each action takes is held by `ACTION_FIELDS` instead.
 */
const COMPUTER_INPUT = Schema.Struct({
  action: describeWire(
    Schema.Literals(Object.values(COMPUTER_ACTION)),
    "What to do, with only the fields that action takes: list_apps (none); get_app_state, to " +
      "read an app's window (app); click (app, target, and optionally click_count and " +
      "mouse_button); type_text (app, text); press_key (app, key); scroll (app, and optionally " +
      "element_index, direction, and pages); drag (app, from_x, from_y, to_x, to_y); set_value " +
      "(app, element_index, value); perform_secondary_action (app, element_index, " +
      "secondary_action); record, to record its window as a video (app); and stop_recording, " +
      "to stop and keep it (optionally caption).",
  ),
  app: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(COMPUTER_BOUNDS.MAX_APP_CHARS)),
      'The app, by its name or bundle id, such as "Simulator" or "com.apple.iphonesimulator". ' +
        "Every action but list_apps and stop_recording names one.",
    ),
  ),
  target: Schema.optionalKey(clickTarget),
  element_index: Schema.optionalKey(
    describeWire(
      elementIndexValue,
      "The element scroll, set_value, or perform_secondary_action acts on, by the number the " +
        "app's last get_app_state gave it.",
    ),
  ),
  click_count: Schema.optionalKey(
    describeWire(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: COMPUTER_BOUNDS.MAX_CLICKS })),
      "How many times click presses, 2 for a double-click; 1 when left out.",
    ),
  ),
  mouse_button: Schema.optionalKey(
    describeWire(
      Schema.Literals(Object.values(COMPUTER_MOUSE_BUTTON)),
      "Which button click presses; left when left out.",
    ),
  ),
  text: Schema.optionalKey(
    describeWire(
      Schema.String.check(
        Schema.isMinLength(1),
        Schema.isMaxLength(COMPUTER_BOUNDS.MAX_TEXT_CHARS),
      ),
      "What type_text types into the app's focused element.",
    ),
  ),
  key: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(COMPUTER_BOUNDS.MAX_KEY_CHARS)),
      'What press_key presses, xdotool-style, such as "Return", "Tab", or "super+c".',
    ),
  ),
  direction: Schema.optionalKey(
    describeWire(
      Schema.Literals(Object.values(COMPUTER_SCROLL_DIRECTION)),
      "Which way scroll moves; down when left out.",
    ),
  ),
  pages: Schema.optionalKey(
    describeWire(
      Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: COMPUTER_BOUNDS.MAX_PAGES })),
      "How far scroll moves, in pages; 1 when left out.",
    ),
  ),
  from_x: coordinate("Where drag starts, in the pixels of the app's last screenshot."),
  from_y: coordinate("Where drag starts, in the pixels of the app's last screenshot."),
  to_x: coordinate("Where drag ends, in the pixels of the app's last screenshot."),
  to_y: coordinate("Where drag ends, in the pixels of the app's last screenshot."),
  value: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isMaxLength(COMPUTER_BOUNDS.MAX_TEXT_CHARS)),
      "What set_value sets a settable element to.",
    ),
  ),
  secondary_action: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(COMPUTER_BOUNDS.MAX_KEY_CHARS)),
      "Which of the element's secondary actions perform_secondary_action performs, as its " +
        'state names them, such as "AXShowMenu".',
    ),
  ),
  caption: Schema.optionalKey(recordingCaptionSchema),
  description: COMMAND_DESCRIPTION,
});

type ComputerInput = typeof COMPUTER_INPUT.Type;

/** A field only some actions take: every one but those each call names. */
type ActionField = Exclude<keyof ComputerInput, "action" | "description">;

/** What one action takes: the fields it needs and those it may name. */
interface ActionFields {
  readonly needs: readonly ActionField[];
  readonly may: readonly ActionField[];
}

/** The fields each action takes; any other is refused. */
const ACTION_FIELDS = {
  [COMPUTER_ACTION.LIST_APPS]: { needs: [], may: [] },
  [COMPUTER_ACTION.GET_APP_STATE]: { needs: ["app"], may: [] },
  [COMPUTER_ACTION.CLICK]: { needs: ["app", "target"], may: ["click_count", "mouse_button"] },
  [COMPUTER_ACTION.TYPE_TEXT]: { needs: ["app", "text"], may: [] },
  [COMPUTER_ACTION.PRESS_KEY]: { needs: ["app", "key"], may: [] },
  [COMPUTER_ACTION.SCROLL]: { needs: ["app"], may: ["element_index", "direction", "pages"] },
  [COMPUTER_ACTION.DRAG]: { needs: ["app", "from_x", "from_y", "to_x", "to_y"], may: [] },
  [COMPUTER_ACTION.SET_VALUE]: { needs: ["app", "element_index", "value"], may: [] },
  [COMPUTER_ACTION.PERFORM_SECONDARY_ACTION]: {
    needs: ["app", "element_index", "secondary_action"],
    may: [],
  },
  [COMPUTER_ACTION.RECORD]: { needs: ["app"], may: [] },
  [COMPUTER_ACTION.STOP_RECORDING]: { needs: [], may: ["caption"] },
} as const satisfies Record<ComputerAction, ActionFields>;

const isActionField = (key: string): key is ActionField =>
  key !== "action" && key !== "description" && key in COMPUTER_INPUT.fields;

const isComputerAction = Schema.is(Schema.Literals(Object.values(COMPUTER_ACTION)));

const readInput = readEither(COMPUTER_INPUT);
const readAction = readEither(macComputerActionSchema);

/** A field as a refusal names it, with the shape of the one whose shape is not plain. */
function fieldWords(field: ActionField): string {
  return field === "target" ? "`target` ({element_index} or {x, y})" : `\`${field}\``;
}

/** A list of fields in words: "`a`, `b`, and `c`". */
function listed(fields: readonly ActionField[]): string {
  const words = fields.map(fieldWords);
  const last = words.pop();

  if (last === undefined) return "";

  if (words.length === 0) return last;

  return `${words.join(", ")}${words.length > 1 ? "," : ""} and ${last}`;
}

/** Which fields an action takes, in words, so a refused call is fixed in one retry. */
function takes(action: ComputerAction): string {
  const { needs, may }: ActionFields = ACTION_FIELDS[action];

  if (needs.length === 0 && may.length === 0) return `${action} takes no other field.`;

  if (may.length === 0) return `${action} takes ${listed(needs)}.`;

  if (needs.length === 0) return `${action} may take ${listed(may)}.`;

  return `${action} takes ${listed(needs)}, and may take ${listed(may)}.`;
}

/** What a call that names no readable action is told: the actions there are. */
const NAME_AN_ACTION =
  `Not run: name the \`action\`, one of ${Object.values(COMPUTER_ACTION).join(", ")}, ` +
  "with only the fields that action takes.";

/** Why an input was refused before it was read, naming the field it failed at and what its action takes. */
function unreadable(input: UnparsedWireValue, path: readonly (string | number)[]): string {
  const [field] = path;
  const action = isRecord(input) ? input.action : undefined;

  if (field === undefined || field === "action" || !isComputerAction(action)) return NAME_AN_ACTION;
  const named = String(field);

  const why =
    named in COMPUTER_INPUT.fields
      ? `\`${path.join(".")}\` is not a value it takes`
      : `computer has no field \`${named}\``;

  return `Not run: ${why}. ${takes(action)}`;
}

/** Why an input names fields its action does not take or leaves out one it needs; none where it names exactly what it takes. */
function misfit(input: ComputerInput): string | undefined {
  const { needs, may }: ActionFields = ACTION_FIELDS[input.action];
  const missing = needs.filter((field) => input[field] === undefined);

  const extra = Object.keys(input)
    .filter(isActionField)
    .filter((field) => !needs.includes(field) && !may.includes(field));

  if (missing.length === 0 && extra.length === 0) return undefined;

  const why = [
    missing.length === 0 ? undefined : `${input.action} needs ${listed(missing)}`,
    extra.length === 0 ? undefined : `${input.action} takes no ${listed(extra)}`,
  ].filter(Predicate.isNotUndefined);

  return `Not run: ${why.join(", and ")}. ${takes(input.action)}`;
}

/** Why a call ran nothing before it reached the Mac, in words the model can act on. */
const COMPUTER_TOOL_REFUSAL = {
  UNAVAILABLE: "Not run: the developer's Mac could not be found. The call may be made again.",
} as const;

/**
 * The tool as every agent is offered it: its name, its words, and its
 * input schema.
 */
export const COMPUTER_TOOL = {
  name: AGENT_TOOL.COMPUTER,
  description:
    "See and use one app on the developer's own Mac, in the background, while they keep " +
    "working: its window as numbered elements and a screenshot, and clicks, typing, keys, " +
    "scrolls, and drags on it. Start with list_apps or get_app_state; act on an element by the " +
    "number the app's last get_app_state gave it, or on a point in its screenshot's pixels, " +
    "and read the app again after you act, since its numbers change with it. Each action takes " +
    "only its own fields, which `action` lists, and a call naming another is refused. A click answers " +
    "that it was sent, not that the app took it: an app in the background, a browser above " +
    "all, may drop a click at a point, so press an element by its number where one serves, " +
    "and read the app again to see what a click did. An app not " +
    "running is opened behind the developer's windows. The developer's Mac asks them the " +
    "first time an agent uses each app, and they may decline, in which case the call answers " +
    "`not-run`; agents are never offered terminals, password managers, System Settings, or " +
    `${PRODUCT_NAME}. Reach for it last: an integration's tools where one serves the app, ` +
    "run_on_mac where a shell can do it, and browser, where you have it, for localhost and public " +
    "pages. Use this for what only an app's window shows or takes, a browser on the developer's " +
    "Mac among them, " +
    "such as a page that needs their own signed-in session. To show the developer a flow you " +
    "drove in an app, the iOS Simulator above all, record it: record starts a video of the " +
    "app's window, your cursor drawn over it while it records, " +
    `up to ${COMPUTER_RECORDING_BOUNDS.MAX_SECONDS} seconds and across calls, and ` +
    "stop_recording, with a caption, stops it and keeps it in your transcript, where it plays; " +
    "it stops by itself once its time runs out, and stop_recording still keeps it then. Its " +
    "answer names the path the video stays at on your machine until your next recording, by " +
    "which you can post it to a thread, or says why it has none.",
  inputSchema: COMPUTER_INPUT,
} as const;

/**
 * The action the input names, as the Mac's helper reads it, or why the
 * input makes none: a field its action does not take or leaves out.
 */
function actionOf(input: ComputerInput): Result.Result<MacComputerAction, string> {
  const refused = misfit(input);

  if (refused !== undefined) return Result.fail(refused);

  const {
    action,
    secondary_action,
    target,
    caption: _caption,
    description: _description,
    ...fields
  } = input;

  const read = readAction({
    op: action,
    ...fields,
    ...target,
    ...(secondary_action === undefined ? undefined : { action: secondary_action }),
    ...(action === COMPUTER_ACTION.GET_APP_STATE
      ? { shots: [COMPUTER_SHOTS.MODEL, COMPUTER_SHOTS.KEPT] }
      : undefined),
    ...(SETTLING_ACTIONS.has(action) ? { shot: COMPUTER_SHOTS.KEPT } : undefined),
    ...(action === COMPUTER_ACTION.RECORD
      ? {
          max_seconds: COMPUTER_RECORDING_BOUNDS.MAX_SECONDS,
          max_bytes: COMPUTER_RECORDING_BOUNDS.MAX_BYTES,
        }
      : undefined),
  });

  return Result.isSuccess(read)
    ? Result.succeed(read.success)
    : Result.fail(`Not run: ${takes(action)}`);
}

/**
 * One picture's base64 kept beside the transcript (`keepPictureNote`);
 * where the store failed, logged and named as not kept for want of room.
 */
function kept(
  transcript: ConversationTarget,
  base64: string,
): Effect.Effect<KeptPictureNote, never, DatabaseServices> {
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));

  return keepPictureNote(transcript, bytes).pipe(
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(
      (): KeptPictureNote => ({ omitted: PICTURE_OMISSION.LIMIT, byteCount: bytes.byteLength }),
    ),
  );
}

/** The model's copy of a window, as the result carries it until the catalog hands it on as an image. */
const SHOWN_MEDIA_TYPE = "image/jpeg";

/** What a call that reached the Mac and ran answers: what the action came to, its pictures kept or handed on. */
type ComputerRan = { readonly status: typeof MACHINE_COMMAND_STATUS.RAN } & object;

/** An app as the result names it: its icon kept beside the transcript rather than spelled out. */
function namedApp(
  transcript: ConversationTarget,
  app: ComputerApp,
): Effect.Effect<object, never, DatabaseServices> {
  const { iconPng, ...named } = app;

  if (iconPng === undefined) return Effect.succeed(named);

  return Effect.map(kept(transcript, iconPng), (icon) => ({ ...named, icon }));
}

/** What an action came to apart from a recording's stop, which `keptMacRecording` answers. */
type ActedOutcome = Exclude<
  ComputerOutcome,
  { readonly recorded: unknown } | { readonly unrecorded: unknown }
>;

/** Where the agent's cursor stands once the action landed, as a share of the app's last read window, which the panel draws its pointer at; none where the Mac answered none. */
function cursorOf(outcome: { readonly cursor?: ComputerCursor }): object | undefined {
  return outcome.cursor === undefined ? undefined : { cursor: outcome.cursor };
}

/** What the people watching are shown of an action and the model never is: the window as it settled, where the Mac answered it and it was kept. */
function watchedOf(
  transcript: ConversationTarget,
  shot: ComputerShot | undefined,
): Effect.Effect<object | undefined, never, DatabaseServices> {
  if (shot === undefined || shot.jpeg === "") return Effect.succeed(undefined);

  return Effect.map(kept(transcript, shot.jpeg), (note) =>
    "picture" in note ? { watched: { kept: note } } : undefined,
  );
}

/** What a call answers for what the action came to, its pictures kept or handed on; a recording started, how long it runs at most, as the browser's answers. */
function answeredOutcome(
  transcript: ConversationTarget,
  outcome: ActedOutcome,
): Effect.Effect<ComputerRan, never, DatabaseServices> {
  const ran = { status: MACHINE_COMMAND_STATUS.RAN };

  if ("done" in outcome) {
    const acted = outcome.app;

    const done =
      outcome.done === COMPUTER_ACTION.RECORD
        ? { done: outcome.done, maxSeconds: COMPUTER_RECORDING_BOUNDS.MAX_SECONDS }
        : { done: outcome.done, ...cursorOf(outcome) };

    return Effect.gen(function* () {
      const app = acted === undefined ? undefined : { app: yield* namedApp(transcript, acted) };
      const watched = yield* watchedOf(transcript, outcome.shot);

      return { ...ran, ...done, ...app, ...watched };
    });
  }

  if ("apps" in outcome) {
    // Note that the list leaves the apps' icons out, since a read of each app keeps its own.
    const apps = outcome.apps.map(({ iconPng: _icon, ...app }) => app);

    return Effect.succeed({ ...ran, apps });
  }

  // Note that each shot keeps its own place, the model's first and the kept one second, and one with no bytes is absent there alone, so neither the model nor the transcript is handed an empty picture or the other's.
  const [first, second]: readonly (ComputerShot | undefined)[] = outcome.shots;
  const shown = first?.jpeg === "" ? undefined : first;
  const full = second?.jpeg === "" ? undefined : second;

  return Effect.gen(function* () {
    const app = yield* namedApp(transcript, outcome.app);
    const keptShot = full === undefined ? undefined : yield* kept(transcript, full.jpeg);

    return {
      ...ran,
      app,
      window: outcome.window,
      elements: outcome.elements,
      truncated: outcome.truncated,
      ...cursorOf(outcome),
      ...(shown === undefined
        ? undefined
        : {
            screenshot: {
              width: shown.width,
              height: shown.height,
              mime: SHOWN_MEDIA_TYPE,
              data: shown.jpeg,
            },
          }),
      ...(keptShot === undefined ? undefined : { kept: keptShot }),
    };
  });
}

/** Why a recording of an app did not start or stop, in words the model can act on: the words both tools share, and the Mac's own. */
const COMPUTER_RECORDING_REFUSAL = {
  ...RECORDING_WORDS,
  [RECORDING_FAILURE.EMPTY]: "the app drew nothing while it was recorded",
  [RECORDING_FAILURE.UNREACHABLE]: "the recorder could not reach the app's window",
  [RECORDING_FAILURE.TOO_LARGE]: recordingTooLarge(COMPUTER_RECORDING_BOUNDS.MAX_BYTES),
} as const satisfies Record<RecordingFailure | "UNKEPT", string>;

/** What a machine with no recording of the conversation answers, naming it, since a stop goes where the agent's calls go now, which a member may have moved while it ran. */
function noRecordingOn(machine: { readonly name: string }): string {
  return (
    `no recording of this conversation runs on ${machine.name}: one started on another machine ` +
    "stops there by itself once its time runs out; otherwise start one with record"
  );
}

/** A recording's refusal as the call answers it. */
function recordingNotRun(words: string): MachineCommandAnswer {
  return machineCommandNotRun(`Not run: ${words}.`);
}

/**
 * Where a stopped recording is saved on the agent's machine, under its
 * attachments folder: one name, which the next recording's video replaces,
 * so it stands there until then, as the browser's does in its sandbox.
 */
const SAVED_RECORDING_NAME = "recordings/computer-recording.mp4";

/** What a stop answers where the video could not be saved where the agent can post it from. */
const UNSAVED_RECORDING =
  "The video could not be saved where you can post it from, so it plays in your transcript " +
  "alone; call stop_recording again to try once more.";

/**
 * The video saved on the agent's machine through its door, where the agent
 * can post it to a thread or add it to its plan by its path; why not where
 * the agent has no machine, or it could not be reached just then.
 */
function savedForPosting(
  sandbox: InboxSandboxDoor | undefined,
  bytes: Uint8Array,
): Effect.Effect<{ readonly path: string } | { readonly unsaved: string }> {
  if (sandbox === undefined) return Effect.succeed({ unsaved: UNSAVED_RECORDING });

  return Effect.tryPromise(async () => {
    const door = await sandbox();

    if (door.writeFile === undefined) throw new Error("the sandbox door writes no file");

    return door.writeFile({ name: SAVED_RECORDING_NAME, contents: bytes });
  }).pipe(
    Effect.map((path) => ({ path })),
    Effect.orElseSucceed(() => ({ unsaved: UNSAVED_RECORDING })),
  );
}

/**
 * A stopped recording of an app as the call answers it, as the browser's
 * stop answers one (`recording-keep.ts`): the video the Mac posted, held
 * to an MP4 every player streams, saved on the agent's machine for posting,
 * and kept beside the transcript, where it plays. Note that a video that
 * never arrived is refused as one not kept, since the Mac keeps it until
 * the next recording and a stop called again posts it again.
 */
function keptMacRecording(
  transcript: ConversationTarget,
  recorded: { readonly seconds: number },
  bytes: Uint8Array | undefined,
  caption: string | undefined,
  sandbox: InboxSandboxDoor | undefined,
): Effect.Effect<MachineCommandAnswer | ComputerRan, never, DatabaseServices> {
  if (bytes === undefined) return Effect.succeed(recordingNotRun(RECORDING_WORDS.UNKEPT));
  const dimensions = mp4Dimensions(bytes);

  if (dimensions === undefined) {
    return Effect.succeed(recordingNotRun(COMPUTER_RECORDING_REFUSAL[RECORDING_FAILURE.ENCODER]));
  }

  return Effect.gen(function* () {
    const saved = yield* savedForPosting(sandbox, bytes);
    const path = "path" in saved ? saved.path : undefined;

    const kept = yield* Effect.result(
      keepRecording(
        transcript,
        { bytes, contentType: CONVERSATION_MEDIA_TYPE.MP4, ...dimensions },
        { seconds: recorded.seconds, caption, path },
      ),
    );

    if (Result.isFailure(kept)) return recordingNotRun(kept.failure);
    const ran = { status: MACHINE_COMMAND_STATUS.RAN, ...kept.success };

    return "unsaved" in saved ? { ...ran, unsaved: saved.unsaved } : ran;
  });
}

/**
 * One `computer` call made in the conversation, whichever agent made it: its
 * input read against the tool's schema and made one action, then run on the
 * machine it is routed to (`routedCall`) as `askMachine` runs a command;
 * a stopped recording kept, and saved through the agent's sandbox door,
 * where it has one, for posting. It never fails: what the Mac would not
 * run, or never answered, answers `not-run` with why.
 */
export function runComputerTool(
  target: ConversationTarget,
  input: UnparsedWireValue,
  sandbox?: InboxSandboxDoor,
): Effect.Effect<MachineCommandAnswer | ComputerRan, never, DatabaseServices> {
  if (namesMachine(input)) return Effect.succeed(machineCommandNotRun(NO_MACHINE_INPUT));
  const read = readInput(input);

  if (Result.isFailure(read)) {
    return Effect.succeed(machineCommandNotRun(unreadable(input, read.failure.path)));
  }

  const made = actionOf(read.success);

  if (Result.isFailure(made)) return Effect.succeed(machineCommandNotRun(made.failure));
  const action = made.success;
  const { caption } = read.success;

  return Effect.gen(function* () {
    const route = yield* Effect.result(routedCall(target, MACHINE_COMMAND_KIND.COMPUTER));

    // Note that a read that fails refuses, because an action on a guess could land on the wrong Mac.
    if (Result.isFailure(route)) return machineCommandNotRun(COMPUTER_TOOL_REFUSAL.UNAVAILABLE);

    // Note that the agent rides along so the Mac puts its cursor away once that agent's turn ends; a read that fails leaves it to the helper's own clock.
    const agent = yield* Effect.option(
      readAgentHeaderOfConversation(target.userId, target.conversationId),
    );

    const agentId = Option.getOrUndefined(Option.flatten(agent))?.id;

    const ask = {
      kind: MACHINE_COMMAND_KIND.COMPUTER,
      conversationId: target.conversationId,
      action,
      timeoutSeconds: COMPUTER_TOOL_TIMEOUT_SECONDS,
    };

    const { answer, recording } = yield* askMachine(
      route.success,
      agentId === undefined ? ask : { ...ask, agentId },
    );

    if (!("computer" in answer)) return answer;
    const outcome = answer.computer;

    const named = <T extends object>(ran: T) =>
      answer.machine === undefined ? ran : { ...ran, machine: answer.machine };

    if ("unrecorded" in outcome) {
      const words =
        outcome.unrecorded === RECORDING_FAILURE.NONE && answer.machine !== undefined
          ? noRecordingOn(answer.machine)
          : COMPUTER_RECORDING_REFUSAL[outcome.unrecorded];

      return named(recordingNotRun(words));
    }

    if ("recorded" in outcome) {
      return named(yield* keptMacRecording(target, outcome.recorded, recording, caption, sandbox));
    }

    return named(yield* answeredOutcome(target, outcome));
  });
}

/** The model's copy of a read window in a call's result, where it carries one; none for an empty one, which would fail the model's turn. */
export function computerScreenshot(
  output: UnparsedWireValue,
): { readonly mime: string; readonly data: string } | undefined {
  if (!isRecord(output) || !isRecord(output.screenshot)) return undefined;
  const { mime, data } = output.screenshot;

  return Predicate.isString(mime) && Predicate.isString(data) && data !== ""
    ? { mime, data }
    : undefined;
}

/**
 * A call's result as the agent reads it in words, which the transcript keeps
 * too: the model's copy of the window without its base64, a read's kept
 * copy named by id, and what only the people watching are shown
 * (`computerWatched`) left out.
 */
export function storedComputerOutput(output: UnparsedWireValue): UnparsedWireValue {
  if (!isRecord(output)) return output;
  const { watched, ...answered } = output;

  if (!isRecord(answered.screenshot)) return watched === undefined ? output : answered;
  const { data: _data, ...screenshot } = answered.screenshot;

  return unparsedWire({ ...answered, screenshot });
}

/** What a call's result holds for the people watching alone, which its result's `_meta` carries to the transcript and no model reads; none where it holds none. */
export function computerWatched(output: UnparsedWireValue): UnparsedWireValue | undefined {
  return isRecord(output) && isRecord(output.watched) ? output.watched : undefined;
}
