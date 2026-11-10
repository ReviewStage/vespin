import type { AgentAttachment, AgentSummary } from "@repo/features/agent-wire";
import { FAILURE_REASON, type Failure, remedyLabel } from "@repo/features/failure-remedy";
import type { ModelChoice } from "@repo/features/models-wire";
import {
  ANNOUNCE,
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  ComposerFrame,
  IconButton,
  NOTE_LINE_LOOK,
  NoteLine,
  POPOVER_ALIGN,
  riseAboveEnd,
  TEXT_TONE,
  Text,
  TextButton,
  useMenu,
} from "@repo/ui";
import { ACTOR_KIND } from "@repo/ui/actor-model";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { ArrowRightIcon, ChevronDownIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { ActorMark } from "../actor-ref.js";
import { DRAFT_PLACE, type Draft, EMPTY_DRAFT, useDraftWriter } from "../composer-drafts.js";
import { ActionMenu } from "../desktop/action-menu.js";
import { useAgentArchive } from "../desktop/agent-archive.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { COMPOSER_ROOM_CLASS } from "./agent-composer.js";
import { CONTINUE_LABEL, CONTINUED_IN, modelLabel } from "./agent-model.js";
import { AgentActorRef, type AgentSubject, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { useContinueDoor } from "./fork-action.js";
import { ModelMenu, settledChoice } from "./model-menu.js";
import { refusalOffer } from "./refusal-offer.js";
import { useRepositoryRemedy } from "./repository-remedy.js";
import type { AgentsControl } from "./use-agents.js";

/**
 * continue-agent.tsx -- where an agent may be continued in a new one: the press that starts it on the agent's whole transcript, and, once it was, the agents that continued it.
 *
 * The press ends a failed turn's end line, on its row, where only a new
 * agent goes on (`endLineOffersContinue`), and the note of a box
 * closed because the agent's session has ended, whose words and files it
 * carries on, so nothing typed is lost. Where the agent's tab opens drafts
 * (`useContinueDoor`), the press opens the task's draft as a continue of
 * the agent, the words and files laid in its box, and lets the closed box's
 * go at once: nothing is sent until the developer sends the draft, an empty
 * one continuing on nothing more. Elsewhere it starts the new agent at
 * once with them as its note, and lets them go once it landed, unless they
 * were changed meanwhile, in another window, when the newer words stay;
 * that press is held busy while it is out, and says beside itself why it
 * did not start. Nothing offers it where no Start could run: on an
 * archived task, or an agent on none. A turn the model refused offers a
 * continue on another model in its place (`RefusalContinue`), which starts
 * at once, since its press names the model it runs on.
 *
 * Once any agent continues this one (`continuedByIds`), the agents are
 * named in one place, oldest first, each by its chip, which opens its tab:
 * the note that takes the box's place (`ContinuedComposerNote`), with Stop
 * while a turn still runs and Archive, since a continued agent is done
 * with; or, where the box is taken by an archived task's note, the row at
 * the transcript's end (`ContinuedTrail`). Past three, only the newest two
 * stand as chips, and +N more opens a menu of the rest, so the note stays
 * one line however often the agent was continued. The press stays where
 * it was, on the failed end line's row, saying Continue again, since a
 * continuation may itself fail or go wrong; each press is a continue of
 * its own, under a key of its own (`use-agents.ts`). A fork is no
 * continuation, so a source with only forks keeps its box.
 */

/** How many of the newest continuing agents stand as chips once more than one more would; the rest are under +N more. */
const CONTINUED_CHIPS = 2;

/** What the continued box's note offers, worded once. */
const CONTINUED_COPY = {
  MORE: (count: number) => `+${count} more`,
  EARLIER: "Earlier continuations",
  ARCHIVE: "Archive",
  ARCHIVING: "Archiving",
  STOP: "Stop",
  STOPPING: "Stopping",
  CONTINUING: "Continuing in new agent",
  CONTINUE_ON: (model: string) => `Continue on ${model}`,
  CHOOSE_MODEL: "Choose another model",
  CONNECT_HINT: "Connect another harness to continue on its models.",
} as const;

/** What a closed box hands the press: its words and the files attached to them, and the agent's task, under which they are kept. */
export interface ContinueCarry {
  readonly words: string;
  readonly attachments: readonly AgentAttachment[];
  readonly taskId: string | null;
}

/** Whether a draft still holds what a press carried: the same words and the same files in order. */
function holdsCarried(draft: Draft, carry: ContinueCarry): boolean {
  return (
    draft.text === carry.words &&
    draft.attachments.length === carry.attachments.length &&
    draft.attachments.every((file, index) => file === carry.attachments[index])
  );
}

/**
 * A continue started at once from the agent's whole transcript, on `choice`
 * where one is named, with the box's words and files as its note: held busy
 * while it is out, saying why it did not start, and letting the box's words
 * go once it landed, unless they were changed meanwhile, in another window.
 */
function useContinueStart(
  agentId: string,
  control: Pick<AgentsControl, "continueAgent">,
  carry: ContinueCarry | undefined,
): {
  readonly busy: boolean;
  readonly note: Failure | undefined;
  readonly start: (choice?: ModelChoice) => void;
  /** Lets the box's words go where it still holds what the press carried. */
  readonly letGo: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Failure | undefined>(undefined);
  const writer = useDraftWriter();
  const { continueAgent } = control;
  useAnnounceShown(ANNOUNCE.ALERT, note?.text ?? "");
  const letGo = () => {
    if (carry === undefined) return;
    writer.update({ kind: DRAFT_PLACE.AGENT, planId: carry.taskId, agentId }, (now) =>
      holdsCarried(now, carry) ? EMPTY_DRAFT : now,
    );
  };
  const start = (choice?: ModelChoice) => {
    if (continueAgent === undefined || busy) return;
    const words = carry?.words.trim() ?? "";
    setBusy(true);
    setNote(undefined);
    void continueAgent(
      agentId,
      words === "" ? undefined : words,
      carry?.attachments ?? [],
      undefined,
      choice,
    ).then((failed) => {
      setBusy(false);
      setNote(failed);
      // The words went on into the new agent, so the box lets them go, where nothing newer stands.
      if (failed === undefined) letGo();
    });
  };
  return { busy, note, start, letGo };
}

/** Why a continue did not start, said beside its press. */
function ContinueNote({ note }: { note: Failure | undefined }): React.JSX.Element | null {
  return note === undefined ? null : <span className="text-danger">{note.text}</span>;
}

export function ContinueAgent({
  agentId,
  control,
  carry,
  label = CONTINUE_LABEL,
}: {
  agentId: string;
  control: Pick<AgentsControl, "continueAgent">;
  /** The closed box's words and files, which the press carries; none for a press that carries nothing. */
  carry?: ContinueCarry | undefined;
  /** What the press says: Continue in new agent, or Continue again once another agent continued this one. */
  label?: string;
}): React.JSX.Element | null {
  const { busy, note, start, letGo } = useContinueStart(agentId, control, carry);
  const opensDraft = useContinueDoor();

  const press = () => {
    // Where the place opens a draft, the words move into the continue's draft, sent once the developer sends it.
    if (opensDraft !== undefined && control.continueAgent !== undefined) {
      opensDraft(carry?.words ?? "", carry?.attachments ?? []);
      letGo();
      return;
    }
    start();
  };

  if (control.continueAgent === undefined) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-control-gap gap-y-tight-gap">
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        icon={<ArrowRightIcon aria-hidden="true" />}
        busy={busy}
        busyLabel={CONTINUED_COPY.CONTINUING}
        onClick={press}
      >
        {label}
      </Button>
      <ContinueNote note={note} />
    </span>
  );
}

/**
 * The offer on a turn the model refused (`endLineOffersOtherModel`):
 * Continue on, naming the model `refusalOffer` picks, the other harness's
 * where the reader runs it, which starts the continue at once on it, the
 * box's words and files its note, so nothing switches without its press;
 * beside it, a chevron opening
 * the shared model menu (`model-menu.tsx`), whose pick names another model
 * on the press, starting nothing. Where nothing of the reader's pays for
 * the other harness, Connect names it, landing on its row in Settings ›
 * Agents. Nothing is offered before the catalog is read, nor where nothing
 * starts a continue (`continueAgent`); where the catalog offers no other
 * model the reader runs, Connect stands alone.
 */
export function RefusalContinue({
  agent,
  control,
  carry,
}: {
  agent: Pick<AgentSummary, "id" | "model" | "effort">;
  control: Pick<AgentsControl, "continueAgent" | "models" | "modelsFailed" | "readModels">;
  /** The box's words and files, which the press carries into the new agent. */
  carry: ContinueCarry | undefined;
}): React.JSX.Element | null {
  const { busy, note, start } = useContinueStart(agent.id, control, carry);
  const [picked, setPicked] = useState<ModelChoice | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const root = useRef<HTMLSpanElement>(null);
  const remedy = useRepositoryRemedy();
  const { models } = control;
  if (control.continueAgent === undefined || models === undefined) return null;
  const offer = refusalOffer(models, agent);
  const choice = picked ?? offer.choice;
  const connect =
    offer.connect === undefined
      ? undefined
      : {
          reason: FAILURE_REASON.CONNECT_AGENTS,
          text: CONTINUED_COPY.CONNECT_HINT,
          provider: offer.connect,
        };
  const close = () => setOpen(false);
  return (
    <span
      ref={root}
      className="relative inline-flex flex-wrap items-center gap-x-control-gap gap-y-tight-gap"
      data-refusal-offer=""
    >
      {choice === undefined ? null : (
        <span className="inline-flex items-center gap-tight-gap">
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            icon={<ArrowRightIcon aria-hidden="true" />}
            busy={busy}
            busyLabel={CONTINUED_COPY.CONTINUING}
            onClick={() => start(choice)}
          >
            {CONTINUED_COPY.CONTINUE_ON(modelLabel(choice.model, models))}
          </Button>
          <IconButton
            icon={<ChevronDownIcon aria-hidden="true" />}
            label={CONTINUED_COPY.CHOOSE_MODEL}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            onClick={() => setOpen(!open)}
          />
        </span>
      )}
      {connect === undefined ? null : (
        <TextButton onClick={() => remedy(connect)?.()}>{remedyLabel(connect)}</TextButton>
      )}
      <ContinueNote note={note} />
      {drawn.mounted ? (
        <ModelMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          align={POPOVER_ALIGN.START}
          models={models}
          failed={control.modelsFailed}
          onRetry={control.readModels}
          chosen={settledChoice(models, choice)}
          startsNew
          onChoose={setPicked}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && root.current?.contains(left))) close();
          }}
        />
      ) : null}
    </span>
  );
}

