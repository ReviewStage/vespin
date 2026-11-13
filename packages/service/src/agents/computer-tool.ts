import type { DatabaseServices } from "@repo/database/core/query";
import { keepConversationPicture } from "@repo/database/models/conversation-pictures";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  CONVERSATION_MEDIA_TYPE,
  type KeptPicture,
  PICTURE_OMISSION,
  type PictureOmission,
} from "@repo/features/conversation-picture-wire";
import { imageDimensions, sniffImageType } from "@repo/features/image-signature";
import {
  COMPUTER_ACTION,
  COMPUTER_BOUNDS,
  COMPUTER_MOUSE_BUTTON,
  COMPUTER_RECORDING_BOUNDS,
  COMPUTER_SCROLL_DIRECTION,
  type ComputerApp,
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
import type { InboxSandboxDoor } from "./coder-host/inbox-image.js";
import { COMMAND_DESCRIPTION } from "./command-description.js";
import {
  askMachine,
  MACHINE_COMMAND_STATUS,
  MACHINE_INPUT,
  type MachineCommandAnswer,
  machineCommandNotRun,
  routedCall,
} from "./machine-command.js";
import { keepRecording, RECORDING_WORDS, recordingTooLarge } from "./recording-keep.js";

/**
 * computer-tool.ts -- the `computer` tool: an agent sees and uses one app on the developer's own Mac at a time, in the background, through the Mac's computer-use helper.
 *
 * Every agent may call it, the brain, a coding agent, and either's workers,
 * wherever it runs, since the Mac it reaches is routed as `run_on_mac`'s is
 * (`machine-routing.ts`): the machine the call names, or else the agent's
 * default. One call is one action, queued as a computer command for that
 * machine (`machine-command.ts`'s `askMachine`): the Mac asks the developer
 * about the app the first time it is used, and the call waits for that
 * answer and the action within `COMPUTER_TOOL_TIMEOUT_SECONDS`.
 *
 * Reading an app answers its window twice, as the browser's screenshot
 * does: a copy at most `COMPUTER_SHOTS.MODEL.edge` pixels long, which the
 * model is handed as an image, and one at its own size up to
 * `COMPUTER_SHOTS.KEPT.edge`, kept beside the transcript the call is written
 * to (`keepConversationPicture`) and named in the result by id, so the
 * window draws it. The app's icon is kept the same way, once per
 * transcript, since pictures are kept by their bytes. Neither picture's
 * base64 is spelled out in the result the conversation stores.
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

/** How long one call waits for the developer to allow the app and for the action to run, together. */
export const COMPUTER_TOOL_TIMEOUT_SECONDS = 120;

/** The two screenshots a read asks for: the model's copy, and the one kept beside the transcript. */
const COMPUTER_SHOTS = {
  MODEL: { edge: 1280, quality: 0.7 },
  KEPT: { edge: 2560, quality: 0.8 },
} as const;

const elementIndex = Schema.optionalKey(
  describeWire(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: COMPUTER_BOUNDS.MAX_ELEMENT_INDEX })),
    "An element's number, as the app's last get_app_state numbered it.",
  ),
);

const coordinate = (words: string) =>
  Schema.optionalKey(
    describeWire(
      Schema.Finite.check(
        Schema.isBetween({
          minimum: -COMPUTER_BOUNDS.MAX_COORDINATE,
          maximum: COMPUTER_BOUNDS.MAX_COORDINATE,
        }),
      ),
      words,
    ),
  );

