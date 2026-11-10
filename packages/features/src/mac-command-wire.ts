import { Effect, Schema as EffectSchema, Option } from "effect";
import { wireUuidSchema } from "./service-wire.js";

/**
 * mac-command-wire.ts -- a command an agent asked to run on the developer's Mac, as the Mac takes it from the service and hands back what it came to.
 *
 * A command is of a kind (`MAC_COMMAND_KIND`): a shell command, or an
 * action on one app through the Mac's computer-use helper. An agent's `run_on_mac` call is queued on the service under the account
 * (`packages/service/src/agents/mac-command.ts`). A signed-in Mac with the
 * setting on holds `GET /api/mac-commands` open, naming in its `kinds`
 * query the kinds it runs beyond `shell`, and is answered with every
 * command of those kinds waiting for the account, each claimed for that
 * Mac as it goes; it runs a shell command in a login shell from the home
 * folder, or an action through its computer-use helper, asking the
 * developer first where its settings say to, and posts what it came to
 * (POST), or posts a refusal for a command it would not run. Every request
 * refuses a key it does not name, as every request frame on this wire does.
 */

export const MAC_COMMAND_BOUNDS = {
  /** How long a command runs before it is killed, when the agent names no time. */
  DEFAULT_TIMEOUT_SECONDS: 60,
  /**
   * The longest an agent may ask for: short enough that the voice's
   * ten-minute follow of a brain turn still hears the answer after the
   * queue, the grace, and the model.
   */
  MAX_TIMEOUT_SECONDS: 480,
  /** The most characters of a command the service queues. */
  MAX_COMMAND_CHARS: 100_000,
  /** The most characters of stdout or stderr a result carries; the Mac cuts each to this. */
  MAX_OUTPUT_CHARS: 20_000,
} as const;

/**
 * What a command asks the Mac to do. Every Mac that reads runs `shell`, an
 * older one that names no kinds among them; a newer one names the others
 * it runs in its read, and is handed only commands of the kinds it named.
 */
export const MAC_COMMAND_KIND = {
  /** A shell command, run in the login shell from the home folder (`run_on_mac`). */
  SHELL: "shell",
  /** One action on one app, run through the Mac's computer-use helper, after the developer allows the app. */
  COMPUTER: "computer",
} as const;

export type MacCommandKind = (typeof MAC_COMMAND_KIND)[keyof typeof MAC_COMMAND_KIND];

const MAC_COMMAND_KINDS: ReadonlySet<string> = new Set(Object.values(MAC_COMMAND_KIND));

function isMacCommandKind(kind: string): kind is MacCommandKind {
  return MAC_COMMAND_KINDS.has(kind);
}

/** The separator between the kinds a read names in its `kinds` query. */
const KIND_SEPARATOR = ",";

/** The kinds a Mac's read names, as its `kinds` query carries them; `shell` goes without saying. */
export function macCommandKindsQuery(kinds: readonly MacCommandKind[]): string {
  return kinds.join(KIND_SEPARATOR);
}

/**
 * The kinds a Mac's read may be handed: `shell`, which every Mac runs, and
 * each other kind its query names that this build knows. Note that a kind
 * it does not know is passed over rather than refused, so a newer Mac's
 * read is answered with what this service can queue.
 */
export function macCommandKindsRead(query: string | undefined): readonly MacCommandKind[] {
  const named = (query ?? "").split(KIND_SEPARATOR).map((kind) => kind.trim());

  return [...new Set([MAC_COMMAND_KIND.SHELL, ...named.filter(isMacCommandKind)])];
}

const commandTimeout = EffectSchema.Int.check(
  EffectSchema.isBetween({ minimum: 1, maximum: MAC_COMMAND_BOUNDS.MAX_TIMEOUT_SECONDS }),
);

/** One shell command waiting for the Mac: its id, the shell text, and how long it may run. */
const macShellCommandSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  kind: EffectSchema.Literal(MAC_COMMAND_KIND.SHELL),
  command: EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(MAC_COMMAND_BOUNDS.MAX_COMMAND_CHARS),
  ),
  timeoutSeconds: commandTimeout,
});

