import { MODEL_PROVIDER } from "@repo/features/models-wire";
import {
  BUTTON_VARIANT,
  Button,
  Checkbox,
  createToastManager,
  DIALOG_SIZE,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  FolderIcon,
  GAP,
  GlyphSlot,
  HarnessMark,
  Inline,
  PlusIcon,
  SETTINGS_ROW_CONTROLS,
  SettingsPage,
  SettingsRow,
  SettingsRowMark,
  SettingsRowStateLine,
  SettingsRowsFold,
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
import codexOneX from "../../../../packages/panel/marks/codex-16.png";
import codexTwoX from "../../../../packages/panel/marks/codex-32.png";
import codexThreeX from "../../../../packages/panel/marks/codex-48.png";
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
}

const AGENT = { AGENTS: "agents", CLAUDE: "claude", CODEX: "codex" } as const;

type Agent = (typeof AGENT)[keyof typeof AGENT];

/** One folder's skills. */
interface Group {
  readonly agent: Agent;
  readonly title: string;
  readonly folder: string;
  readonly offered: readonly Found[];
}

/** Skills in a folder, made up, by name and what each does. */
function skillsIn(
  folder: string,
  skills: readonly (readonly [string, string])[],
): readonly Found[] {
  return skills.map(([name, description]) => ({ folder: `${folder}/${name}`, name, description }));
}

const GROUPS: readonly Group[] = [
  {
    agent: AGENT.AGENTS,
    title: "Agents folder",
    folder: "~/.agents/skills",
    offered: skillsIn("~/.agents/skills", [
      ["storybook-snapshots", "Updates Storybook snapshots and explains each visual change."],
      ["frontend-design", "Builds polished, accessible interfaces from a sketch or a spec."],
      ["changelog-writer", "Writes a changelog entry for each merged pull request."],
      ["api-contract-check", "Compares an OpenAPI spec against the handlers that serve it."],
      ["dependency-bump", "Upgrades one dependency at a time and runs the tests between."],
      ["sql-explain", "Reads a slow query's plan and suggests the index it needs."],
    ]),
  },
  {
    agent: AGENT.CLAUDE,
    title: "Claude Code",
    folder: "~/.claude/skills",
    offered: skillsIn("~/.claude/skills", [
      [
        "flaky-test-hunter",
        "Reruns a failing test in isolation to tell a flaky one from a broken one.",
      ],
      ["incident-notes", "Turns an incident channel into a timeline and a list of follow-ups."],
      ["pr-description", "Drafts a pull request's description from its commits and diff."],
      ["release-checklist", "Walks through the release steps and stops at the first that fails."],
      ["security-review", "Looks for injection, auth, and secrets mistakes in a diff."],
      ["test-gap-finder", "Lists the changed lines no test touches."],
      ["translation-sync", "Finds strings missing from each locale and drafts them."],
      ["type-tightener", "Replaces any and loose casts with the types the code already proves."],
    ]),
  },
  {
    agent: AGENT.CODEX,
    title: "Codex",
    folder: "~/.codex/skills",
    offered: skillsIn("~/.codex/skills", [
      [
        "db-migrations",
        "Writes reversible Postgres migrations and checks them against a scratch copy.",
      ],
      ["log-triage", "Groups a log's errors by cause and ranks them by how often they happen."],
      ["perf-profile", "Profiles a slow endpoint and points at the hottest frames."],
      ["readme-refresh", "Brings a README's setup steps back in line with the scripts."],
      ["shell-hardening", "Adds set -euo pipefail and quoting to a shell script."],
    ]),
  },
];

/** Every skill left out, with the folder it came from and why. */
const LEFT_OUT = [
  { name: "pr-review", agent: AGENT.CLAUDE, why: "You already have a skill with this name" },
  { name: "release-notes", agent: AGENT.CLAUDE, why: "You already have a skill with this name" },
  { name: "code-style", agent: AGENT.AGENTS, why: "You already have a skill with this name" },
  {
    name: "changelog-writer",
    agent: AGENT.CLAUDE,
    why: "Same name as a skill above, which is the one offered",
  },
  {
    name: "flaky-test-hunter",
    agent: AGENT.CODEX,
    why: "Same name as a skill above, which is the one offered",
  },
  { name: "vendor-docs", agent: AGENT.CODEX, why: "Larger than 3 MB or 100 files" },
  { name: "scratch", agent: AGENT.CLAUDE, why: "Its SKILL.md has no valid name or description" },
  { name: "deploy-keys", agent: AGENT.AGENTS, why: "Holds something that looks like a credential" },
] as const;

/** The Codex mark's art, as the desktop's build copies it. */
const CODEX_ART = { oneX: codexOneX, twoX: codexTwoX, threeX: codexThreeX };

/** The mark of the agent whose skills folder a skill was found in, the folder agents share drawn as a folder. */
function AgentMark({ agent }: { agent: Agent }): React.JSX.Element {
  switch (agent) {
    case AGENT.AGENTS:
      return <FolderIcon />;
    case AGENT.CLAUDE:
      return <HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} />;
    case AGENT.CODEX:
      return <HarnessMark provider={MODEL_PROVIDER.OPENAI} codexArt={CODEX_ART} />;
  }
}

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

/** A group of the card's rows under its heading, led by its agent's mark, and the folder under that. */
function GroupHead({
  agent,
  title,
  caption,
  children,
}: {
  agent: Agent;
  title: string;
  caption: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Stack gap={GAP.ITEM}>
      <Stack gap={GAP.NONE}>
        <Inline gap={GAP.ICON}>
          <GlyphSlot>
            <AgentMark agent={agent} />
          </GlyphSlot>
          <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.H3}>
            {title}
          </Text>
        </Inline>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {caption}
        </Text>
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
        <GroupHead key={group.title} agent={group.agent} title={group.title} caption={group.folder}>
          {group.offered.map((skill) => (
            <SettingsRow
              key={skill.folder}
              leading={
                <SettingsRowMark>
                  <GLYPH.SKILL />
                </SettingsRowMark>
              }
              label={skill.name}
              controls={SETTINGS_ROW_CONTROLS.BESIDE}
              description={skill.description}
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
      <SettingsSection>
        <SettingsRowsFold
          label="Skills left out"
          head={(chevron) => (
            <SettingsRow
              label="Left out"
              description={`${skillCount(LEFT_OUT.length)} not brought in`}
              end={() => chevron}
            />
          )}
          rows={LEFT_OUT.map((row) => (
            <SettingsRow
              key={`${row.agent}/${row.name}`}
              leading={
                <SettingsRowMark>
                  <AgentMark agent={row.agent} />
                </SettingsRowMark>
              }
              label={row.name}
              description={row.why}
            />
          ))}
        />
      </SettingsSection>
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
