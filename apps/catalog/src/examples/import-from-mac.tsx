import {
  Badge,
  BUTTON_VARIANT,
  Button,
  Checkbox,
  createToastManager,
  DIALOG_SIZE,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  GAP,
  PlusIcon,
  SETTINGS_ROW_CONTROLS,
  SETTINGS_ROW_STATE,
  SettingsPage,
  SettingsRow,
  SettingsRowMark,
  SettingsRowStateLine,
  SettingsSection,
  SpinnerRegion,
  STATUS_TONE,
  Stack,
  type StandingToast,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Toast,
  ToastActions,
  ToastStack,
  type ToastStackManager,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { type ReactNode, useEffect, useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * import-from-mac.tsx -- a throwaway design mockup, not a shipped component:
 * bringing the skills a member's Mac already has into Settings › Skills, as
 * the real card in `packages/panel/src/settings/mac-skills-dialog.tsx` draws it.
 *
 * Look for skills opens a card that reads the Mac's agents' skills folders
 * and breaks down where each skill came from: a group per agent, its folder
 * and how many it found and left out, each skill ticked; then every skill
 * left out, with why; then the agents whose folders hold nothing. Bring in
 * closes the card, lights the skills as they land, and says so on a toast
 * carrying Undo, as every undoable write's toast does. Every name and path is
 * made up.
 */

const STEP = {
  IDLE: "idle",
  READING: "reading",
  CHOOSING: "choosing",
  DONE: "done",
} as const;

type Step = (typeof STEP)[keyof typeof STEP];

/** One skill found on the Mac. */
interface Found {
  readonly folder: string;
  readonly name: string;
  readonly description: string;
  readonly renamedFrom?: string;
}

/** One agent's skills folder, with what it offers. */
interface Group {
  readonly title: string;
  readonly folder: string;
  readonly offered: readonly Found[];
}

const GROUPS: readonly Group[] = [
  {
    title: "Agents folder",
    folder: "~/.agents/skills",
    offered: [
      {
        folder: "~/.agents/skills/storybook-snapshots",
        name: "storybook-snapshots",
        description: "Updates Storybook snapshots and explains each visual change.",
      },
    ],
  },
  {
    title: "Claude Code",
    folder: "~/.claude/skills",
    offered: [
      {
        folder: "~/.claude/skills/flaky-test-hunter",
        name: "flaky-test-hunter",
        description: "Reruns a failing test in isolation to tell a flaky one from a broken one.",
      },
    ],
  },
  {
    title: "Codex",
    folder: "~/.codex/skills",
    offered: [
      {
        folder: "~/.codex/skills/db-migrations",
        name: "db-migrations",
        description:
          "Writes reversible Postgres migrations and checks them against a scratch copy.",
      },
    ],
  },
];

/** Every skill left out, with the folder it came from and why. */
const LEFT_OUT = [
  { name: "pr-review", from: "Claude Code", why: "Already have one" },
  { name: "release-notes", from: "Claude Code", why: "Already have one" },
  { name: "vendor-docs", from: "Codex", why: "Too large" },
] as const;

const OFFERED = GROUPS.flatMap((group) => group.offered);

/** Skills the member already has. */
const INSTALLED = [
  {
    name: "pr-review",
    description: "Reviews a diff for correctness and missing tests before a PR opens.",
    line: "acme/agent-skills @ 3f9c2e1",
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

/** A group of the card's rows under its heading and the line under that. */
function GroupHead({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Stack gap={GAP.ITEM}>
      <Stack gap={GAP.NONE}>
        <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.H3}>
          {title}
        </Text>
        {caption === undefined ? null : (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {caption}
          </Text>
        )}
      </Stack>
      <SettingsSection>{children}</SettingsSection>
    </Stack>
  );
}

/** The card's review: what was found, each agent's group, what was left out, and who held nothing. */
function Review({
  unticked,
  onTick,
}: {
  unticked: ReadonlySet<string>;
  onTick: (folder: string, on: boolean) => void;
}): React.JSX.Element {
  return (
    <Stack gap={GAP.SECTION}>
      <Text>{`Found ${skillCount(OFFERED.length)} to bring in, and left out ${LEFT_OUT.length}.`}</Text>
      {GROUPS.map((group) => (
        <GroupHead key={group.title} title={group.title} caption={group.folder}>
          {group.offered.map((skill) => (
            <SettingsRow
              key={skill.folder}
              leading={
                <SettingsRowMark>
                  <GLYPH.SKILL />
                </SettingsRowMark>
              }
              label={skill.name}
              adornment={
                skill.renamedFrom === undefined ? undefined : (
                  <Badge tone={STATUS_TONE.ATTENTION}>Renamed</Badge>
                )
              }
              controls={SETTINGS_ROW_CONTROLS.BESIDE}
              description={
                <>
                  {skill.description}
                  {skill.renamedFrom === undefined ? null : (
                    <SettingsRowStateLine block state={SETTINGS_ROW_STATE.ATTENTION}>
                      {`You already have a ${skill.renamedFrom}`}
                    </SettingsRowStateLine>
                  )}
                </>
              }
            >
              {() => (
                <Checkbox
                  label={`Bring in ${skill.name}`}
                  checked={!unticked.has(skill.folder)}
                  onChange={(on) => onTick(skill.folder, on)}
                />
              )}
            </SettingsRow>
          ))}
        </GroupHead>
      ))}
      <GroupHead title="Left out">
        {LEFT_OUT.map((row) => (
          <SettingsRow
            key={`${row.from}/${row.name}`}
            label={row.name}
            description={row.from}
            controls={SETTINGS_ROW_CONTROLS.BESIDE}
          >
            {() => <Badge>{row.why}</Badge>}
          </SettingsRow>
        ))}
      </GroupHead>
    </Stack>
  );
}

/** The toast the window says a write with, its Undo running the write's undo. */
interface Notice {
  readonly words: string;
  readonly onUndo: () => void;
}

function NoticeToast({
  toast,
  manager,
}: {
  toast: StandingToast<Notice>;
  manager: ToastStackManager<Notice>;
}): ReactNode {
  const notice = toast.data;

  if (notice === undefined) return null;

  return (
    <Toast
      toast={toast}
      tone={STATUS_TONE.COMPLETE}
      words={notice.words}
      actions={
        <ToastActions
          label="Undo"
          onPress={() => {
            notice.onUndo();
            manager.close(toast.id);
          }}
          dismissLabel="Dismiss"
          onDismiss={() => manager.close(toast.id)}
        />
      }
    />
  );
}

/** The whole flow on Settings › Skills. */
function ImportMockup(): React.JSX.Element {
  const [step, setStep] = useState<Step>(STEP.IDLE);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [manager] = useState(() => createToastManager<Notice>());
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);

  // Reading the Mac takes a moment, then the card lists what it found.
  useEffect(() => {
    if (step !== STEP.READING) return;
    const timer = setTimeout(() => setStep(STEP.CHOOSING), 1200);

    return () => clearTimeout(timer);
  }, [step]);

  const tick = (folder: string, on: boolean) => {
    const next = new Set(unticked);

    if (on) next.delete(folder);
    else next.add(folder);
    setUnticked(next);
  };

  const picked = OFFERED.filter((skill) => !unticked.has(skill.folder));
  const landed = step === STEP.DONE;

  const bringIn = () => {
    setStep(STEP.DONE);
    manager.add({
      title: `Brought in ${skillCount(picked.length)} from your Mac`,
      timeout: 0,
      data: {
        words: `Brought in ${skillCount(picked.length)} from your Mac`,
        onUndo: () => setStep(STEP.IDLE),
      },
    });
  };

  return (
    <div className="catalog-settings-frame catalog-import-frame" ref={setFrame}>
      <SettingsPage title="Skills">
        <Stack gap={GAP.SECTION}>
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
              ? picked.map((skill) => (
                  <SkillRow
                    key={skill.folder}
                    name={skill.name}
                    description={skill.description}
                    line={`From ${skill.folder} on your Mac`}
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
              description="Copy the skills already on your Mac, so every agent can use them."
            >
              {() => (
                <Button
                  variant={BUTTON_VARIANT.OUTLINE}
                  onClick={() => {
                    setUnticked(new Set());
                    setStep(STEP.READING);
                  }}
                >
                  Look for skills
                </Button>
              )}
            </SettingsRow>
          </SettingsSection>
        </Stack>
      </SettingsPage>
      <Dialog
        open={step === STEP.READING || step === STEP.CHOOSING}
        title="Skills on your Mac"
        size={DIALOG_SIZE.WIDE}
        onDismiss={() => setStep(STEP.IDLE)}
        actions={
          <DialogActions
            onCancel={() => setStep(STEP.IDLE)}
            act={{
              verb: picked.length === 0 ? "Bring in" : `Bring in ${skillCount(picked.length)}`,
              tone: DIALOG_TONE.PRIMARY,
              running: "Bringing in",
              disabled: step !== STEP.CHOOSING || picked.length === 0,
              onPress: bringIn,
            }}
          />
        }
      >
        {step === STEP.READING ? (
          <SpinnerRegion label="Reading your agents' skills folders" />
        ) : (
          <Review unticked={unticked} onTick={tick} />
        )}
      </Dialog>
      {frame === null ? null : (
        <ToastStack manager={manager} label="Notifications" container={frame}>
          {(toast) => <NoticeToast key={toast.id} toast={toast} manager={manager} />}
        </ToastStack>
      )}
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
