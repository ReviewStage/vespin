// skill-add.tsx -- Settings' Add skill, the panel's paste drawn natively: one box that takes a GitHub repository, a link to one of its folders, an `npx skills add` line, or a skill's text, then what it would install, whom it installs for, and Install.

import {
  type InstalledSkillCandidate,
  SKILL_PASTE_KIND,
} from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillPreviewView,
} from "@repo/features/installed-skill-view";
import {
  INSTALLED_SKILL_SCOPE,
  type InstalledSkillScope,
} from "@repo/features/installed-skill-wire";
import {
  candidateFacts,
  initialTicks,
  installLabel,
  installRequest,
  installScopes,
  previewLine,
  previewRetries,
  searchesSkills,
  shownSkills,
  type TextFill,
  textFill,
} from "@repo/features/skill-install-model";
import { failureLine, SKILLS_LINE } from "@repo/features/skills-settings-words";
import { VERB } from "@repo/features/words";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  ActionRow,
  BUZZ,
  ConfirmAsk,
  ListSection,
  ScopePicker,
  Screen,
  SettingsForm,
  ToggleRow,
  useColors,
  WordsField,
} from "@repo/ui-native";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useChosenWorkspace } from "../../chosen-workspace.js";
import { appStateQuery } from "../../host/app-state-query.js";
import { useHostActs } from "../../host/host-provider.js";
import { DISCARD_WORDS, useKeptWords } from "../../use-kept-words.js";
import { useWrite } from "../../use-write.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** How long the box stands still before the service previews it, as the panel's dialog waits. */
const PREVIEW_PAUSE_MS = 400;

/** The root of a preview's query key, beside the workspace and the words it reads. */
const SKILL_PREVIEW_QUERY = "skill-preview";

/** The names a flow finds the box and the fields by. */
const TEST_IDS = {
  PASTE: "skill-paste",
  NAME: "skill-name",
  WHEN: "skill-when",
} as const;

/** What a call that never answered reads as, so the line under the box stops reading. */
const UNANSWERED = { failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED } as const;

/** The preview as the box reads it: none while it is out, a read asked again among them, and a call with no answer as a failed preview. */
function previewView(
  previewed: UseQueryResult<InstalledSkillPreviewView>,
): InstalledSkillPreviewView | undefined {
  if (previewed.isPending || previewed.isFetching) return undefined;

  if (previewed.isError) return UNANSWERED;

  return previewed.data;
}

/** One found skill's line under its name: what it does, then where it is and how large. */
function candidateLine(candidate: InstalledSkillCandidate): string {
  const facts = candidateFacts(candidate);

  return candidate.description === undefined ? facts : `${candidate.description}\n${facts}`;
}

export default function SkillAddScreen() {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);

  if (chosen === undefined) return null;

  // Note that the page is drawn anew for each workspace, so a paste never previews in another.
  return <AddSkill key={chosen.id} workspace={chosen} />;
}

/**
 * Add skill, as the panel's dialog draws it: the box, and a short pause
 * after it last changed, the service's preview of it. A GitHub source's
 * skills are one list to tick, searched from the bar once it is long, the
 * skills the paste named or the one skill there is ticked as it lands; a
 * skill's text is its name and the description agents read, both filled
 * from its frontmatter and both the reader's to change. Install for stands
 * at the head where the workspace is shared, and Install in the bar sends
 * what the page shows (`installRequest`); one that went buzzes and goes
 * back to Skills, and a refusal is said under the box in plain words.
 * Back asks first while the box holds a paste.
 */
