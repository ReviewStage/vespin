import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  BANNER_LOOK,
  Badge,
  Banner,
  BUTTON_VARIANT,
  Button,
  CHOICE_BAR_LOOK,
  Checkbox,
  ChoiceBar,
  DIALOG_SIZE,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  Fact,
  Facts,
  GAP,
  Inline,
  MARK_PROVIDER,
  type MarkProvider,
  PlusIcon,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  SETTINGS_ROW_ALIGN,
  SETTINGS_ROW_CONTROLS,
  SETTINGS_ROW_STATE,
  SecretField,
  SettingsLine,
  SettingsPage,
  SettingsRow,
  SettingsRowMark,
  SettingsRowStateLine,
  SettingsSection,
  SpinnerRegion,
  STATUS_TONE,
  Stack,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { type ReactNode, useEffect, useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * import-from-mac.tsx -- a throwaway design mockup, not a shipped component:
 * bringing the skills and MCP servers a member's Mac already has into the app.
 *
 * It is clickable end to end: Settings › Skills (or a Mac just added on
 * Machines) offers Bring in from a Mac; a consent card says which files the
 * host reads; the scan reads them source by source; the review lists what it
 * found grouped by where it came from, skills checked, servers never; a
 * clash with an installed skill asks Skip, Keep both, or Replace; a server's
 * env and headers stand masked and go to the vault; Bring over lands the rows
 * with a banner carrying Undo, which asks first and takes them all back.
 * Every name, path, and value here is made up.
 */

const MAC = "Ada's MacBook Pro";
const WORKSPACE = "Acme";

/** Which Settings page the mockup draws. */
const PAGE = {
  SKILLS: "skills",
  INTEGRATIONS: "integrations",
  MACHINES: "machines",
} as const;

type Page = (typeof PAGE)[keyof typeof PAGE];

/** Where the import stands. */
const PHASE = {
  IDLE: "idle",
  CONSENT: "consent",
  SCANNING: "scanning",
  REVIEW: "review",
  BRINGING: "bringing",
  DONE: "done",
  UNDO_ASK: "undo-ask",
  UNDONE: "undone",
} as const;

type Phase = (typeof PHASE)[keyof typeof PHASE];

/** A jump straight to one state, for a reviewer who wants one screen. */
const JUMP = {
  START: "start",
  CONSENT: "consent",
  SCANNING: "scanning",
  REVIEW: "review",
  SECRET: "secret",
  DONE: "done",
  UNDO: "undo",
} as const;

type Jump = (typeof JUMP)[keyof typeof JUMP];

const JUMPS = [
  { value: JUMP.START, label: "Start" },
  { value: JUMP.CONSENT, label: "Consent" },
  { value: JUMP.SCANNING, label: "Scanning" },
  { value: JUMP.REVIEW, label: "Review + clash" },
  { value: JUMP.SECRET, label: "Secret" },
  { value: JUMP.DONE, label: "Done" },
  { value: JUMP.UNDO, label: "Undo" },
] as const;

const ITEM_KIND = { SKILL: "skill", SERVER: "server" } as const;

type ItemKind = (typeof ITEM_KIND)[keyof typeof ITEM_KIND];

/** How a found item stands against what the account already holds. */
const STANDING = {
  NEW: "new",
  SAME: "same",
  CLASH: "clash",
  ALSO_IN: "also-in",
} as const;

type Standing = (typeof STANDING)[keyof typeof STANDING];

/** Where an imported item can run. */
const REACH = { EVERYWHERE: "everywhere", MAC_ONLY: "mac-only" } as const;

type Reach = (typeof REACH)[keyof typeof REACH];

/** What a clash does with the installed skill of the same name. */
const CLASH = { SKIP: "skip", KEEP_BOTH: "keep-both", REPLACE: "replace" } as const;

type Clash = (typeof CLASH)[keyof typeof CLASH];

const CLASH_ITEMS = [
  { value: CLASH.SKIP, label: "Skip" },
  { value: CLASH.KEEP_BOTH, label: "Keep both" },
  { value: CLASH.REPLACE, label: "Replace" },
] as const;

const SCOPE = { PERSONAL: "personal", WORKSPACE: "workspace" } as const;

type Scope = (typeof SCOPE)[keyof typeof SCOPE];

const SCOPE_ITEMS = [
  { value: SCOPE.PERSONAL, label: "Just me" },
  { value: SCOPE.WORKSPACE, label: WORKSPACE },
] as const;

/** One place on the Mac the scan reads. */
interface Source {
  readonly id: string;
  readonly name: string;
  readonly mark: MarkProvider | undefined;
  readonly paths: readonly string[];
}

const SOURCES: readonly Source[] = [
  {
    id: "claude",
    name: "Claude Code",
    mark: MARK_PROVIDER.CLAUDE,
    paths: ["~/.claude/skills", "~/.claude.json"],
  },
  {
    id: "cursor",
    name: "Cursor",
    mark: MARK_PROVIDER.CURSOR,
    paths: ["~/.cursor/skills", "~/.cursor/mcp.json"],
  },
  {
    id: "codex",
    name: "Codex",
    mark: undefined,
    paths: ["~/.agents/skills", "~/.codex/config.toml"],
  },
];

/** The other places read, which turned up nothing to bring. */
const EMPTY_PLACES = ["~/.gemini", "Claude Desktop", "~/.factory"] as const;

/** A value an MCP server is handed that is a secret: an env value or a header. */
interface Secret {
  readonly name: string;
  readonly where: string;
}

/** One skill or MCP server the scan found. */
interface Found {
  readonly id: string;
  readonly kind: ItemKind;
  readonly source: string;
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly standing: Standing;
  readonly reach: Reach;
  /** Why it can run on the Mac alone. */
  readonly macOnlyWhy?: string;
  readonly mark?: MarkProvider;
  readonly secrets?: readonly Secret[];
  readonly signIn?: boolean;
  /** For a server also found elsewhere, which source it is drawn under. */
  readonly alsoIn?: string;
}

const FOUND: readonly Found[] = [
  {
    id: "pr-review",
    kind: ITEM_KIND.SKILL,
    source: "claude",
    name: "pr-review",
    description: "Reviews a diff for correctness and missing tests before a PR opens.",
    path: "~/.claude/skills/pr-review",
    standing: STANDING.SAME,
    reach: REACH.EVERYWHERE,
  },
  {
    id: "release-notes",
    kind: ITEM_KIND.SKILL,
    source: "claude",
    name: "release-notes",
    description: "Drafts release notes from the pull requests merged since the last tag.",
    path: "~/.claude/skills/release-notes",
    standing: STANDING.CLASH,
    reach: REACH.EVERYWHERE,
  },
  {
    id: "flaky-test-hunter",
    kind: ITEM_KIND.SKILL,
    source: "claude",
    name: "flaky-test-hunter",
    description: "Reruns a failing test in isolation to tell a flaky one from a broken one.",
    path: "~/.claude/skills/flaky-test-hunter",
    standing: STANDING.NEW,
    reach: REACH.EVERYWHERE,
  },
  {
    id: "db-migrations",
    kind: ITEM_KIND.SKILL,
    source: "claude",
    name: "db-migrations",
    description: "Writes reversible Postgres migrations and checks them against a scratch copy.",
    path: "~/.claude/skills/db-migrations",
    standing: STANDING.NEW,
    reach: REACH.EVERYWHERE,
  },
  {
    id: "linear",
    kind: ITEM_KIND.SERVER,
    source: "claude",
    name: "linear",
    description: "HTTP · mcp.linear.app/mcp",
    path: "~/.claude.json",
    standing: STANDING.NEW,
    reach: REACH.EVERYWHERE,
    mark: MARK_PROVIDER.LINEAR,
    signIn: true,
  },
  {
    id: "postgres-dev",
    kind: ITEM_KIND.SERVER,
    source: "claude",
    name: "postgres-dev",
    description: "stdio · npx -y @modelcontextprotocol/server-postgres",
    path: "~/.claude.json",
    standing: STANDING.NEW,
    reach: REACH.MAC_ONLY,
    macOnlyWhy: "Its DATABASE_URL points at localhost, which a cloud sandbox can't reach.",
    secrets: [{ name: "DATABASE_URL", where: "env" }],
  },
  {
    id: "sentry",
    kind: ITEM_KIND.SERVER,
    source: "cursor",
    name: "sentry",
    description: "HTTP · mcp.sentry.dev/mcp",
    path: "~/.cursor/mcp.json",
    standing: STANDING.NEW,
    reach: REACH.EVERYWHERE,
    mark: MARK_PROVIDER.SENTRY,
    secrets: [{ name: "Authorization", where: "header" }],
  },
  {
    id: "figma-bridge",
    kind: ITEM_KIND.SERVER,
    source: "cursor",
    name: "figma-bridge",
    description: "stdio · /Users/ada/tools/figma-bridge/run.sh",
    path: "~/.cursor/mcp.json",
    standing: STANDING.NEW,
    reach: REACH.MAC_ONLY,
    macOnlyWhy: "It runs a script in your home folder, which a cloud sandbox doesn't have.",
  },
  {
    id: "storybook-snapshots",
    kind: ITEM_KIND.SKILL,
    source: "codex",
    name: "storybook-snapshots",
    description: "Updates Storybook snapshots and explains each visual change.",
    path: "~/.agents/skills/storybook-snapshots",
    standing: STANDING.NEW,
    reach: REACH.EVERYWHERE,
  },
  {
    id: "linear-codex",
    kind: ITEM_KIND.SERVER,
    source: "codex",
    name: "linear",
    description: "HTTP · mcp.linear.app/mcp",
    path: "~/.codex/config.toml",
    standing: STANDING.ALSO_IN,
    reach: REACH.EVERYWHERE,
    mark: MARK_PROVIDER.LINEAR,
    alsoIn: "Claude Code",
  },
];

/** Skills the member already has, as Settings › Skills lists them before the import. */
const INSTALLED = [
  {
    name: "pr-review",
    description: "Reviews a diff for correctness and missing tests before a PR opens.",
    line: "From acme/agent-skills · installed by you",
  },
  {
    name: "release-notes",
    description: "Writes release notes in the changelog's voice.",
    line: "Pasted · installed by you",
  },
] as const;

/** What the scan picks before the member touches anything: every new skill, and never a server. */
function firstPicks(): ReadonlySet<string> {
  return new Set(
    FOUND.flatMap((item) =>
      item.kind === ITEM_KIND.SKILL && item.standing === STANDING.NEW ? [item.id] : [],
    ),
  );
}

/** The glyph a found item leads with: its service's mark where it has one. */
function leadOf(item: Found): ReactNode {
  return (
    <SettingsRowMark>
      {item.mark === undefined ? (
        item.kind === ITEM_KIND.SKILL ? (
          <GLYPH.SKILL />
        ) : (
          <GLYPH.MCP_SERVER />
        )
      ) : (
        <ProviderMark provider={item.mark} />
      )}
    </SettingsRowMark>
  );
}

/** The badge saying where an item will run. */
function ReachBadge({ reach }: { reach: Reach }): React.JSX.Element {
  return reach === REACH.MAC_ONLY ? (
    <Badge tone={STATUS_TONE.ATTENTION} icon={<GLYPH.HOST />}>
      Mac only
    </Badge>
  ) : (
    <Badge icon={<GLYPH.CLOUD_AND_LOCAL />}>Mac and cloud</Badge>
  );
}

/** The mark a source's heading leads with. */
function SourceMark({ source }: { source: Source }): React.JSX.Element {
  return source.mark === undefined ? (
    <GLYPH.TERMINAL />
  ) : (
    <ProviderMark provider={source.mark} size={PROVIDER_MARK_SIZE.ICON} />
  );
}

/** One env value or header of a picked server: masked, kept, or replaced with one typed here. */
function SecretFact({ secret }: { secret: Secret }): React.JSX.Element {
  const [replacing, setReplacing] = useState(false);
  const [typed, setTyped] = useState("");

  return replacing ? (
    <SecretField
      label={secret.name}
      description="What you type here is kept in your vault in place of the Mac's value."
      value={typed}
      onChange={setTyped}
      placeholder="postgres://…"
      autoFocus
      onEscape={() => setReplacing(false)}
    />
  ) : (
    <Fact
      icon={<GLYPH.SECRET />}
      label={
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} font={TEXT_FONT.MONO}>
          {secret.name} ({secret.where})
        </Text>
      }
    >
      <Inline gap={GAP.CONTROL}>
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} font={TEXT_FONT.MONO}>
          ••••••••••••
        </Text>
        <Button variant={BUTTON_VARIANT.QUIET} onClick={() => setReplacing(true)}>
          Replace
        </Button>
      </Inline>
    </Fact>
  );
}

