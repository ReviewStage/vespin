import {
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  Checkbox,
  DIALOG_SIZE,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  GAP,
  PlusIcon,
  SETTINGS_ROW_CONTROLS,
  SettingsPage,
  SettingsRow,
  SettingsRowMark,
  SettingsRowStateLine,
  SettingsSection,
  SpinnerRegion,
  STATUS_TONE,
  Stack,
  Text,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useEffect, useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * import-from-mac.tsx -- a throwaway design mockup, not a shipped component:
 * bringing the skills a member's Mac already has into Settings › Skills.
 *
 * Three steps. A row on Skills offers Bring in from your Mac. Its card reads
 * the Mac's skills folders and lists what it found, each one ticked; a skill
 * the member already has with the same files is left out, and one sharing a
 * name with a different skill comes in under a new name. Bring in lands the
 * skills lit, with a banner carrying Undo. Every name and path is made up.
 */

const MAC = "Ada's MacBook Pro";

/** Where the import stands. */
const STEP = {
  IDLE: "idle",
  READING: "reading",
  CHOOSING: "choosing",
  DONE: "done",
  UNDO_ASK: "undo-ask",
  UNDONE: "undone",
} as const;

type Step = (typeof STEP)[keyof typeof STEP];

/** One skill found on the Mac. */
interface Found {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  /** The name it comes in under, where one the member has already takes its own. */
  readonly renamed?: string;
}

const FOUND: readonly Found[] = [
  {
    name: "flaky-test-hunter",
    description: "Reruns a failing test in isolation to tell a flaky one from a broken one.",
    path: "~/.claude/skills",
  },
  {
    name: "db-migrations",
    description: "Writes reversible Postgres migrations and checks them against a scratch copy.",
    path: "~/.claude/skills",
  },
  {
    name: "release-notes",
    description: "Drafts release notes from the pull requests merged since the last tag.",
    path: "~/.claude/skills",
    renamed: "release-notes-2",
  },
  {
    name: "storybook-snapshots",
    description: "Updates Storybook snapshots and explains each visual change.",
    path: "~/.agents/skills",
  },
];

/** Skills the member already has. */
const INSTALLED = [
  {
    name: "pr-review",
    description: "Reviews a diff for correctness and missing tests before a PR opens.",
    line: "From acme/agent-skills",
  },
  {
    name: "release-notes",
    description: "Writes release notes in the changelog's voice.",
    line: "Pasted",
  },
] as const;

/** "3 skills", or "1 skill". */
function skillCount(count: number): string {
  return `${count} skill${count === 1 ? "" : "s"}`;
}

/** A skill's row, as Settings › Skills draws one. */
function SkillRow({
  name,
  description,
  line,
  landed = false,
}: {
  name: string;
  description: string;
  line: string;
  landed?: boolean;
}): React.JSX.Element {
  return (
    <SettingsRow
      leading={
        <SettingsRowMark>
          <GLYPH.SKILL />
        </SettingsRowMark>
      }
      label={name}
      landed={landed}
      description={
        <>
          {description}
          <SettingsRowStateLine block>{line}</SettingsRowStateLine>
        </>
      }
    />
  );
}

/** One found skill in the card, ticked to bring it in. */
function FoundRow({
  skill,
  picked,
  onPick,
}: {
  skill: Found;
  picked: boolean;
  onPick: (picked: boolean) => void;
}): React.JSX.Element {
  return (
    <SettingsRow
      label={skill.renamed ?? skill.name}
      controls={SETTINGS_ROW_CONTROLS.BESIDE}
      description={
        <>
          {skill.description}
          <SettingsRowStateLine block>
            {skill.renamed === undefined
              ? skill.path
              : `You already have a different ${skill.name}, so this one comes in as ${skill.renamed}`}
          </SettingsRowStateLine>
        </>
      }
    >
      {() => <Checkbox label={`Bring in ${skill.name}`} checked={picked} onChange={onPick} />}
    </SettingsRow>
  );
}

/** The card: reading the Mac, then the skills found. */
function ImportDialog({
  step,
  picks,
  onPick,
  onBring,
  onClose,
}: {
  step: Step;
  picks: ReadonlySet<string>;
  onPick: (name: string, picked: boolean) => void;
  onBring: () => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Dialog
      open={step === STEP.READING || step === STEP.CHOOSING}
      title={`Skills on ${MAC}`}
      size={DIALOG_SIZE.WIDE}
      onDismiss={onClose}
      actions={
        <DialogActions
          onCancel={onClose}
          act={{
            verb: `Bring in ${skillCount(picks.size)}`,
            tone: DIALOG_TONE.PRIMARY,
            running: "Bringing in",
            disabled: step !== STEP.CHOOSING || picks.size === 0,
            onPress: onBring,
          }}
        />
      }
    >
      {step === STEP.READING ? (
        <SpinnerRegion label={`Reading the skills folders on ${MAC}`} />
      ) : (
        <Stack gap={GAP.FIELD}>
          <Text>
            Found in the skills folders of Claude Code, Cursor, and Codex. 1 you already have is
            left out.
          </Text>
          <SettingsSection>
            {FOUND.map((skill) => (
              <FoundRow
                key={skill.name}
                skill={skill}
                picked={picks.has(skill.name)}
                onPick={(picked) => onPick(skill.name, picked)}
              />
            ))}
          </SettingsSection>
        </Stack>
      )}
    </Dialog>
  );
}

/** The whole flow on Settings › Skills. */
function ImportMockup(): React.JSX.Element {
  const [step, setStep] = useState<Step>(STEP.IDLE);
  const [picks, setPicks] = useState<ReadonlySet<string>>(new Set());

  // Reading the Mac takes a moment, then the card lists what it found.
  useEffect(() => {
    if (step !== STEP.READING) return;
    const timer = setTimeout(() => setStep(STEP.CHOOSING), 1200);

    return () => clearTimeout(timer);
  }, [step]);

  const start = () => {
    setPicks(new Set(FOUND.map((skill) => skill.name)));
    setStep(STEP.READING);
  };

  const pick = (name: string, on: boolean) => {
    const next = new Set(picks);

    if (on) next.add(name);
    else next.delete(name);
    setPicks(next);
  };

  const landed = step === STEP.DONE || step === STEP.UNDO_ASK;
  const brought = FOUND.filter((skill) => picks.has(skill.name));

  return (
    <div className="catalog-settings-frame catalog-import-frame">
      <SettingsPage title="Skills">
        <Stack gap={GAP.SECTION}>
          {landed ? (
            <Banner
              look={BANNER_LOOK.CARD}
              tone={STATUS_TONE.COMPLETE}
              glyph={<GLYPH.DONE />}
              actions={
                <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setStep(STEP.UNDO_ASK)}>
                  Undo
                </Button>
              }
            >
              Brought in {skillCount(brought.length)} from {MAC}.
            </Banner>
          ) : null}
          {step === STEP.UNDONE ? (
            <Banner look={BANNER_LOOK.CARD} glyph={<GLYPH.HISTORY />}>
              Undone. The skills from {MAC} are gone.
            </Banner>
          ) : null}
          <SettingsSection
            title="Personal"
            action={
              <Button variant={BUTTON_VARIANT.OUTLINE} icon={<PlusIcon />}>
                Add skill
              </Button>
            }
          >
            {INSTALLED.map((skill) => (
              <SkillRow key={skill.name} {...skill} />
            ))}
            {landed
              ? brought.map((skill) => (
                  <SkillRow
                    key={skill.name}
                    name={skill.renamed ?? skill.name}
                    description={skill.description}
                    line={`From ${MAC}`}
                    landed
                  />
                ))
              : null}
          </SettingsSection>
          <SettingsSection>
            <SettingsRow
              leading={
                <SettingsRowMark>
                  <GLYPH.DESKTOP />
                </SettingsRowMark>
              }
              label="Bring in from your Mac"
              description="Copy the skills your Mac's Claude Code, Cursor, and Codex already have, so every agent can use them."
            >
              {() => (
                <Button variant={BUTTON_VARIANT.OUTLINE} onClick={start}>
                  Look for skills
                </Button>
              )}
            </SettingsRow>
          </SettingsSection>
        </Stack>
      </SettingsPage>
      <ImportDialog
        step={step}
        picks={picks}
        onPick={pick}
        onBring={() => setStep(STEP.DONE)}
        onClose={() => setStep(STEP.IDLE)}
      />
      <Dialog
        open={step === STEP.UNDO_ASK}
        title={`Undo the skills from ${MAC}?`}
        onDismiss={() => setStep(STEP.DONE)}
        actions={
          <DialogActions
            onCancel={() => setStep(STEP.DONE)}
            act={{
              verb: "Undo",
              tone: DIALOG_TONE.DANGER,
              running: "Undoing",
              onPress: () => setStep(STEP.UNDONE),
            }}
          />
        }
      >
        <Text>Removes the {skillCount(brought.length)} it brought in. Your Mac keeps its own.</Text>
      </Dialog>
    </div>
  );
}

function ImportFromMacExample(): React.JSX.Element {
  return (
    <CatalogSection id="import-from-mac-flow" title="Bring in skills from a Mac">
      <ImportMockup />
    </CatalogSection>
  );
}

export const IMPORT_FROM_MAC_EXAMPLE: Example = {
  id: "import-from-mac",
  title: "Import skills from a Mac (design mockup)",
  Render: ImportFromMacExample,
};