export type MacShellCommand = typeof macShellCommandSchema.Type;

/** What an agent may do to an app through the Mac's computer-use helper, by the helper's own op names. */
export const COMPUTER_ACTION = {
  /** The running apps a person uses, each with its icon. */
  LIST_APPS: "list_apps",
  /** The app's frontmost window as numbered elements and screenshots. */
  GET_APP_STATE: "get_app_state",
  CLICK: "click",
  TYPE_TEXT: "type_text",
  PRESS_KEY: "press_key",
  SCROLL: "scroll",
  DRAG: "drag",
  SET_VALUE: "set_value",
  PERFORM_SECONDARY_ACTION: "perform_secondary_action",
} as const;

export type ComputerAction = (typeof COMPUTER_ACTION)[keyof typeof COMPUTER_ACTION];

export const COMPUTER_MOUSE_BUTTON = { LEFT: "left", RIGHT: "right", MIDDLE: "middle" } as const;

export const COMPUTER_SCROLL_DIRECTION = {
  UP: "up",
  DOWN: "down",
  LEFT: "left",
  RIGHT: "right",
} as const;

export const COMPUTER_BOUNDS = {
  /** The most characters of an app's name or bundle id. */
  MAX_APP_CHARS: 255,
  /** The most characters an action types or sets. */
  MAX_TEXT_CHARS: 10_000,
  /** The most characters of a key chord or an action's name. */
  MAX_KEY_CHARS: 64,
  /** The highest element number a state names: the helper numbers at most six hundred. */
  MAX_ELEMENT_INDEX: 9_999,
  /** The farthest a point may stand from a window's corner, in a screenshot's pixels. */
  MAX_COORDINATE: 100_000,
  /** The most a click repeats. */
  MAX_CLICKS: 3,
  /** The most pages a scroll moves. */
  MAX_PAGES: 20,
  /** The most screenshots one state carries: the model's copy and the one kept. */
  MAX_SHOTS: 2,
  /** A screenshot's longest edge, in pixels, at the least and the most. */
  MIN_SHOT_EDGE: 64,
  MAX_SHOT_EDGE: 4_096,
  /** The most base64 characters of one screenshot: a 1.5 MB JPEG. */
  MAX_SHOT_CHARS: 2_100_000,
  /** The most base64 characters of an app's icon: a 64px PNG. */
  MAX_ICON_CHARS: 60_000,
  /** The most characters of a state's numbered elements. */
  MAX_ELEMENTS_CHARS: 200_000,
  /** The most apps a list carries. */
  MAX_APPS: 200,
} as const;

const appName = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(COMPUTER_BOUNDS.MAX_APP_CHARS),
);

const elementIndex = EffectSchema.Int.check(
  EffectSchema.isBetween({ minimum: 0, maximum: COMPUTER_BOUNDS.MAX_ELEMENT_INDEX }),
);

const coordinate = EffectSchema.Finite.check(
  EffectSchema.isBetween({
    minimum: -COMPUTER_BOUNDS.MAX_COORDINATE,
    maximum: COMPUTER_BOUNDS.MAX_COORDINATE,
  }),
);

const typed = EffectSchema.String.check(EffectSchema.isMaxLength(COMPUTER_BOUNDS.MAX_TEXT_CHARS));

const keyName = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(COMPUTER_BOUNDS.MAX_KEY_CHARS),
);

/** One screenshot a state asks for: its longest edge in pixels and its JPEG quality. */
const computerShotRequestSchema = EffectSchema.Struct({
  edge: EffectSchema.Int.check(
    EffectSchema.isBetween({
      minimum: COMPUTER_BOUNDS.MIN_SHOT_EDGE,
      maximum: COMPUTER_BOUNDS.MAX_SHOT_EDGE,
    }),
  ),
  quality: EffectSchema.Finite.check(EffectSchema.isBetween({ minimum: 0.1, maximum: 1 })),
});

/**
 * One action on one app, as the helper reads it. Note that its fields are
 * spelled as the helper's own (`element_index`, not `elementIndex`), so the
 * Mac hands an action to the helper as it came, and the model's tool, which
 * names them so too, hands its input to the service as it came.
 */