/** One found item's row in the review: its words, where it runs, and its pick. */
function FoundRow({
  item,
  picked,
  clash,
  onPick,
  onClash,
}: {
  item: Found;
  picked: boolean;
  clash: Clash;
  onPick: (picked: boolean) => void;
  onClash: (clash: Clash) => void;
}): React.JSX.Element {
  const state =
    item.standing === STANDING.SAME ? (
      <SettingsRowStateLine block state={SETTINGS_ROW_STATE.PLAIN}>
        Already installed with the same files · skipped
      </SettingsRowStateLine>
    ) : item.standing === STANDING.ALSO_IN ? (
      <SettingsRowStateLine block>
        The same server as {item.name} in {item.alsoIn} · brought once
      </SettingsRowStateLine>
    ) : item.standing === STANDING.CLASH ? (
      <SettingsRowStateLine block state={SETTINGS_ROW_STATE.ATTENTION}>
        {clash === CLASH.KEEP_BOTH
          ? "You have a different release-notes · this one comes in as release-notes-mac"
          : clash === CLASH.REPLACE
            ? "You have a different release-notes · this one replaces it"
            : "You have a different release-notes · yours stays"}
      </SettingsRowStateLine>
    ) : item.reach === REACH.MAC_ONLY ? (
      <SettingsRowStateLine block state={SETTINGS_ROW_STATE.ATTENTION}>
        {item.macOnlyWhy}
      </SettingsRowStateLine>
    ) : item.signIn === true ? (
      <SettingsRowStateLine block>
        Signs in with OAuth · you sign in once it's brought over
      </SettingsRowStateLine>
    ) : (
      <SettingsRowStateLine block>{item.path}</SettingsRowStateLine>
    );

  const control =
    item.standing === STANDING.CLASH ? (
      <ChoiceBar<Clash>
        label={`What to do with ${item.name}`}
        items={CLASH_ITEMS}
        value={clash}
        look={CHOICE_BAR_LOOK.SEGMENTED}
        onChange={onClash}
      />
    ) : (
      <Checkbox
        label={`Bring over ${item.name}`}
        checked={picked}
        disabled={item.standing === STANDING.SAME || item.standing === STANDING.ALSO_IN}
        onChange={onPick}
      />
    );

  const secrets = item.secrets ?? [];

  return (
    <div id={`import-row-${item.id}`}>
      <SettingsRow
        leading={leadOf(item)}
        label={item.name}
        adornment={item.kind === ITEM_KIND.SERVER ? <ReachBadge reach={item.reach} /> : undefined}
        description={
          <>
            {item.description}
            {state}
          </>
        }
        controls={
          item.standing === STANDING.CLASH
            ? SETTINGS_ROW_CONTROLS.DROP
            : SETTINGS_ROW_CONTROLS.BESIDE_UNTIL_NARROW
        }
        align={SETTINGS_ROW_ALIGN.FIRST_LINE}
        below={
          picked && secrets.length > 0
            ? () => (
                <Stack gap={GAP.ITEM}>
                  <Facts>
                    {secrets.map((secret) => (
                      <SecretFact key={secret.name} secret={secret} />
                    ))}
                  </Facts>
                  <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                    Read from your Mac only when you bring it over, then kept in your vault. It
                    never shows again, here or in a transcript.
                  </Text>
                </Stack>
              )
            : undefined
        }
      >
        {() => control}
      </SettingsRow>
    </div>
  );
}