/** What names the agents that continued another: the control their chips are read from, and the door that opens one's tab. */
interface ContinuedDoors {
  readonly agentIds: readonly string[];
  /** The titles the source's summary gives them (`continuedByTitles`), which name a chip the list does not hold. */
  readonly titles: ReadonlyMap<string, string>;
  readonly control: Pick<AgentsControl, "agents" | "archived" | "models" | "me" | "pullRequests">;
  /** Opens an agent's tab; none where nothing opens one, when a chip hangs its card alone. */
  readonly onOpenAgent: ((agentId: string) => void) | undefined;
}

/** An agent the list does not hold, named by the title the source's summary gives it where it gives one. */
function titledSubject(subject: AgentSubject, title: string | undefined): AgentSubject {
  if (subject.agent !== undefined || title === undefined) return subject;
  if (subject.tile.kind !== ACTOR_KIND.AGENT) return subject;
  return { ...subject, name: title, tile: { ...subject.tile, name: title } };
}

/** Names made one apart from another where two continuing agents share one, as a menu tells its items apart by their words. */
function distinctNames(names: readonly string[]): readonly string[] {
  // Note that every name is held taken first, so a suffix never lands on a name another already has.
  const taken = new Set(names);
  const given = new Set<string>();
  return names.map((name) => {
    let label = name;
    for (let count = 2; given.has(label) || (label !== name && taken.has(label)); count += 1) {
      label = `${name} · ${count}`;
    }
    given.add(label);
    return label;
  });
}