export const macComputerActionSchema = EffectSchema.Union([
  EffectSchema.Struct({ op: EffectSchema.Literal(COMPUTER_ACTION.LIST_APPS) }),
  EffectSchema.Struct({
    op: EffectSchema.Literal(COMPUTER_ACTION.GET_APP_STATE),
    app: appName,
    shots: EffectSchema.Array(computerShotRequestSchema).check(
      EffectSchema.isMinLength(1),
      EffectSchema.isMaxLength(COMPUTER_BOUNDS.MAX_SHOTS),
    ),
  }),
  EffectSchema.Struct({
    op: EffectSchema.Literal(COMPUTER_ACTION.CLICK),
    app: appName,
    element_index: EffectSchema.optionalKey(elementIndex),
    x: EffectSchema.optionalKey(coordinate),
    y: EffectSchema.optionalKey(coordinate),
    click_count: EffectSchema.optionalKey(
      EffectSchema.Int.check(
        EffectSchema.isBetween({ minimum: 1, maximum: COMPUTER_BOUNDS.MAX_CLICKS }),
      ),
    ),
    mouse_button: EffectSchema.optionalKey(
      EffectSchema.Literals(Object.values(COMPUTER_MOUSE_BUTTON)),
    ),
  }),
  EffectSchema.Struct({
    op: EffectSchema.Literal(COMPUTER_ACTION.TYPE_TEXT),
    app: appName,
    text: typed.check(EffectSchema.isMinLength(1)),
  }),
  EffectSchema.Struct({
    op: EffectSchema.Literal(COMPUTER_ACTION.PRESS_KEY),
    app: appName,
    key: keyName,
  }),
  EffectSchema.Struct({
    op: EffectSchema.Literal(COMPUTER_ACTION.SCROLL),
    app: appName,
    element_index: EffectSchema.optionalKey(elementIndex),
    direction: EffectSchema.optionalKey(
      EffectSchema.Literals(Object.values(COMPUTER_SCROLL_DIRECTION)),
    ),
    pages: EffectSchema.optionalKey(
      EffectSchema.Finite.check(
        EffectSchema.isBetween({ minimum: 0, maximum: COMPUTER_BOUNDS.MAX_PAGES }),
      ),
    ),
  }),
  EffectSchema.Struct({
    op: EffectSchema.Literal(COMPUTER_ACTION.DRAG),
    app: appName,
    from_x: coordinate,
    from_y: coordinate,
    to_x: coordinate,
    to_y: coordinate,
  }),
  EffectSchema.Struct({
    op: EffectSchema.Literal(COMPUTER_ACTION.SET_VALUE),
    app: appName,
    element_index: elementIndex,
    value: typed,
  }),
  EffectSchema.Struct({
    op: EffectSchema.Literal(COMPUTER_ACTION.PERFORM_SECONDARY_ACTION),
    app: appName,
    element_index: elementIndex,
    action: keyName,
  }),
]);

export type MacComputerAction = typeof macComputerActionSchema.Type;

/**
 * One action waiting for the Mac: its id, the conversation of the agent that
 * asked, which the Mac's Allow once holds an app for, the action, and how long the developer
 * may take to allow the app and the action to run, together.
 */
const macComputerCommandSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  kind: EffectSchema.Literal(MAC_COMMAND_KIND.COMPUTER),
  conversationId: wireUuidSchema,
  action: macComputerActionSchema,
  timeoutSeconds: commandTimeout,
});

export type MacComputerCommand = typeof macComputerCommandSchema.Type;

/** One command waiting for the Mac, of a kind the service queues. */
export const macCommandSchema = EffectSchema.Union([
  macShellCommandSchema,
  macComputerCommandSchema,
]);

/**
 * What a computer command asks, as the queue keeps it in the text a shell
 * command's command stands in: its conversation and its action, as JSON.
 */
const storedComputerRequestSchema = EffectSchema.fromJsonString(
  EffectSchema.Struct({ conversationId: wireUuidSchema, action: macComputerActionSchema }),
);

const decodeStoredComputerRequest = EffectSchema.decodeUnknownOption(storedComputerRequestSchema);
const encodeStoredComputerRequest = EffectSchema.encodeSync(storedComputerRequestSchema);