function AddSkill({ workspace }: { readonly workspace: Workspace }) {
  const colors = useColors();
  const router = useRouter();
  const acts = useHostActs();
  const write = useWrite();
  const [text, setText] = useState("");
  // Note that the text is previewed once typing pauses, so a preview asks for the words as they settled.
  const [settled, setSettled] = useState<string | undefined>(undefined);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [fill, setFill] = useState<TextFill>(() => textFill(undefined));
  const [scope, setScope] = useState<InstalledSkillScope>(INSTALLED_SKILL_SCOPE.PERSONAL);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<string | undefined>(undefined);
  const [installing, setInstalling] = useState(false);
  // How many previews have landed, by which a text's fields are drawn afresh with what its frontmatter declares.
  const [landings, setLandings] = useState(0);
  // Whether an install is out, read at the press itself.
  const out = useRef(false);
  // Whether the page still stands, since an install that lands after it was left must not go back from the screen in front.
  const standing = useRef(true);
  useEffect(() => {
    standing.current = true;

    return () => {
      standing.current = false;
    };
  }, []);

  const asks = text.trim() !== "";
  useEffect(() => {
    if (!asks) return;
    const pause = setTimeout(() => setSettled(text), PREVIEW_PAUSE_MS);

    return () => clearTimeout(pause);
  }, [asks, text]);
  const previewing = asks && settled === text;

  const previewed = useQuery({
    queryKey: [SKILL_PREVIEW_QUERY, workspace.id, text],
    queryFn: () => acts[ACT_KIND.INSTALLED_SKILLS_PREVIEW]({ workspaceId: workspace.id, text }),
    enabled: previewing,
    retry: false,
  });

  const view = previewing ? previewView(previewed) : undefined;
  // A preview that lands chooses its skills afresh, as React's guide adjusts state to a prop that changed.
  const [landedOn, setLandedOn] = useState<InstalledSkillPreviewView | undefined>(undefined);

  if (view !== undefined && !("failure" in view) && view !== landedOn) {
    setLandedOn(view);
    setTicked(initialTicks(view));
    setFill(textFill(view));
    setQuery("");
    setLandings((count) => count + 1);
  }

  const preview = view === undefined || "failure" in view ? undefined : view;
  const skills = preview?.kind === SKILL_PASTE_KIND.SOURCE ? preview.skills : [];
  const shown = shownSkills(skills, query);
  const line = asks ? previewLine(view) : undefined;
  const failed = view !== undefined && "failure" in view ? view : undefined;
  const scopes = installScopes(workspace);
  const request = installRequest({ workspaceId: workspace.id, text, scope, preview, ticked, fill });
  const toInstall = request?.skills ?? (request?.name === undefined ? [] : [request.name]);
  const label = installLabel(toInstall);
  const kept = useKeptWords(asks && !installing);

  const tick = (name: string, on: boolean) => {
    const next = new Set(ticked);

    if (on) next.add(name);
    else next.delete(name);
    setTicked(next);
  };

  const install = () => {
    // Note that a second press before the first one's render is turned away by the ref, which state would not yet say.
    if (out.current || request === undefined) return;
    out.current = true;
    setInstalling(true);
    setNote(undefined);

    void write(() => acts[ACT_KIND.INSTALLED_SKILLS_INSTALL](request), {
      refused: (answer) => ("failure" in answer ? failureLine(answer) : undefined),
      unanswered: failureLine(UNANSWERED),
      // Note that a refusal says why under the box, as the panel's dialog says it under its box.
      inPlace: setNote,
      went: BUZZ.SUCCESS,
    }).then((went) => {
      out.current = false;
      setInstalling(false);

      if (!went || !standing.current) return;
      kept.release();
      router.back();
    });
  };

  // Note that a lone skill's Install keeps to its verb in the bar, which a long name would crowd, and says the skill to VoiceOver.
  const barWords = toInstall.length > 1 ? label : SKILLS_LINE.INSTALL;
  const busy = installing;

  const textFields =
    preview?.kind === SKILL_PASTE_KIND.TEXT ? (
      <>
        <ListSection title={SKILLS_LINE.NAME} footer={SKILLS_LINE.NAME_HINT}>
          <WordsField
            key={`name-${landings}`}
            placeholder={SKILLS_LINE.NAME}
            label={SKILLS_LINE.NAME}
            initialWords={fill.name}
            onWords={(name) => setFill((held) => ({ ...held, name }))}
            testId={TEST_IDS.NAME}
          />
        </ListSection>
        <ListSection title={SKILLS_LINE.WHEN}>
          <WordsField
            key={`when-${landings}`}
            placeholder={SKILLS_LINE.WHEN}
            label={SKILLS_LINE.WHEN}
            initialWords={fill.description}
            onWords={(description) => setFill((held) => ({ ...held, description }))}
            testId={TEST_IDS.WHEN}
          />
        </ListSection>
      </>
    ) : null;

  const sourceList =
    preview?.kind === SKILL_PASTE_KIND.SOURCE && skills.length > 0 ? (
      <ListSection
        title={SKILLS_LINE.TO_INSTALL}
        count={skills.length}
        footer={shown.length === 0 ? SKILLS_LINE.NO_MATCH : undefined}
      >
        {shown.map((candidate) => (
          <ToggleRow
            key={candidate.path}
            label={candidate.name}
            detail={candidateLine(candidate)}
            on={ticked.has(candidate.name)}
            disabled={busy}
            onChange={(on) => tick(candidate.name, on)}
          />
        ))}
      </ListSection>
    ) : null;

  const form = (
    <SettingsForm>
      <ListSection
        title={SKILLS_LINE.PASTE_LABEL}
        footer={note ?? line?.text ?? SKILLS_LINE.PASTE_HINT}
      >
        <WordsField
          placeholder={SKILLS_LINE.PASTE_PLACEHOLDER}
          label={SKILLS_LINE.PASTE_LABEL}
          onWords={(typed) => {
            setText(typed);
            setNote(undefined);
          }}
          autoFocus
          testId={TEST_IDS.PASTE}
        />
        {failed !== undefined && previewRetries(failed) ? (
          <ActionRow label={VERB.RETRY} onPress={() => void previewed.refetch()} />
        ) : null}
      </ListSection>
      {line === undefined ? textFields : null}
      {line === undefined ? sourceList : null}
    </SettingsForm>
  );

  // Note that whom it installs for stands at the head only where there is a choice, a shared workspace's.
  const body: ReactNode =
    scopes.length > 1 ? (
      <ScopePicker
        label={SKILLS_LINE.INSTALL_FOR}
        scopes={scopes.map((each) => ({
          label: each.label,
          selected: each.value === scope,
          onPress: () => {
            if (!busy) setScope(each.value);
          },
        }))}
      >
        {form}
      </ScopePicker>
    ) : (
      form
    );

  return (
    <>
      <Stack.Screen options={{ title: SKILLS_LINE.ADD_SKILL }} />
      {searchesSkills(skills) && line === undefined ? (
        <Stack.Screen>
          <Stack.SearchBar
            placeholder={SKILLS_LINE.SEARCH}
            onChangeText={(event) => setQuery(event.nativeEvent.text)}
            onCancelButtonPress={() => setQuery("")}
          />
        </Stack.Screen>
      ) : null}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          variant="prominent"
          tintColor={colors.ACCENT}
          accessibilityLabel={busy ? "Installing" : label}
          disabled={request === undefined || busy}
          onPress={install}
        >
          {barWords}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <ConfirmAsk
        title={DISCARD_WORDS.QUESTION}
        act={DISCARD_WORDS.DISCARD}
        destructive
        presented={kept.asking}
        onAct={() => {
          // Note that the page stands no longer from the discard itself, since it stays mounted through its exit.
          standing.current = false;
          kept.discard();
        }}
        onDismiss={kept.stay}
      />
      <Screen>{body}</Screen>
    </>
  );
}