/**
 * Continued in, then each continuing agent's chip, a comma held after each
 * but the last so no gap opens before it. Past one more than
 * `CONTINUED_CHIPS`, the newest of them stand as chips and +N more opens a
 * menu of the earlier ones, oldest first, each by its mark and name and
 * opening its tab.
 */
function ContinuedIn({
  agentIds,
  titles,
  control,
  onOpenAgent,
}: ContinuedDoors): React.JSX.Element {
  const menu = useMenu(true);
  const folds = agentIds.length > CONTINUED_CHIPS + 1;
  const earlier = folds ? agentIds.slice(0, agentIds.length - CONTINUED_CHIPS) : [];
  const chips = folds ? agentIds.slice(-CONTINUED_CHIPS) : agentIds;
  const subjectOf = (agentId: string) =>
    titledSubject(agentSubject(control, agentId, NOTHING_HELD, false), titles.get(agentId));
  const names = distinctNames(earlier.map((agentId) => subjectOf(agentId).name));
  const trigger = menu.trigger(riseAboveEnd);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-tight-gap" data-continued="">
      <span>{CONTINUED_IN}</span>
      {chips.map((agentId, index) => (
        <span key={agentId} className="inline-flex min-w-0 items-baseline">
          <AgentActorRef
            subject={subjectOf(agentId)}
            models={control.models}
            onOpen={() => onOpenAgent?.(agentId)}
          />
          {index === chips.length - 1 && !folds ? null : <span aria-hidden="true">,</span>}
        </span>
      ))}
      {folds ? (
        <TextButton aria-expanded={trigger["aria-expanded"]} onClick={trigger.onClick}>
          {CONTINUED_COPY.MORE(earlier.length)}
        </TextButton>
      ) : null}
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={CONTINUED_COPY.EARLIER}
          menu={menu.drawn}
          groups={[
            earlier.map((agentId, index) => ({
              label: names[index] ?? agentId,
              icon: <ActorMark actor={subjectOf(agentId).tile} />,
              onSelect: () => onOpenAgent?.(agentId),
              disabled: onOpenAgent === undefined,
            })),
          ]}
          onClose={menu.close}
        />
      )}
    </span>
  );
}

