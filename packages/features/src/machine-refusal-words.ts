/**
 * machine-refusal-words.ts -- what an agent is told to do next when its `run_on_mac` or `computer` call ran nothing, worded once for both tools.
 *
 * A refusal reaches the model as an ordinary tool result, and its words are
 * all it has to go on: one that only says what happened reads as a reason
 * to end the turn and ask. So each refusal says what happened, then one of
 * these. Both the Mac (`@repo/host`'s machine commands) and the service
 * (its routing and its wait for the Mac) close their refusals with them,
 * so the two tools read alike. The one difference kept is what the Mac
 * never reported on: a shell command's effect is checked by hand before it
 * runs again, an action on an app by reading the app again.
 */

/** What to do after a refusal, by what refused the call. */
export const MACHINE_REFUSAL_NEXT = {
  /** Nobody answered the ask, which is not a no. */
  UNANSWERED:
    "They may be away, so don't treat this as a no: carry on with what you can do without it, " +
    "and try again later.",
  /** The developer said no to this one call. */
  DECLINED: "Carry on without it, and don't send the same call again unless they ask you to.",
  /** A setting the developer chose refuses every call like it on that machine. */
  SETTING: "Carry on with what you can do without it; it won't run there until they change that.",
  /** Nothing the developer or the agent does now would let it run. */
  WITHOUT: "Carry on with what you can do without it.",
  /** The machine can't take it now, as one offline, which may change. */
  LATER: "Carry on with what you can do without it, and try again later.",
  /** A shell command the Mac never reported on, whose effect may have happened. */
  SHELL_UNHEARD: "It may or may not have run; check its effect before running it again.",
  /** An action on an app the Mac never reported on, which a click or typing may have landed before; a read first costs little and keeps it from landing twice. */
  ACTION_UNHEARD:
    "It may have run; read the app again with get_app_state, and try the call again if it didn't take effect.",
} as const;
