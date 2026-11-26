import { ENTITY_KIND } from "@repo/features/entity-kind";
import type { InstalledSkillSummary } from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillFailedView,
} from "@repo/features/installed-skill-view";
import {
  INSTALLED_SKILL_SCOPE,
  MAC_SKILL_APP,
  type MacSkillApp,
} from "@repo/features/installed-skill-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { failureLine } from "@repo/features/skills-settings-words";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { MacSkill } from "@repo/host/contract";
import { EXPERIMENT } from "@repo/settings";
import {
  Checkbox,
  DIALOG_SIZE,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  ErrorState,
  GAP,
  GlyphSlot,
  HarnessMark,
  Inline,
  SETTINGS_ROW_CONTROLS,
  SettingsLine,
  SettingsRow,
  SettingsRowMark,
  SettingsRowsFold,
  SettingsSection,
  SpinnerRegion,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type ActVariables, askAct } from "../act.js";
import { EntityGlyph } from "../entities/entity-glyph.js";
import { unreadShown } from "../failure-report.js";
import { QUERY_ROOT } from "../query-keys.js";
import { SkillMark } from "../tasks/skill-ref.js";
import { pressTakeBack, type TakeBackWrite } from "../undo-stack.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
import {
  leftOutLine,
  MAC_SKILLS_LINE,
  type MacSkillsReview,
  macSkillsReview,
  type SkippedSkill,
  skillCount,
  summaryLine,
} from "./mac-skills-model.js";

/**
 * mac-skills-dialog.tsx -- Settings › Skills' Bring in from your Mac: the skills this Mac's own coding agents keep, grouped by the agent whose folder holds them, each to tick, every one left out with why, and Bring in.
 *
 * The card reads the Mac's skills folders as it opens (`MAC_SKILLS_READ`,
 * the desktop's alone), and leaves out a skill whose name the reader
 * already has (`mac-skills-model.ts`). Every skill offered starts ticked. Bring in sends each one ticked as its own folder
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

/**
 * The writes Bring in and its Undo send, each a mutation the Skills page
 * holds, so a send outlives the card that pressed it and stands as pending
 * where the page draws it.
 */
