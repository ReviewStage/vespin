import type { DatabaseServices } from "@repo/database/core/query";
import { keepConversationPicture } from "@repo/database/models/conversation-pictures";
import { macOwnerOf } from "@repo/database/models/mac-command-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  type KeptPicture,
  PICTURE_OMISSION,
  type PictureOmission,
} from "@repo/features/conversation-picture-wire";
import { imageDimensions, sniffImageType } from "@repo/features/image-signature";
import {
  COMPUTER_ACTION,
  COMPUTER_BOUNDS,
  COMPUTER_MOUSE_BUTTON,
  COMPUTER_SCROLL_DIRECTION,
  type ComputerApp,
  type ComputerOutcome,
  type ComputerShot,
  MAC_COMMAND_KIND,
  type MacComputerAction,
  macComputerActionSchema,
} from "@repo/features/mac-command-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { isRecord, type UnparsedWireValue, unparsedWire } from "@repo/wire";
import { describeWire, readEither } from "@repo/wire/effect";
import { Effect, Option, Predicate, Result, Schema } from "effect";
import { logStoreFailure } from "../http/store-failure.js";
import { COMMAND_DESCRIPTION } from "./command-description.js";
import {
  askMac,
  MAC_COMMAND_STATUS,
  type MacCommandAnswer,
  macCommandNotRun,
} from "./mac-command.js";

/**
 * computer-tool.ts -- the `computer` tool: an agent sees and uses one app on the developer's own Mac at a time, in the background, through the Mac's computer-use helper.
 *
 * Every agent may call it, the brain, a coding agent, and either's workers,
 * wherever it runs, since the Mac it reaches is the task's assignee's
 * (`macOwnerOf`), as `run_on_mac`'s is. One call is one action, queued as a
 * computer command (`mac-command.ts`'s `askMac`): the Mac asks the developer
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
      "press_key, scroll, drag, set_value, or perform_secondary_action on it.",
  ),
  app: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(COMPUTER_BOUNDS.MAX_APP_CHARS)),
      'The app, by its name or bundle id, such as "Simulator" or "com.apple.iphonesimulator". ' +
        "Every action but list_apps names one.",
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
  description: COMMAND_DESCRIPTION,
});

type ComputerInput = typeof COMPUTER_INPUT.Type;

const readInput = readEither(COMPUTER_INPUT);
const readAction = readEither(macComputerActionSchema);

/** Why a call ran nothing before it reached the Mac, in words the model can act on. */
const COMPUTER_TOOL_REFUSAL = {
  UNREADABLE:
    "Not run: name the `action`, and the `app` for every action but list_apps, with only the " +
    "fields that action takes: click an element_index or an x and y, type_text a text, press_key " +
    "a key, set_value an element_index and a value, perform_secondary_action an element_index " +
    "and a secondary_action, and drag from_x, from_y, to_x, and to_y.",
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
    "and read the app again after you act, since its numbers change with it. An app not " +
    "running is opened behind the developer's windows. The developer's Mac asks them the " +
    "first time an agent uses each app, and they may decline, in which case the call answers " +
    "`not-run`; agents are never offered terminals, password managers, System Settings, or " +
    `${PRODUCT_NAME}. Use run_on_mac for what a shell can do; use this for what only an app's ` +
    "window shows or takes.",
  inputSchema: COMPUTER_INPUT,
} as const;

/** The action the input names, as the Mac's helper reads it; nothing where its fields do not make one. */
function actionOf(input: ComputerInput): MacComputerAction | undefined {
  const { action, secondary_action, description: _description, ...fields } = input;
  const read = readAction({
    op: action,
    ...fields,
    ...(secondary_action === undefined ? undefined : { action: secondary_action }),
    ...(action === COMPUTER_ACTION.GET_APP_STATE
      ? { shots: [COMPUTER_SHOTS.MODEL, COMPUTER_SHOTS.KEPT] }
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
type ComputerRan = { readonly status: typeof MAC_COMMAND_STATUS.RAN } & object;

/** An app as the result names it: its icon kept beside the transcript rather than spelled out. */
function namedApp(
  transcript: ConversationTarget,
  app: ComputerApp,
): Effect.Effect<object, never, DatabaseServices> {
  const { iconPng, ...named } = app;
  if (iconPng === undefined) return Effect.succeed(named);
  return Effect.map(kept(transcript, iconPng), (icon) => ({ ...named, icon }));
}

/** What a call answers for what the action came to, its pictures kept or handed on. */
function answeredOutcome(
  transcript: ConversationTarget,
  outcome: ComputerOutcome,
): Effect.Effect<ComputerRan, never, DatabaseServices> {
  const ran = { status: MAC_COMMAND_STATUS.RAN };
  if ("done" in outcome) return Effect.succeed({ ...ran, done: outcome.done });
  if ("apps" in outcome) {
    // Note that the list leaves the apps' icons out, since a read of each app keeps its own.
    const apps = outcome.apps.map(({ iconPng: _icon, ...app }) => app);
    return Effect.succeed({ ...ran, apps });
  }
  const [shown, full]: readonly (ComputerShot | undefined)[] = outcome.shots;
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

/**
 * One `computer` call made in the conversation, whichever agent made it: its
 * input read against the tool's schema and made one action, then run on the
 * Mac of its task's assignee (`macOwnerOf`) as `askMac` runs a command. It
 * never fails: what the Mac would not run, or never answered, answers
 * `not-run` with why.
 */
export function runComputerTool(
  target: ConversationTarget,
  input: UnparsedWireValue,
): Effect.Effect<MacCommandAnswer | ComputerRan, never, DatabaseServices> {
  const read = readInput(input);
  const action = Result.isSuccess(read) ? actionOf(read.success) : undefined;
  if (action === undefined)
    return Effect.succeed(macCommandNotRun(COMPUTER_TOOL_REFUSAL.UNREADABLE));
  return Effect.gen(function* () {
    const owner = yield* Effect.result(macOwnerOf(target));
    // Note that a read that fails refuses, because an action on a guess could land on the wrong Mac.
    if (Result.isFailure(owner)) return macCommandNotRun(COMPUTER_TOOL_REFUSAL.UNAVAILABLE);
    const answer = yield* askMac(owner.success, {
      kind: MAC_COMMAND_KIND.COMPUTER,
      conversationId: target.conversationId,
      action,
      timeoutSeconds: COMPUTER_TOOL_TIMEOUT_SECONDS,
    });
    if (!("computer" in answer)) return answer;
    return yield* answeredOutcome(target, answer.computer);
  });
}

/** The model's copy of a read window in a call's result, where it carries one. */
export function computerScreenshot(
  output: UnparsedWireValue,
): { readonly mime: string; readonly data: string } | undefined {
  if (!isRecord(output) || !isRecord(output.screenshot)) return undefined;
  const { mime, data } = output.screenshot;
  return Predicate.isString(mime) && Predicate.isString(data) ? { mime, data } : undefined;
}

/** A call's result as the conversation keeps it: the model's copy of the window without its base64, the kept copy named by id. */
export function storedComputerOutput(output: UnparsedWireValue): UnparsedWireValue {
  if (!isRecord(output) || !isRecord(output.screenshot)) return output;
  const { data: _data, ...screenshot } = output.screenshot;
  return unparsedWire({ ...output, screenshot });
}