const COMPUTER_INPUT = Schema.Struct({
  action: describeWire(
    Schema.Literals(Object.values(COMPUTER_ACTION)),
    "What to do: list_apps, get_app_state to read an app's window, or click, type_text, " +
      "press_key, scroll, drag, set_value, or perform_secondary_action on it; record its window " +
      "as a video, and stop_recording to stop and keep it.",
  ),
  app: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(COMPUTER_BOUNDS.MAX_APP_CHARS)),
      'The app, by its name or bundle id, such as "Simulator" or "com.apple.iphonesimulator". ' +
        "Every action but list_apps and stop_recording names one.",
    ),
  ),
  element_index: elementIndex,
  x: coordinate("A point's x in the pixels of the app's last screenshot, for click."),
  y: coordinate("A point's y in the pixels of the app's last screenshot, for click."),
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
      Schema.String.check(Schema.isMaxLength(COMPUTER_BOUNDS.MAX_TEXT_CHARS)),
      "What type_text types into the app's focused element.",
    ),
  ),
  key: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isMaxLength(COMPUTER_BOUNDS.MAX_KEY_CHARS)),
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
      Schema.String.check(Schema.isMaxLength(COMPUTER_BOUNDS.MAX_KEY_CHARS)),
      "Which of the element's secondary actions perform_secondary_action performs, as its " +
        'state names them, such as "AXShowMenu".',
    ),
  ),
  caption: Schema.optionalKey(recordingCaptionSchema),
  description: COMMAND_DESCRIPTION,
  machine: Schema.optionalKey(MACHINE_INPUT),
});

type ComputerInput = typeof COMPUTER_INPUT.Type;

const readInput = readEither(COMPUTER_INPUT);
const readAction = readEither(macComputerActionSchema);

/** Why a call ran nothing before it reached the Mac, in words the model can act on. */
const COMPUTER_TOOL_REFUSAL = {
  UNREADABLE:
    "Not run: name the `action`, and the `app` for every action but list_apps and " +
    "stop_recording, with only the fields that action takes: click an element_index or an x and " +
    "y, type_text a text, press_key a key, set_value an element_index and a value, " +
    "perform_secondary_action an element_index and a secondary_action, drag from_x, from_y, " +
    "to_x, and to_y, and stop_recording a caption where it has one.",
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
    "and read the app again after you act, since its numbers change with it. A click answers " +
    "that it was sent, not that the app took it: an app in the background, a browser above " +
    "all, may drop a click at a point, so press an element by its number where one serves, " +
    "and read the app again to see what a click did. An app not " +
    "running is opened behind the developer's windows. The developer's Mac asks them the " +
    "first time an agent uses each app, and they may decline, in which case the call answers " +
    "`not-run`; agents are never offered terminals, password managers, System Settings, or " +
    `${PRODUCT_NAME}. Reach for it last: an integration's tools where one serves the app, ` +
    "run_on_mac where a shell can do it, and browser for localhost and public pages. Use this " +
    "for what only an app's window shows or takes, a browser on the developer's Mac among them, " +
    "such as a page that needs their own signed-in session. To show the developer a flow you " +
    "drove in an app, the iOS Simulator above all, record it: record starts a video of the " +
    "app's window, your cursor drawn over it while it records, " +
    `up to ${COMPUTER_RECORDING_BOUNDS.MAX_SECONDS} seconds and across calls, and ` +
    "stop_recording, with a caption, stops it and keeps it in your transcript, where it plays; " +
    "it stops by itself once its time runs out, and stop_recording still keeps it then. Its " +
    "answer names the path the video stays at in your sandbox until your next recording, by " +
    "which you can post it to a thread, or says why it has none.",
  inputSchema: COMPUTER_INPUT,
} as const;