/** The consent card's body: what the host reads, and what it leaves. */
function ConsentBody(): React.JSX.Element {
  return (
    <Stack gap={GAP.FIELD}>
      <Text>
        {PRODUCT_NAME}'s host on {MAC} reads these places and shows you what it finds. Nothing is
        copied until you choose Bring over.
      </Text>
      <Facts ruled>
        {SOURCES.map((source) => (
          <Fact key={source.id} icon={<SourceMark source={source} />} label={source.name}>
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} font={TEXT_FONT.MONO}>
              {source.paths.join("  ")}
            </Text>
          </Fact>
        ))}
        <Fact icon={<GLYPH.FOLDER />} label="Also">
          {EMPTY_PLACES.join(", ")}
        </Fact>
      </Facts>
      <Text variant={TEXT_VARIANT.CAPTION}>
        Secret values in env and headers stay on your Mac while you review; only their names come
        across. Sign-ins, permission settings, hooks, and plugins' commands and subagents are never
        read.
      </Text>
    </Stack>
  );
}

/** The scan's body: each place as it is read. */
function ScanningBody({ read }: { read: number }): React.JSX.Element {
  return (
    <Stack gap={GAP.FIELD}>
      <Facts ruled>
        {SOURCES.map((source, at) => (
          <Fact key={source.id} icon={<SourceMark source={source} />} label={source.name}>
            {at < read ? (
              <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
                {FOUND.filter((item) => item.source === source.id).length} found
              </SettingsRowStateLine>
            ) : at === read ? (
              <SpinnerRegion label={`Reading ${source.paths.join(" and ")}`} />
            ) : (
              <SettingsRowStateLine>Waiting</SettingsRowStateLine>
            )}
          </Fact>
        ))}
      </Facts>
    </Stack>
  );
}

