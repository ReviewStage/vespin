import type {
  InstalledSkillContent,
  InstalledSkillSummary,
} from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillFailedView,
} from "@repo/features/installed-skill-view";
import {
  INSTALLED_SKILL_SCOPE,
  MAC_SKILL_APP,
  type MacSkillApp,
} from "@repo/features/installed-skill-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { failureLine } from "@repo/features/skills-settings-words";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import {
  Badge,
  Checkbox,
  DIALOG_SIZE,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  ErrorState,
  GAP,
  SETTINGS_ROW_CONTROLS,
  SETTINGS_ROW_STATE,
  SettingsLine,
  SettingsRow,
  SettingsRowMark,
  SettingsRowStateLine,
  SettingsSection,
  SpinnerRegion,
  STATUS_TONE,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { queryOptions, useQueries, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { askAct } from "../act.js";
import { unreadShown } from "../failure-report.js";
import { QUERY_ROOT } from "../query-keys.js";
import { SkillMark } from "../tasks/skill-ref.js";
import { pressTakeBack, type TakeBackWrite } from "../undo-stack.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
import {
  clashingNames,
  MAC_SKILLS_LINE,
  type MacSkillsReview,
  macSkillsReview,
  type OfferedSkill,
  type SkippedSkill,
  skillCount,
  summaryLine,
} from "./mac-skills-model.js";

/**
 * mac-skills-dialog.tsx -- Settings › Skills' Bring in from your Mac: the skills this Mac's own coding agents keep, grouped by the agent whose folder holds them, each to tick, every one left out with why, and Bring in.
 *
 * The card reads the Mac's skills folders as it opens (`MAC_SKILLS_READ`,
 * the desktop's alone) and the reader's own skills that share a name with
 * one found, so it can say which are already installed and which come in
 * under a new name (`mac-skills-model.ts`). Every skill offered starts
 * ticked. Bring in sends each one ticked as its own folder
 * (`INSTALLED_SKILLS_IMPORT`) into the reader's own skills and closes the
 * card at once; the undo stack says so on a toast whose Undo, as ⌘Z, waits
 * for them and deletes each that came in (`pressTakeBack`), and a skill the
 * service refused says why on a toast of its own. The page lights each one
 * as it lands.
 */

/** What a skill's folder sent answers, or why it was not kept. */
type ImportAnswer =
  | { readonly skills: readonly InstalledSkillSummary[] }
  | Pick<InstalledSkillFailedView, "failure" | "skillName">;

/** What a skill's removal answers, or why it was not removed. */
type RemoveAnswer = { readonly id: string } | { readonly failure: string };

const UNANSWERED = { failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED } as const;

/** The folders the card reads: the one agents share, and those of the agents every account runs. */
const READ_APPS = [MAC_SKILL_APP.AGENTS, MAC_SKILL_APP.CLAUDE_CODE, MAC_SKILL_APP.CODEX] as const;

/** The folders the card reads while the Cursor experiment is on. */
const READ_APPS_WITH_CURSOR = [...READ_APPS, MAC_SKILL_APP.CURSOR] as const;

/** The skills brought in, as the undo stack keeps them: what was sent, and what each send answers once it does. */
interface Brought {
  readonly count: number;
  readonly answered: Promise<readonly ImportAnswer[]>;
}

/** What Undo deletes: no doors of its own, since each write is its own act. */
type Doors = Record<never, never>;

/** The skills a send made. */
function madeOf(answers: readonly ImportAnswer[]): readonly InstalledSkillSummary[] {
  return answers.flatMap((answer) => ("skills" in answer ? answer.skills : []));
}

/** Bring in from your Mac as the undo stack keeps it: taken at Bring in, taken back by deleting what came in. */
const BRING_IN_WRITE = {
  words: ({ count }) => `Brought in ${skillCount(count)} from your Mac`,
  glyph: () => <SkillMark />,
  unmasked: () => true,
  act: (_doors, { answered }) => answered,
  undo: (_doors, { answered }) =>
    answered.then((answers) =>
      Promise.all(
        madeOf(answers).map((skill) =>
          askAct(ACT_KIND.INSTALLED_SKILLS_REMOVE, { skillId: skill.id }).catch(
            (): RemoveAnswer => UNANSWERED,
          ),
        ),
      ),
    ),
  refused: ({ count }, answers) => {
    const refused = answers.filter((answer) => "failure" in answer);
    const [first] = refused;

    if (first === undefined || !("failure" in first)) return undefined;

    return {
      whole: refused.length === answers.length,
      words:
        count === 1
          ? failureLine(first)
          : `${refused.length} of ${skillCount(count)} could not be brought in. ${failureLine(first)}`,
      failure: { surface: FAILURE_SURFACE.SKILL_ADD, cause: first },
    };
  },
  unheld: (_brought, removals) => {
    const first = removals.find((removal) => "failure" in removal);

    return first === undefined
      ? undefined
      : {
          words:
            "Some of the skills from your Mac could not be deleted. Delete them from the list.",
          failure: { surface: FAILURE_SURFACE.SKILL_REMOVE, cause: first },
        };
  },
} satisfies TakeBackWrite<Doors, Brought, readonly ImportAnswer[], readonly RemoveAnswer[]>;

/** The skills folders asked, read afresh each time the card opens, answered at once on a refusal. */
function macSkillsQuery(apps: readonly MacSkillApp[]) {
  return queryOptions({
    queryKey: [QUERY_ROOT.MAC_SKILLS, ...apps],
    queryFn: () => askAct(ACT_KIND.MAC_SKILLS_READ, { apps }),
    retry: false,
    gcTime: 0,
    staleTime: 0,
  });
}

/** One of the reader's skills read whole, to say whether one on the Mac is the same; shared with the page's View. */
function installedSkillQuery(skillId: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.INSTALLED_SKILL, skillId],
    queryFn: () => askAct(ACT_KIND.INSTALLED_SKILLS_READ, { skillId }),
    retry: false,
  });
}

