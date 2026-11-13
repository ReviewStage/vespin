import { AGENT_TOOL } from "@repo/features/agent-tools";
import { MACHINE_UNREACHED, type MachineUnreached } from "@repo/features/machine-command-wire";
import { machineName } from "@repo/features/machine-name";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { SENTRY_SEND_SPAN } from "@repo/features/sentry-tracing";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { type CallMachine, machineRefusalOf } from "@repo/features/tool-call-model";
import { ACT_KIND } from "@repo/host/acts";
import {
  BANNER_GLYPH,
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  STATUS_TONE,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { personActor } from "@repo/ui/actor-model";
import { GLYPH } from "@repo/ui/icons";
import { ReplayWords } from "@repo/ui/session-replay-marks";
import { rejectionWords, useAsyncAction } from "@repo/ui/use-async-action";
import type { UnparsedWireValue } from "@repo/wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useContext, useRef, useState } from "react";
import { type ActResult, askAct, toastActFailure } from "../act.js";
import { sendMutation } from "../act-mutations.js";
import { ACTOR_SIZE, ActorMark, ActorRef } from "../actor-ref.js";
import { workspaceToolsQuery } from "../live-reads.js";
import { useThisMac } from "../machine-name.js";
import { useMemberDirectory } from "../member-directory.js";
import { showToast } from "../toast.js";
import { TranscriptAgent } from "./line-cards.js";
import { MachineGlyph } from "./workspace-machines.js";

/**
 * machine-refusal-card.tsx -- why a terminal command or an action on an app reached no machine, said under its row, with each machine that could take it offered as the agent's new default.
 *
 * Routing refuses a call whose machine cannot take it, rather than moving
 * it elsewhere without a word (`machine-routing.ts`), and its answer says
 * why as data (`why`) and names the machines that could take it now
 * (`others`), beside the words the model reads (`machineRefusalOf`). The
 * card says why in its own words, as a failure note does (`Banner`'s
 * card, its mark in the danger ink), and offers each other machine as the
 * Default machine menu lists it: its glyph wearing the dot of whether it
 * listens now, a teammate's face, then its name, the line above saying
 * what a press does; a machine the agent's tools no longer list keeps the
 * dot it had when it was offered. A press makes that machine the agent's
 * default, through the same request the Default machine row sends
 * (`agent-machines.tsx`), then tells the agent to try again there, as a
 * member's own message does, naming the machine's id so the agent may name
 * it in its call; one taken holds the card's other presses off. With no
 * other machine, the card says so and offers nothing; read where the
 * transcript names no agent to message, as a worker's, it says why alone.
 * A refusal the Mac itself answered, as a declined command or a missing
 * permission (`computer-permission-note.tsx`), names no `why`, so it has no
 * card.
 */

/** What the card says and sends. */
const MACHINE_REFUSAL_WORDS = {
  OFFER: "Make one of these this agent's default and try again:",
  NO_OTHER: "No other machine can take it now.",
  USING: "Setting the default",
  REFUSED: "The default machine could not be changed.",
  UNSENT: "The default machine changed, but the agent could not be told to try again.",
} as const;

/** The tools whose refusals the card answers. */
const MACHINE_TOOLS: ReadonlySet<string> = new Set([AGENT_TOOL.RUN_ON_MAC, AGENT_TOOL.COMPUTER]);

/** The line a press sends the agent once its default is the machine given, naming the machine's id so the agent may name it in its call. */
function tryAgainLine(machine: CallMachine): string {
  return `Try again on ${machine.name}, now your default machine (id "${machine.id}").`;
}

/** Why the call reached no machine, in the reader's words: the machine by what every list calls it, and whose it is where that is why. */
function WhyWords({
  why,
  machine,
}: {
  why: MachineUnreached;
  machine: CallMachine | undefined;
}): ReactNode {
  const thisMac = useThisMac();
  const { members, readerId, former } = useMemberDirectory();

  const name =
    machine === undefined ? undefined : (
      <ReplayWords masked>
        {machineName({ deviceId: machine.id, name: machine.name }, [], thisMac)}
      </ReplayWords>
    );

  switch (why) {
    case MACHINE_UNREACHED.OFFLINE:
      return (
        <>
          {name ?? "The machine"} is offline, or {PRODUCT_NAME} isn't running on it.
        </>
      );
    case MACHINE_UNREACHED.NOT_LET:
      return (
        <>
          This task's agents can't use{" "}
          {machine === undefined ? (
            "its owner's"
          ) : (
            <ActorRef
              actor={personActor(machine.owner, members, readerId, former)}
              sentence
              possessive
            />
          )}{" "}
          machines.
        </>
      );
    case MACHINE_UNREACHED.COMMANDS_NEVER:
      return <>{name ?? "The machine"} doesn't let agents run terminal commands.</>;
    case MACHINE_UNREACHED.DEFAULT_GONE:
      return "This agent's default machine was removed, or its owner no longer lets this task's agents use it.";
    case MACHINE_UNREACHED.UNKNOWN_MACHINE:
      return "The agent named a machine this task's agents can't use.";
    case MACHINE_UNREACHED.NO_MACHINE:
      return "None of the machines this agent may use could take it.";
  }
}

/** A refusal said in a toast, in the words given. */
function refused(words: string, agentId: string, cause: unknown): void {
  showToast({
    replayUnmasked: true,
    words,
    tone: STATUS_TONE.DANGER,
    failure: { surface: FAILURE_SURFACE.ACT, cause, about: { agentId } },
  });
}

/**
 * The agent's default made the machine given, then the agent told to try
 * again there; answers whether both went, so a press refused at either is
 * offered again, each refusal said in a toast. Note that pressing again
 * after a message refused sets the same default once more, which changes
 * nothing, and sends the message again.
 */
async function moveDefault(
  agentId: string,
  machine: CallMachine,
  send: (line: string) => Promise<ActResult<typeof ACT_KIND.AGENTS_MESSAGE>>,
): Promise<boolean> {
  const answer = await askAct(ACT_KIND.AGENTS_SET_DEFAULT_MACHINE, {
    agentId,
    machineId: machine.id,
  });

  if ("failure" in answer) {
    refused(MACHINE_REFUSAL_WORDS.REFUSED, agentId, answer);

    return false;
  }

  // Note that a send that never reached the host is said as unsent too, since the default already moved.
  const sent = await send(tryAgainLine(machine)).catch((cause: unknown) => ({ failure: cause }));

  if (!("failure" in sent)) return true;
  refused(MACHINE_REFUSAL_WORDS.UNSENT, agentId, sent.failure);

  return false;
}

/** The card under a terminal command or an action on an app that routing refused; nothing for any other call. */
export function MachineRefusalCard({
  tool,
  output,
}: {
  tool: string;
  output: UnparsedWireValue | undefined;
}): ReactNode {
  const agentId = useContext(TranscriptAgent);
  const thisMac = useThisMac();
  const { members, readerId, former } = useMemberDirectory();
  // Note that a press taken is kept in a ref as well as drawn, so a second press before the draw sends nothing.
  const taken = useRef(false);
  // The machine pressed, and whether its default moved and the agent was told; none before a press, or after one refused.
  const [pressed, setPressed] = useState<{ id: string; moved: boolean } | undefined>(undefined);
  const press = useAsyncAction(rejectionWords);
  // Note that a machine's dot is read live, since a card may be read long after the refusal that offered it.
  const listing = useQuery(workspaceToolsQuery(agentId)).data?.machines;

  const { mutateAsync: sendMessage } = useMutation(
    sendMutation(ACT_KIND.AGENTS_MESSAGE, () => SENTRY_SEND_SPAN.AGENT_SEND),
  );

  const refusal = MACHINE_TOOLS.has(tool) ? machineRefusalOf(output) : undefined;

  if (refusal === undefined) return null;
  const { others } = refusal;
  const listed = others.map((machine) => ({ deviceId: machine.id, name: machine.name }));

  const use = (machine: CallMachine) => {
    if (agentId === undefined || taken.current) return;
    taken.current = true;
    setPressed({ id: machine.id, moved: false });

    const send = (text: string) => sendMessage({ agentId, text, clientKey: crypto.randomUUID() });

    void press.run(() =>
      moveDefault(agentId, machine, send).then(
        (went) => {
          taken.current = went;
          setPressed(went ? { id: machine.id, moved: true } : undefined);
        },
        (cause: unknown) => {
          taken.current = false;
          setPressed(undefined);
          toastActFailure({
            surface: FAILURE_SURFACE.ACT,
            act: ACT_KIND.AGENTS_SET_DEFAULT_MACHINE,
            cause,
            about: { agentId },
          });
        },
      ),
    );
  };

  const offers =
    agentId === undefined || others.length === 0
      ? undefined
      : others.map((machine) => (
          <Button
            key={machine.id}
            variant={BUTTON_VARIANT.OUTLINE}
            icon={
              <MachineGlyph
                machine={{
                  online: listing?.find((listed) => listed.id === machine.id)?.online ?? true,
                }}
              />
            }
            {...(pressed?.id === machine.id && !pressed.moved
              ? { busy: true, busyLabel: MACHINE_REFUSAL_WORDS.USING }
              : undefined)}
            disabled={pressed !== undefined}
            onClick={() => use(machine)}
          >
            {machine.owner.userId === readerId ? null : (
              <>
                <ActorMark
                  actor={personActor(machine.owner, members, readerId, former)}
                  size={ACTOR_SIZE.INLINE}
                />{" "}
              </>
            )}
            <ReplayWords masked>
              {machineName({ deviceId: machine.id, name: machine.name }, listed, thisMac)}
            </ReplayWords>
          </Button>
        ));

  return (
    <div className="mt-list-gap mr-0 mb-item-gap ml-transcript-gutter">
      <Banner
        look={BANNER_LOOK.CARD}
        tone={STATUS_TONE.DANGER}
        glyph={<GLYPH.FAILED />}
        glyphLook={BANNER_GLYPH.MARK}
        actions={offers === undefined ? undefined : <>{offers}</>}
      >
        <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.LABEL}>
          <WhyWords why={refusal.why} machine={refusal.machine} />
        </Text>
        <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {others.length === 0 ? MACHINE_REFUSAL_WORDS.NO_OTHER : MACHINE_REFUSAL_WORDS.OFFER}
        </Text>
      </Banner>
    </div>
  );
}