/** The review's body: what was found, grouped by where it came from. */
function ReviewBody({
  picks,
  clash,
  scope,
  onPick,
  onClash,
}: {
  picks: ReadonlySet<string>;
  clash: Clash;
  scope: Scope;
  onPick: (id: string, picked: boolean) => void;
  onClash: (clash: Clash) => void;
}): React.JSX.Element {
  const sharedSecrets =
    scope === SCOPE.WORKSPACE &&
    FOUND.some((item) => picks.has(item.id) && (item.secrets?.length ?? 0) > 0);

  return (
    <Stack gap={GAP.SECTION}>
      <Text>
        Found {countWords(foundCount())} you could bring in. Skills you don't have yet are picked;
        pick each server yourself.
      </Text>
      {sharedSecrets ? (
        <Banner look={BANNER_LOOK.CARD} tone={STATUS_TONE.ATTENTION} glyph={<GLYPH.SECRET />}>
          Servers brought in for {WORKSPACE} reach every member's agents, but their secret values
          stay yours: each teammate adds their own before the server runs for them.
        </Banner>
      ) : null}
      {SOURCES.map((source) => (
        <SettingsSection
          key={source.id}
          title={
            <Inline gap={GAP.CONTROL}>
              <SourceMark source={source} />
              {source.name}
            </Inline>
          }
          caption={source.paths.join(" · ")}
        >
          {FOUND.flatMap((item) =>
            item.source !== source.id
              ? []
              : [
                  <FoundRow
                    key={item.id}
                    item={item}
                    picked={picks.has(item.id)}
                    clash={clash}
                    onPick={(picked) => onPick(item.id, picked)}
                    onClash={onClash}
                  />,
                ],
          )}
        </SettingsSection>
      ))}
      <SettingsSection title="Left on your Mac">
        <SettingsLine>
          Nothing in {EMPTY_PLACES.join(", ")}. A Claude plugin's hooks, commands, and subagents
          stay behind, as do 6 skills other apps installed themselves.
        </SettingsLine>
        <SettingsLine>
          Skills and .mcp.json inside a repository already reach agents working in it, so they stay
          where they are.
        </SettingsLine>
      </SettingsSection>
    </Stack>
  );
}