/** A command as the queue keeps it: its kind, and what it asks as one text, a shell command's own or a computer request's JSON. */
export interface StoredMacCommand {
  readonly id: string;
  readonly kind: MacCommandKind;
  readonly command: string;
  readonly timeoutSeconds: number;
}

/** What a command asks, as the queue keeps it. */
export function storedMacCommandText(command: MacCommand): string {
  return command.kind === MAC_COMMAND_KIND.SHELL
    ? command.command
    : encodeStoredComputerRequest({
        conversationId: command.conversationId,
        action: command.action,
      });
}

/** A command the queue kept, read back; none where a computer request no longer reads, which no Mac could run. */
export function macCommandOfStored(stored: StoredMacCommand): MacCommand | undefined {
  const { id, kind, command, timeoutSeconds } = stored;

  if (kind === MAC_COMMAND_KIND.SHELL) return { id, kind, command, timeoutSeconds };

  return Option.match(decodeStoredComputerRequest(command), {
    onNone: () => undefined,
    onSome: ({ conversationId, action }) => ({ id, kind, conversationId, action, timeoutSeconds }),
  });
}

export type MacCommand = typeof macCommandSchema.Type;

/**
 * A kind this build does not know, as a newer service wrote one: read as
 * the kind's name alone, so the Mac refuses that command rather than the
 * whole read. A kind this build knows is refused here, because a known one
 * that fails its own shape is a broken read and not a newer one.
 */
const unknownMacCommandKindSchema = EffectSchema.String.check(
  EffectSchema.makeFilter((kind) => !isMacCommandKind(kind)),
).pipe(EffectSchema.brand("UnknownMacCommandKind"));

/**
 * A shell command as the Mac reads one: with its kind, or without one, as
 * a service from before kinds wrote it, which claimed the command before it
 * answered and so must not have it dropped.
 */
const macShellCommandReadSchema = macShellCommandSchema.mapFields((fields) => ({
  ...fields,
  kind: fields.kind.pipe(
    EffectSchema.withDecodingDefaultKey(Effect.succeed(MAC_COMMAND_KIND.SHELL)),
  ),
}));

/** A command as the Mac reads one: one of a kind this build knows, or the id and kind alone of one it does not. */
const macCommandReadSchema = EffectSchema.Union([
  macShellCommandReadSchema,
  macComputerCommandSchema,
  EffectSchema.Struct({ id: wireUuidSchema, kind: unknownMacCommandKindSchema }),
]);

export type MacCommandRead = typeof macCommandReadSchema.Type;

/**
 * Whether a command the Mac read is a shell command. Note that this is
 * read off the kind alone, which TypeScript cannot narrow on by itself,
 * because an unknown kind is any text but a known one.
 */
export function isMacShellCommand(command: MacCommandRead): command is MacShellCommand {
  return command.kind === MAC_COMMAND_KIND.SHELL;
}

/** Whether a command the Mac read is an action on an app, read off its kind as `isMacShellCommand` reads its. */
export function isMacComputerCommand(command: MacCommandRead): command is MacComputerCommand {
  return command.kind === MAC_COMMAND_KIND.COMPUTER;
}

/** The commands claimed for this Mac (GET), none where nothing came while the read was held. */
export const macCommandsAnswerSchema = EffectSchema.Struct({
  commands: EffectSchema.Array(macCommandReadSchema),
});

const output = EffectSchema.String.check(
  EffectSchema.isMaxLength(MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS),
);

/**
 * What a shell command did: its exit code, null where it never exited on
 * its own (killed at its timeout, or never started), what it printed,
 * whether either stream was cut, and whether the timeout killed it.
 */
const macShellResultSchema = EffectSchema.Struct({
  exitCode: EffectSchema.NullOr(EffectSchema.Int),
  stdout: output,
  stderr: output,
  truncated: EffectSchema.Boolean,
  timedOut: EffectSchema.Boolean,
});

export type MacShellResult = typeof macShellResultSchema.Type;