/** The trail at a transcript's end naming the agents that continued it, led by an arrow as Forked to is by its split. */
export function ContinuedTrail(doors: ContinuedDoors): React.JSX.Element {
  return (
    <NoteLine look={NOTE_LINE_LOOK.TRAIL} glyph={<ArrowRightIcon />} data-continued-trail="">
      <ContinuedIn {...doors} />
    </NoteLine>
  );
}

/**
 * The quiet note in a continued agent's box, framed as the box it replaces:
 * Continued in and the agents' chips, then Stop while a turn still runs,
 * and Archive, bordered as a housekeeping press is, which asks first only
 * where archiving would stop a teammate's turn (`useAgentArchive`), is held
 * busy while a teammate's agent at rest is read again first, and toasts with
 * Undo once it took. An agent already
 * archived is offered no Archive.
 */
export function ContinuedComposerNote({
  agent,
  doors,
  stop,
  control,
  shown,
}: {
  agent: AgentSummary;
  doors: ContinuedDoors;
  /** Stops the agent, while it has a turn to stop; settles once the service has answered, with whether it took the stop. */
  stop?: (() => Promise<boolean>) | undefined;
  control: AgentsControl;
  /** Whether the tab is on screen, which the archive's question goes with. */
  shown: boolean;
}): React.JSX.Element {
  const [stopping, setStopping] = useState(false);
  // Note that a Stop the service took reads Stopping until the agent offers none, because the task
  // list carries the stop a moment after the answer.
  if (stopping && stop === undefined) setStopping(false);
  const archive = useAgentArchive(agent, control, shown);
  const pressStop = (run: () => Promise<boolean>) => {
    setStopping(true);
    run().then(
      (took) => setStopping(took),
      () => setStopping(false),
    );
  };
  return (
    <>
      <div className={COMPOSER_ROOM_CLASS}>
        <ComposerFrame className="continued-composer py-row-inset pr-row-inset pl-list-inset">
          <Banner
            look={BANNER_LOOK.ROW}
            glyph={<ArrowRightIcon aria-hidden="true" />}
            actions={
              stop === undefined && agent.archivedAt !== undefined ? undefined : (
                <>
                  {stop === undefined ? null : (
                    <Button
                      busy={stopping}
                      busyLabel={CONTINUED_COPY.STOPPING}
                      onClick={() => pressStop(stop)}
                    >
                      {CONTINUED_COPY.STOP}
                    </Button>
                  )}
                  {agent.archivedAt !== undefined ? null : (
                    <Button
                      variant={BUTTON_VARIANT.OUTLINE}
                      busy={archive.reading}
                      busyLabel={CONTINUED_COPY.ARCHIVING}
                      onClick={archive.action.onSelect}
                    >
                      {CONTINUED_COPY.ARCHIVE}
                    </Button>
                  )}
                </>
              )
            }
          >
            <Text tone={TEXT_TONE.MUTED}>
              <ContinuedIn {...doors} />
            </Text>
          </Banner>
        </ComposerFrame>
      </div>
      {archive.dialog}
    </>
  );
}