/** How many of each kind an import brings. */
interface Counted {
  readonly skills: number;
  readonly servers: number;
}

/** Everything the scan found that is new or clashes, counted. */
function foundCount(): Counted {
  const offered = FOUND.filter(
    (item) => item.standing === STANDING.NEW || item.standing === STANDING.CLASH,
  );

  return {
    skills: offered.filter((item) => item.kind === ITEM_KIND.SKILL).length,
    servers: offered.filter((item) => item.kind === ITEM_KIND.SERVER).length,
  };
}

/** What a pick set brings over, counted. */
function counted(picks: ReadonlySet<string>, clash: Clash): Counted {
  const brought = FOUND.filter(
    (item) => picks.has(item.id) || (item.standing === STANDING.CLASH && clash !== CLASH.SKIP),
  );

  return {
    skills: brought.filter((item) => item.kind === ITEM_KIND.SKILL).length,
    servers: brought.filter((item) => item.kind === ITEM_KIND.SERVER).length,
  };
}

/** "3 skills and 2 MCP servers", leaving out a kind that has none. */
function countWords({ skills, servers }: Counted): string {
  const parts = [
    skills === 0 ? undefined : `${skills} skill${skills === 1 ? "" : "s"}`,
    servers === 0 ? undefined : `${servers} MCP server${servers === 1 ? "" : "s"}`,
  ].filter((part) => part !== undefined);

  return parts.length === 0 ? "nothing" : parts.join(" and ");
}