export interface MacSkillsDoors {
  readonly importFolder: (
    asked: ActVariables<typeof ACT_KIND.INSTALLED_SKILLS_IMPORT>,
  ) => Promise<ImportAnswer>;
  readonly remove: (
    asked: ActVariables<typeof ACT_KIND.INSTALLED_SKILLS_REMOVE>,
  ) => Promise<RemoveAnswer>;
}

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
  undo: ({ remove }, { answered }) =>
    answered.then((answers) =>
      Promise.all(
        madeOf(answers).map((skill) =>
          remove({ skillId: skill.id }).catch((): RemoveAnswer => UNANSWERED),
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
} satisfies TakeBackWrite<
  MacSkillsDoors,
  Brought,
  readonly ImportAnswer[],
  readonly RemoveAnswer[]
>;

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

/** One skill to tick: its name and what it does. */
function OfferedRow({
  skill,
  ticked,
  onTick,
}: {
  skill: MacSkill;
  ticked: boolean;
  onTick: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <SettingsRow
      leading={
        <SettingsRowMark>
          <SkillMark />
        </SettingsRowMark>
      }
      label={<ReplayMask>{skill.name}</ReplayMask>}
      controls={SETTINGS_ROW_CONTROLS.BESIDE}
      description={<ReplayMask>{skill.description}</ReplayMask>}
    >
      {() => <Checkbox label={`Bring in ${skill.name}`} checked={ticked} onChange={onTick} />}
    </SettingsRow>
  );
}

/** One skill left out: its name, the folder it was found in, and why on a badge, with nothing to tick. */
function SkippedRow({ skipped }: { skipped: SkippedSkill }): React.JSX.Element {
  return (
    <SettingsRow
      leading={
        <SettingsRowMark>
          <AppMark app={skipped.app} />
        </SettingsRowMark>
      }
      label={<ReplayMask>{skipped.name}</ReplayMask>}
      description={skipped.why}
    />
  );
}

/** The skills left out, folded under one row saying how many, closed until it is opened. */
function LeftOutFold({ skipped }: { skipped: readonly SkippedSkill[] }): React.JSX.Element {
  return (
    <SettingsSection>
      <SettingsRowsFold
        label={MAC_SKILLS_LINE.SHOW_LEFT_OUT}
        head={(chevron) => (
          <SettingsRow
            label={MAC_SKILLS_LINE.LEFT_OUT}
            description={leftOutLine(skipped.length)}
            end={() => chevron}
          />
        )}
        rows={skipped.map((each) => <SkippedRow key={each.folder} skipped={each} />)}
      />
    </SettingsSection>
  );
}

/** The mark of the agent whose skills folder a skill was found in, the folder agents share drawn as a folder. */
function AppMark({ app }: { app: MacSkillApp }): React.JSX.Element {
  switch (app) {
    case MAC_SKILL_APP.AGENTS:
      return <EntityGlyph kind={ENTITY_KIND.FOLDER} />;
    case MAC_SKILL_APP.CLAUDE_CODE:
      return <HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} />;
    case MAC_SKILL_APP.CODEX:
      return <HarnessMark provider={MODEL_PROVIDER.OPENAI} />;
    case MAC_SKILL_APP.CURSOR:
      return <HarnessMark provider={MODEL_PROVIDER.CURSOR} />;
  }
}

/**
 * One group of the card's rows under its heading and the line under that.
 * Note that the heading is the card's own rather than a Settings section's,
 * because the settings search must find no group of a dialog's.
 */
function GroupHead({
  app,
  title,
  caption,
  children,
}: {
  app: MacSkillApp;
  title: string;
  caption: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Stack gap={GAP.ITEM}>
      <Stack gap={GAP.NONE}>
        <Inline gap={GAP.ICON}>
          <GlyphSlot>
            <AppMark app={app} />
          </GlyphSlot>
          <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.H3}>
            {title}
          </Text>
        </Inline>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          <ReplayMask>{caption}</ReplayMask>
        </Text>
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
        <GroupHead key={group.app} app={group.app} title={group.title} caption={group.folder}>
          {group.offered.map((skill) => (
            <OfferedRow
              key={skill.folder}
              skill={skill}
              ticked={!unticked.has(skill.folder)}
              onTick={(on) => onTick(skill.folder, on)}
            />
          ))}
        </GroupHead>
      ))}
      {review.skipped.length === 0 ? null : <LeftOutFold skipped={review.skipped} />}
    </Stack>
  );
}

/** The review once the Mac's folders are read; none while the read is out. */
function useReview(personal: readonly InstalledSkillSummary[]) {
  // Note that Cursor's folder is read only while its experiment is on, as its harness is offered only then.
  const cursor = useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.CURSOR) });
  const apps = cursor.data === true ? READ_APPS_WITH_CURSOR : READ_APPS;
  const read = useQuery(macSkillsQuery(apps));

  return {
    read,
    review: read.data === undefined ? undefined : macSkillsReview(read.data, personal),
  };
}

/** Bring in from your Mac's card, open while `open` stands; it tells the page each skill as it lands. */
export function MacSkillsDialog({
  open,
  workspace,
  personal,
  onLanded,
  doors,
  onClose,
  onExited,
}: {
  open: boolean;
  workspace: Workspace;
  /** The reader's own skills, which a skill on the Mac is weighed against. */
  personal: readonly InstalledSkillSummary[];
  /** Hears the skills each send made, as it answers. */
  onLanded: (made: readonly InstalledSkillSummary[]) => void;
  /** The page's mutations Bring in and its Undo send on. */
  doors: MacSkillsDoors;
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

  const picked = review?.offered.filter((skill) => !unticked.has(skill.folder)) ?? [];

  const bringIn = () => {
    const answered = Promise.all(
      picked.map((skill) =>
        doors
          .importFolder({
            workspaceId: workspace.id,
            scope: INSTALLED_SKILL_SCOPE.PERSONAL,
            mac: { app: skill.app, folder: skill.folder },
            files: skill.files,
          })
          .catch((): ImportAnswer => UNANSWERED)
          .then((answer) => {
            if ("skills" in answer) onLanded(answer.skills);

            return answer;
          }),
      ),
    );

    void pressTakeBack(BRING_IN_WRITE, doors, { count: picked.length, answered });
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