/** A command the Mac would not run, such as one of a kind it cannot run, and why, in words the agent can act on. */
const macCommandRefusalSchema = EffectSchema.Struct({
  refused: EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS),
  ),
});

export type MacCommandRefusal = typeof macCommandRefusalSchema.Type;

/** One app as the helper names it: its name, its bundle id, its icon as a 64px PNG, and whether agents are refused it. */
const computerAppSchema = EffectSchema.Struct({
  name: appName,
  bundleId: EffectSchema.optionalKey(appName),
  iconPng: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(COMPUTER_BOUNDS.MAX_ICON_CHARS)),
  ),
  refused: EffectSchema.Boolean,
});

export type ComputerApp = typeof computerAppSchema.Type;

const pixels = EffectSchema.Int.check(
  EffectSchema.isBetween({ minimum: 1, maximum: COMPUTER_BOUNDS.MAX_SHOT_EDGE }),
);

/** One screenshot of a window, as base64 JPEG, at the size the state asked for. */
const computerShotSchema = EffectSchema.Struct({
  width: pixels,
  height: pixels,
  jpeg: EffectSchema.String.check(EffectSchema.isMaxLength(COMPUTER_BOUNDS.MAX_SHOT_CHARS)),
});

export type ComputerShot = typeof computerShotSchema.Type;

/** What an action came to: the apps listed, an app's window read, or the action done on its app. */
const computerOutcomeSchema = EffectSchema.Union([
  EffectSchema.Struct({
    apps: EffectSchema.Array(computerAppSchema).check(
      EffectSchema.isMaxLength(COMPUTER_BOUNDS.MAX_APPS),
    ),
  }),
  EffectSchema.Struct({
    app: computerAppSchema,
    window: EffectSchema.Struct({
      title: EffectSchema.String.check(EffectSchema.isMaxLength(COMPUTER_BOUNDS.MAX_TEXT_CHARS)),
      x: EffectSchema.Finite,
      y: EffectSchema.Finite,
      width: EffectSchema.Finite,
      height: EffectSchema.Finite,
    }),
    elements: EffectSchema.String.check(
      EffectSchema.isMaxLength(COMPUTER_BOUNDS.MAX_ELEMENTS_CHARS),
    ),
    truncated: EffectSchema.Boolean,
    shots: EffectSchema.Array(computerShotSchema).check(
      EffectSchema.isMaxLength(COMPUTER_BOUNDS.MAX_SHOTS),
    ),
  }),
  // Note that an action names the app it acted on, as the Mac described it before asking, so its row wears the app's icon.
  EffectSchema.Struct({ done: keyName, app: EffectSchema.optionalKey(computerAppSchema) }),
]);

export type ComputerOutcome = typeof computerOutcomeSchema.Type;

/** What an action on an app came to, under a key of its own so it is never read as a shell result. */
const macComputerResultSchema = EffectSchema.Struct({ computer: computerOutcomeSchema });

export type MacComputerResult = typeof macComputerResultSchema.Type;

/** What a command came to: what a shell command or an action did, or why the Mac ran nothing. */
export const macCommandResultSchema = EffectSchema.Union([
  macShellResultSchema,
  macComputerResultSchema,
  macCommandRefusalSchema,
]);

export type MacCommandResult = typeof macCommandResultSchema.Type;

/** One command's result, posted by the Mac that claimed it (POST). */
export const macCommandSettleRequestSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  result: macCommandResultSchema,
});

/** A result the service kept (POST). */
export const macCommandSettledAnswerSchema = EffectSchema.Struct({
  settled: EffectSchema.Literal(true),
});

/** One command the Mac heard of over Realtime, claimed by its id (POST). */
export const macCommandClaimRequestSchema = EffectSchema.Struct({
  id: wireUuidSchema,
});

/** The command claimed for this Mac, to run; `not-found` where another Mac took it, its call withdrew it, or it waited too long. */
export const macCommandClaimAnswerSchema = EffectSchema.Struct({
  command: macCommandSchema,
});

/** That the service counts this Mac listening now, for the kinds it named (POST). */
export const macCommandListeningAnswerSchema = EffectSchema.Struct({
  listening: EffectSchema.Literal(true),
});