/** The import's one card: consent, then the scan, then the review. */
function ImportDialog({
  phase,
  read,
  picks,
  clash,
  scope,
  onPick,
  onClash,
  onScope,
  onLook,
  onBring,
  onClose,
}: {
  phase: Phase;
  read: number;
  picks: ReadonlySet<string>;
  clash: Clash;
  scope: Scope;
  onPick: (id: string, picked: boolean) => void;
  onClash: (clash: Clash) => void;
  onScope: (scope: Scope) => void;
  onLook: () => void;
  onBring: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const open =
    phase === PHASE.CONSENT ||
    phase === PHASE.SCANNING ||
    phase === PHASE.REVIEW ||
    phase === PHASE.BRINGING;

  const reviewing = phase === PHASE.REVIEW || phase === PHASE.BRINGING;
  const count = counted(picks, clash);
  const total = count.skills + count.servers;

  return (
    <Dialog
      open={open}
      title={phase === PHASE.CONSENT ? `Look on ${MAC}?` : `Bring in from ${MAC}`}
      size={DIALOG_SIZE.WIDE}
      busy={phase === PHASE.BRINGING}
      onDismiss={onClose}
      actionsStart={
        reviewing ? (
          <ChoiceBar<Scope>
            label="Bring in for"
            items={SCOPE_ITEMS}
            value={scope}
            look={CHOICE_BAR_LOOK.SEGMENTED}
            onChange={onScope}
          />
        ) : undefined
      }
      actions={
        phase === PHASE.CONSENT ? (
          <DialogActions
            onCancel={onClose}
            act={{ verb: "Look", tone: DIALOG_TONE.PRIMARY, running: "Looking", onPress: onLook }}
          />
        ) : (
          <DialogActions
            onCancel={onClose}
            act={{
              verb: total === 0 ? "Bring over" : `Bring over ${total}`,
              tone: DIALOG_TONE.PRIMARY,
              running: "Bringing over",
              busy: phase === PHASE.BRINGING,
              disabled: !reviewing || total === 0,
              onPress: onBring,
            }}
          />
        )
      }
    >
      {phase === PHASE.CONSENT ? (
        <ConsentBody />
      ) : phase === PHASE.SCANNING ? (
        <ScanningBody read={read} />
      ) : (
        <ReviewBody picks={picks} clash={clash} scope={scope} onPick={onPick} onClash={onClash} />
      )}
    </Dialog>
  );
}

/** The undo's question. */
function UndoDialog({
  open,
  brought,
  onCancel,
  onUndo,
}: {
  open: boolean;
  brought: string;
  onCancel: () => void;
  onUndo: () => void;
}): React.JSX.Element {
  return (
    <Dialog
      open={open}
      title={`Undo the import from ${MAC}?`}
      onDismiss={onCancel}
      actions={
        <DialogActions
          onCancel={onCancel}
          act={{
            verb: "Undo import",
            tone: DIALOG_TONE.DANGER,
            running: "Undoing",
            onPress: onUndo,
          }}
        />
      }
    >
      <Text>
        Removes the {brought} it brought in and deletes their values from your vault. A skill you
        edited since stays, as yours, and release-notes goes back to the one you had.
      </Text>
    </Dialog>
  );
}

/** A skill row as Settings › Skills draws one. */
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

/** The import's banner at the top of the page it lands on: its result and Undo, or that it was undone. */
function ResultBanner({
  phase,
  brought,
  onUndo,
}: {
  phase: Phase;
  brought: string;
  onUndo: () => void;
}): React.JSX.Element | null {
  if (phase === PHASE.UNDONE) {
    return (
      <Banner look={BANNER_LOOK.CARD} glyph={<GLYPH.HISTORY />}>
        Import undone. Nothing from {MAC} is left.
      </Banner>
    );
  }

  if (phase !== PHASE.DONE && phase !== PHASE.UNDO_ASK) return null;

  return (
    <Banner
      look={BANNER_LOOK.CARD}
      tone={STATUS_TONE.COMPLETE}
      glyph={<GLYPH.DONE />}
      actions={
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={onUndo}>
          Undo
        </Button>
      }
    >
      Brought in {brought} from {MAC} today. Undo stays here until you dismiss it, across restarts.
    </Banner>
  );
}

/** Whether the import's rows stand on the pages. */
function landedPhase(phase: Phase): boolean {
  return phase === PHASE.DONE || phase === PHASE.UNDO_ASK;
}

/** Settings › Skills, with Bring in from a Mac at its head and the import's skills once they land. */
function SkillsPage({
  phase,
  picks,
  clash,
  brought,
  onStart,
  onUndo,
}: {
  phase: Phase;
  picks: ReadonlySet<string>;
  clash: Clash;
  brought: string;
  onStart: () => void;
  onUndo: () => void;
}): React.JSX.Element {
  const landed = landedPhase(phase);

  const imported = FOUND.filter(
    (item) =>
      item.kind === ITEM_KIND.SKILL &&
      (picks.has(item.id) || (item.standing === STANDING.CLASH && clash === CLASH.KEEP_BOTH)),
  );

  return (
    <Stack gap={GAP.SECTION}>
      <ResultBanner phase={phase} brought={brought} onUndo={onUndo} />
      <SettingsSection title={WORKSPACE} action={<AddSkill />}>
        <SettingsLine>No skills installed for {WORKSPACE} yet.</SettingsLine>
      </SettingsSection>
      <SettingsSection title="Personal" action={<AddSkill />}>
        {INSTALLED.flatMap((skill) =>
          landed && clash === CLASH.REPLACE && skill.name === "release-notes"
            ? []
            : [<SkillRow key={skill.name} {...skill} />],
        )}
        {landed
          ? imported.map((item) => (
              <SkillRow
                key={item.id}
                name={item.standing === STANDING.CLASH ? `${item.name}-mac` : item.name}
                description={item.description}
                line={`From ${MAC} · ${item.path}`}
                landed
              />
            ))
          : null}
      </SettingsSection>
      <SettingsSection title="From your Mac">
        <SettingsRow
          leading={
            <SettingsRowMark>
              <GLYPH.DESKTOP />
            </SettingsRowMark>
          }
          label="Bring in from a Mac"
          description="Copy the skills and MCP servers that Claude Code, Cursor, and Codex already use on your Mac."
        >
          {() => (
            <Button variant={BUTTON_VARIANT.OUTLINE} onClick={onStart}>
              Look on {MAC}
            </Button>
          )}
        </SettingsRow>
      </SettingsSection>
    </Stack>
  );
}

/** Add skill, as each group's heading holds it today. */
function AddSkill(): React.JSX.Element {
  return (
    <Button variant={BUTTON_VARIANT.OUTLINE} icon={<PlusIcon />}>
      Add skill
    </Button>
  );
}

/** Settings › Integrations, with a new group for the MCP servers a member brought in. */
function IntegrationsPage({
  phase,
  picks,
  brought,
  onUndo,
}: {
  phase: Phase;
  picks: ReadonlySet<string>;
  brought: string;
  onUndo: () => void;
}): React.JSX.Element {
  const servers = landedPhase(phase)
    ? FOUND.filter((item) => item.kind === ITEM_KIND.SERVER && picks.has(item.id))
    : [];

  return (
    <Stack gap={GAP.SECTION}>
      <ResultBanner phase={phase} brought={brought} onUndo={onUndo} />
      <SettingsSection title="Connected">
        <SettingsRow
          leading={
            <SettingsRowMark>
              <ProviderMark provider={MARK_PROVIDER.GITHUB} />
            </SettingsRowMark>
          }
          label="GitHub"
          description={
            <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
              Connected
            </SettingsRowStateLine>
          }
        />
      </SettingsSection>
      <SettingsSection
        title="Your MCP servers"
        caption="Servers you added yourself, for your agents alone."
      >
        {servers.length === 0 ? (
          <SettingsLine>None yet. Bring them in from a Mac on Settings › Skills.</SettingsLine>
        ) : (
          servers.map((item) => (
            <SettingsRow
              key={item.id}
              leading={leadOf(item)}
              label={item.name}
              landed
              adornment={<ReachBadge reach={item.reach} />}
              description={
                <>
                  {item.description}
                  {item.signIn === true ? (
                    <SettingsRowStateLine block state={SETTINGS_ROW_STATE.ATTENTION}>
                      Sign in to finish · agents skip it until then
                    </SettingsRowStateLine>
                  ) : (
                    <SettingsRowStateLine block state={SETTINGS_ROW_STATE.CONNECTED}>
                      {item.secrets === undefined
                        ? `From ${MAC}`
                        : `From ${MAC} · ${item.secrets.map((each) => each.name).join(", ")} in your vault`}
                    </SettingsRowStateLine>
                  )}
                </>
              }
            >
              {() =>
                item.signIn === true ? (
                  <Button variant={BUTTON_VARIANT.PRIMARY}>Sign in</Button>
                ) : null
              }
            </SettingsRow>
          ))
        )}
      </SettingsSection>
    </Stack>
  );
}

/** Settings › Machines, just after the Mac joined, offering the import. */
function MachinesPage({
  phase,
  onStart,
}: {
  phase: Phase;
  onStart: () => void;
}): React.JSX.Element {
  return (
    <Stack gap={GAP.SECTION}>
      {phase === PHASE.IDLE ? (
        <Banner
          look={BANNER_LOOK.CARD}
          glyph={<GLYPH.SKILL />}
          actions={
            <>
              <Button variant={BUTTON_VARIANT.QUIET}>Not now</Button>
              <Button variant={BUTTON_VARIANT.PRIMARY} onClick={onStart}>
                Review
              </Button>
            </>
          }
        >
          {MAC} joined. Bring in the skills and MCP servers its coding agents already use?
        </Banner>
      ) : null}
      <SettingsSection title="Machines">
        <SettingsRow
          leading={
            <SettingsRowMark>
              <GLYPH.DESKTOP />
            </SettingsRowMark>
          }
          label={MAC}
          landed={phase === PHASE.IDLE}
          description={
            <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
              Online · macOS 27 · Claude Code, Codex, Cursor
            </SettingsRowStateLine>
          }
        />
      </SettingsSection>
    </Stack>
  );
}

const PAGES = [
  { value: PAGE.MACHINES, label: "Machines" },
  { value: PAGE.SKILLS, label: "Skills" },
  { value: PAGE.INTEGRATIONS, label: "Integrations" },
] as const;

const PAGE_TITLE = {
  [PAGE.SKILLS]: "Skills",
  [PAGE.INTEGRATIONS]: "Integrations",
  [PAGE.MACHINES]: "Machines",
} as const satisfies Record<Page, string>;

/** The whole flow, held in one place so the jumps can set any state. */
function ImportMockup(): React.JSX.Element {
  const [page, setPage] = useState<Page>(PAGE.SKILLS);
  const [phase, setPhase] = useState<Phase>(PHASE.IDLE);
  const [read, setRead] = useState(0);
  const [picks, setPicks] = useState<ReadonlySet<string>>(firstPicks);
  const [clash, setClash] = useState<Clash>(CLASH.KEEP_BOTH);
  const [scope, setScope] = useState<Scope>(SCOPE.PERSONAL);
  const [jump, setJump] = useState<Jump>(JUMP.START);

  // The scan reads one place at a time, then opens the review.
  useEffect(() => {
    if (phase !== PHASE.SCANNING) return;

    const timer = setTimeout(() => {
      if (read < SOURCES.length) setRead(read + 1);
      else setPhase(PHASE.REVIEW);
    }, 700);

    return () => clearTimeout(timer);
  }, [phase, read]);

  // Bringing over takes a moment, then lands on the page the rows went to.
  useEffect(() => {
    if (phase !== PHASE.BRINGING) return;
    const timer = setTimeout(() => setPhase(PHASE.DONE), 900);

    return () => clearTimeout(timer);
  }, [phase]);

  const brought = countWords(counted(picks, clash));

  const start = () => {
    setRead(0);
    setPicks(firstPicks());
    setClash(CLASH.KEEP_BOTH);
    setPhase(PHASE.CONSENT);
  };

  const pick = (id: string, on: boolean) => {
    const next = new Set(picks);

    if (on) next.add(id);
    else next.delete(id);
    setPicks(next);
  };

  const jumpTo = (to: Jump) => {
    setJump(to);
    const servers = new Set([...firstPicks(), "linear", "postgres-dev", "sentry"]);

    switch (to) {
      case JUMP.START:
        setPhase(PHASE.IDLE);
        setPage(PAGE.SKILLS);
        break;
      case JUMP.CONSENT:
        start();
        break;
      case JUMP.SCANNING:
        setRead(1);
        setPhase(PHASE.SCANNING);
        break;
      case JUMP.REVIEW:
        setPicks(firstPicks());
        setPhase(PHASE.REVIEW);
        break;
      case JUMP.SECRET:
        setPicks(servers);
        setScope(SCOPE.WORKSPACE);
        setPhase(PHASE.REVIEW);
        // Note that the secret's row stands below the fold, so the jump scrolls it in once drawn.
        setTimeout(() => document.getElementById("import-row-postgres-dev")?.scrollIntoView(), 300);
        break;
      case JUMP.DONE:
        setPicks(servers);
        setScope(SCOPE.PERSONAL);
        setPhase(PHASE.DONE);
        setPage(PAGE.SKILLS);
        break;
      case JUMP.UNDO:
        setPicks(servers);
        setPhase(PHASE.UNDO_ASK);
        break;
    }
  };

  return (
    <Stack gap={GAP.FIELD}>
      <Inline gap={GAP.CONTROL} wrap>
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION}>
          Jump to
        </Text>
        <ChoiceBar<Jump>
          label="Jump to a state"
          items={JUMPS}
          value={jump}
          look={CHOICE_BAR_LOOK.SEGMENTED}
          onChange={jumpTo}
        />
      </Inline>
      <ChoiceBar<Page>
        label="Settings page"
        items={PAGES}
        value={page}
        look={CHOICE_BAR_LOOK.FILL}
        onChange={setPage}
      />
      <div className="catalog-settings-frame catalog-import-frame">
        <SettingsPage title={PAGE_TITLE[page]}>
          {page === PAGE.SKILLS ? (
            <SkillsPage
              phase={phase}
              picks={picks}
              clash={clash}
              brought={brought}
              onStart={start}
              onUndo={() => setPhase(PHASE.UNDO_ASK)}
            />
          ) : page === PAGE.INTEGRATIONS ? (
            <IntegrationsPage
              phase={phase}
              picks={picks}
              brought={brought}
              onUndo={() => setPhase(PHASE.UNDO_ASK)}
            />
          ) : (
            <MachinesPage phase={phase} onStart={start} />
          )}
        </SettingsPage>
      </div>
      <ImportDialog
        phase={phase}
        read={read}
        picks={picks}
        clash={clash}
        scope={scope}
        onPick={pick}
        onClash={setClash}
        onScope={setScope}
        onLook={() => {
          setRead(0);
          setPhase(PHASE.SCANNING);
        }}
        onBring={() => setPhase(PHASE.BRINGING)}
        onClose={() => setPhase(PHASE.IDLE)}
      />
      <UndoDialog
        open={phase === PHASE.UNDO_ASK}
        brought={brought}
        onCancel={() => setPhase(PHASE.DONE)}
        onUndo={() => setPhase(PHASE.UNDONE)}
      />
    </Stack>
  );
}

function ImportFromMacExample(): React.JSX.Element {
  return (
    <CatalogSection id="import-from-mac-flow" title="Bring in skills and MCP servers from a Mac">
      <ImportMockup />
    </CatalogSection>
  );
}

export const IMPORT_FROM_MAC_EXAMPLE: Example = {
  id: "import-from-mac",
  title: "Import from a Mac (design mockup)",
  Render: ImportFromMacExample,
};