/** The action the input names, as the Mac's helper reads it; nothing where its fields do not make one. */
function actionOf(input: ComputerInput): MacComputerAction | undefined {
  const {
    action,
    secondary_action,
    caption,
    description: _description,
    machine: _machine,
    ...fields
  } = input;

  // Note that a caption is the service's to keep, never the Mac's, so only a stop may name one.
  if (caption !== undefined && action !== COMPUTER_ACTION.STOP_RECORDING) return undefined;

  const read = readAction({
    op: action,
    ...fields,
    ...(secondary_action === undefined ? undefined : { action: secondary_action }),
    ...(action === COMPUTER_ACTION.GET_APP_STATE
      ? { shots: [COMPUTER_SHOTS.MODEL, COMPUTER_SHOTS.KEPT] }
      : undefined),
    ...(action === COMPUTER_ACTION.RECORD
      ? {
          max_seconds: COMPUTER_RECORDING_BOUNDS.MAX_SECONDS,
          max_bytes: COMPUTER_RECORDING_BOUNDS.MAX_BYTES,
        }
      : undefined),
  });

  return Result.isSuccess(read) ? read.success : undefined;
}

/** What the transcript keeps of one picture: the picture kept, or why not. */
type KeptNote =
  | { readonly picture: { readonly [Key in keyof KeptPicture]: KeptPicture[Key] } }
  | { readonly omitted: PictureOmission; readonly byteCount: number };

/**
 * One picture's base64 kept beside the transcript, sniffed and measured from
 * its own bytes; why not where its bytes are no picture, the transcript has
 * no room left, or the store failed.
 */
function kept(
  transcript: ConversationTarget,
  base64: string,
): Effect.Effect<KeptNote, never, DatabaseServices> {
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  const contentType = sniffImageType(bytes);
  const dimensions = contentType === undefined ? undefined : imageDimensions(bytes, contentType);

  if (contentType === undefined || dimensions === undefined) {
    return Effect.succeed({ omitted: PICTURE_OMISSION.UNSUPPORTED, byteCount: bytes.byteLength });
  }

  return keepConversationPicture(transcript, { bytes, contentType, ...dimensions }).pipe(
    Effect.map(
      (picture): KeptNote =>
        Option.isNone(picture)
          ? { omitted: PICTURE_OMISSION.LIMIT, byteCount: bytes.byteLength }
          : { picture: { ...picture.value } },
    ),
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(
      (): KeptNote => ({ omitted: PICTURE_OMISSION.LIMIT, byteCount: bytes.byteLength }),
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
        : { done: outcome.done };

    if (acted === undefined) return Effect.succeed({ ...ran, ...done });

    return Effect.map(namedApp(transcript, acted), (app) => ({ ...ran, ...done, app }));
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
  const read = readInput(input);
  const action = Result.isSuccess(read) ? actionOf(read.success) : undefined;

  if (action === undefined || Result.isFailure(read))
    return Effect.succeed(machineCommandNotRun(COMPUTER_TOOL_REFUSAL.UNREADABLE));
  const { caption, machine } = read.success;

  return Effect.gen(function* () {
    const route = yield* Effect.result(routedCall(target, MACHINE_COMMAND_KIND.COMPUTER, machine));

    // Note that a read that fails refuses, because an action on a guess could land on the wrong Mac.
    if (Result.isFailure(route)) return machineCommandNotRun(COMPUTER_TOOL_REFUSAL.UNAVAILABLE);

    const { answer, recording } = yield* askMachine(route.success, {
      kind: MACHINE_COMMAND_KIND.COMPUTER,
      conversationId: target.conversationId,
      action,
      timeoutSeconds: COMPUTER_TOOL_TIMEOUT_SECONDS,
    });

    if (!("computer" in answer)) return answer;
    const outcome = answer.computer;

    const named = <T extends object>(ran: T) =>
      answer.machine === undefined ? ran : { ...ran, machine: answer.machine };

    if ("unrecorded" in outcome) {
      return named(recordingNotRun(COMPUTER_RECORDING_REFUSAL[outcome.unrecorded]));
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

/** A call's result as the conversation keeps it: the model's copy of the window without its base64, the kept copy named by id. */
export function storedComputerOutput(output: UnparsedWireValue): UnparsedWireValue {
  if (!isRecord(output) || !isRecord(output.screenshot)) return output;
  const { data: _data, ...screenshot } = output.screenshot;

  return unparsedWire({ ...output, screenshot });
}