/** One skill to tick: its name, marked where it comes in under a new one, and what it does. */
function OfferedRow({
  offered,
  ticked,
  onTick,
}: {
  offered: OfferedSkill;
  ticked: boolean;
  onTick: (on: boolean) => void;
}): React.JSX.Element {
  const { skill, name, renamedFrom } = offered;

  return (
    <SettingsRow
      leading={
        <SettingsRowMark>
          <SkillMark />
        </SettingsRowMark>
      }
      label={<ReplayMask>{name}</ReplayMask>}
      adornment={
        renamedFrom === undefined ? undefined : (
          <Badge tone={STATUS_TONE.ATTENTION}>{MAC_SKILLS_LINE.RENAMED}</Badge>
        )
      }
      controls={SETTINGS_ROW_CONTROLS.BESIDE}
      description={
        <>
          <ReplayMask>{skill.description}</ReplayMask>
          {renamedFrom === undefined ? null : (
            <SettingsRowStateLine block state={SETTINGS_ROW_STATE.ATTENTION}>
              <ReplayMask>{`You already have a ${renamedFrom}`}</ReplayMask>
            </SettingsRowStateLine>
          )}
        </>
      }
    >
      {() => <Checkbox label={`Bring in ${name}`} checked={ticked} onChange={onTick} />}
    </SettingsRow>
  );
}

/** One skill left out: its name, the folder it was found in, and why on a badge, with nothing to tick. */
function SkippedRow({ skipped }: { skipped: SkippedSkill }): React.JSX.Element {
  return (
    <SettingsRow
      label={<ReplayMask>{skipped.name}</ReplayMask>}
      description={skipped.from}
      controls={SETTINGS_ROW_CONTROLS.BESIDE}
    >
      {() => <Badge>{skipped.why}</Badge>}
    </SettingsRow>
  );
}

/**
 * One group of the card's rows under its heading and the line under that.
 * Note that the heading is the card's own rather than a Settings section's,
 * because the settings search must find no group of a dialog's.
 */
function GroupHead({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Stack gap={GAP.ITEM}>
      <Stack gap={GAP.NONE}>
        <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.H3}>
          {title}
        </Text>
        {caption === undefined ? null : (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            <ReplayMask>{caption}</ReplayMask>
          </Text>
        )}
      </Stack>
      <SettingsSection>{children}</SettingsSection>
    </Stack>
  );
}

/** The review: a line of what was found, each folder's skills to tick, then every skill left out. */
function ReviewBody({
  review,
  unticked,
  onTick,
}: {
  review: MacSkillsReview;
  unticked: ReadonlySet<string>;
  onTick: (folder: string, on: boolean) => void;
}): React.JSX.Element {
  if (review.groups.length === 0 && review.skipped.length === 0) {
    return (
      <SettingsSection>
        <SettingsLine>{MAC_SKILLS_LINE.NONE_FOUND}</SettingsLine>
      </SettingsSection>
    );
  }

  return (
    <Stack gap={GAP.SECTION}>
      <Text>{summaryLine(review)}</Text>
      {review.groups.map((group) => (
        <GroupHead key={group.app} title={group.title} caption={group.folder}>
          {group.offered.map((offered) => (
            <OfferedRow
              key={offered.skill.folder}
              offered={offered}
              ticked={!unticked.has(offered.skill.folder)}
              onTick={(on) => onTick(offered.skill.folder, on)}
            />
          ))}
        </GroupHead>
      ))}
      {review.skipped.length === 0 ? null : (
        <GroupHead title={MAC_SKILLS_LINE.LEFT_OUT}>
          {review.skipped.map((skipped) => (
            <SkippedRow key={skipped.folder} skipped={skipped} />
          ))}
        </GroupHead>
      )}
    </Stack>
  );
}

/** The review once the Mac's folders and the reader's clashing skills are read; none while any read is out. */
function useReview(personal: readonly InstalledSkillSummary[]) {
  // Note that Cursor's folder is read only while its experiment is on, as its harness is offered only then.
  const cursor = useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.CURSOR) });
  const apps = cursor.data === true ? READ_APPS_WITH_CURSOR : READ_APPS;
  const read = useQuery(macSkillsQuery(apps));
  const clashing = read.data === undefined ? [] : clashingNames(read.data, personal);

  const contents = useQueries({
    queries: clashing.map((skill) => installedSkillQuery(skill.id)),
  });

  if (read.data === undefined || contents.some((content) => content.isPending)) {
    return { read, review: undefined };
  }

  // Note that a skill of the reader's that could not be read is taken as different, so the one on the Mac comes in under a new name rather than not at all.
  const installed = new Map<string, InstalledSkillContent>();

  for (const [at, content] of contents.entries()) {
    const skill = clashing[at];

    if (skill !== undefined && content.data !== undefined && !("failure" in content.data)) {
      installed.set(skill.name, content.data);
    }
  }

  return { read, review: macSkillsReview(read.data, personal, installed) };
}

/** Bring in from your Mac's card, open while `open` stands; it tells the page each skill as it lands. */
export function MacSkillsDialog({
  open,
  workspace,
  personal,
  onLanded,
  onClose,
  onExited,
}: {
  open: boolean;
  workspace: Workspace;
  /** The reader's own skills, which a skill on the Mac is weighed against. */
  personal: readonly InstalledSkillSummary[];
  /** Hears the skills each send made, as it answers. */
  onLanded: (made: readonly InstalledSkillSummary[]) => void;
  onClose: () => void;
  onExited: () => void;
}): React.JSX.Element {
  const { read, review } = useReview(personal);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());

  const tick = (folder: string, on: boolean) => {
    const next = new Set(unticked);

    if (on) next.delete(folder);
    else next.add(folder);
    setUnticked(next);
  };

  const picked = review?.offered.filter((offered) => !unticked.has(offered.skill.folder)) ?? [];

  const bringIn = () => {
    const answered = Promise.all(
      picked.map(({ skill, name, renamedFrom }) =>
        askAct(ACT_KIND.INSTALLED_SKILLS_IMPORT, {
          workspaceId: workspace.id,
          scope: INSTALLED_SKILL_SCOPE.PERSONAL,
          mac: { app: skill.app, folder: skill.folder },
          ...(renamedFrom === undefined ? undefined : { name }),
          files: skill.files,
        })
          .catch((): ImportAnswer => UNANSWERED)
          .then((answer) => {
            if ("skills" in answer) onLanded(answer.skills);

            return answer;
          }),
      ),
    );

    void pressTakeBack(BRING_IN_WRITE, {}, { count: picked.length, answered });
    onClose();
  };

  return (
    <Dialog
      open={open}
      title={MAC_SKILLS_LINE.TITLE}
      size={DIALOG_SIZE.WIDE}
      replayUnmasked
      onDismiss={onClose}
      onExited={onExited}
      actions={
        <DialogActions
          onCancel={onClose}
          act={{
            verb: picked.length === 0 ? "Bring in" : `Bring in ${skillCount(picked.length)}`,
            tone: DIALOG_TONE.PRIMARY,
            running: MAC_SKILLS_LINE.BRINGING,
            disabled: picked.length === 0,
            onPress: bringIn,
          }}
        />
      }
    >
      {read.isError ? (
        <ErrorState
          failure={unreadShown(FAILURE_SURFACE.SKILLS_READ)}
          onRetry={() => void read.refetch()}
        >
          {MAC_SKILLS_LINE.READ_FAILED}
        </ErrorState>
      ) : review === undefined ? (
        <SpinnerRegion label={MAC_SKILLS_LINE.READING} delay />
      ) : (
        <ReviewBody review={review} unticked={unticked} onTick={tick} />
      )}
    </Dialog>
  );
}
