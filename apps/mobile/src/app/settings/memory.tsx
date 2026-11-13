// memory.tsx -- Settings' Memory page for the workspace the app works in: the facts and conventions its agents kept, most recalled first, searched from the bar, added from the bar's +, and edited with a press or deleted with a swipe, asked first, where the reader may.

import {
  ADD_MEMORY,
  forgetQuestion,
  MEMORY_ACT,
  MEMORY_PAGE_WORDS,
  MEMORY_RECALLS_WORDS,
  memoriesByUse,
  recallsText,
} from "@repo/features/memory-settings-words";
import type { MemorySummary } from "@repo/features/memory-wire";
import { matchesTokens, searchTokens } from "@repo/features/search-tokens";
import { agoText } from "@repo/features/time-format";
import { VERB } from "@repo/features/words";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { selectWorkspaceMemories, selectWorkspaces } from "@repo/host/app-state-reads";
import {
  BUTTON_LOOK,
  ConfirmAsk,
  EmptyState,
  GLYPH,
  glyphSymbol,
  ListSection,
  NoteRow,
  Screen,
  SettingsForm,
  useColors,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { useChosenWorkspace } from "../../chosen-workspace.js";
import { appStateQuery } from "../../host/app-state-query.js";
import { useHostActs } from "../../host/host-provider.js";
import { useLiveFollow } from "../../host/live-follow.js";
import { SETTINGS_ROUTE } from "../../settings-button.js";
import { useWrite } from "../../use-write.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** The glyph a page of memories stands under, the panel's brain. */
const MEMORY_SYMBOL = GLYPH.MEMORY;

/** What a memory kept by an account since deleted names its keeper as. */
const FORMER_KEEPER = "Former member";

/** Says on the console a read asked again that did not go; the page still says the read failed. */
function retryLost(cause: unknown): void {
  console.error("Reading the memories again did not go.", cause);
}

/** Whose words a memory holds, as the search reads them. */
function keeperOf(memory: MemorySummary): string {
  return memory.keptBy?.name ?? FORMER_KEEPER;
}

/** The line under a memory's words: whose they are, when they were last kept, and how often agents recalled them. */
function memoryLine(memory: MemorySummary, now: number): string {
  return [keeperOf(memory), agoText(memory.updatedAt, now), recallsText(memory.recalls30d)].join(
    " · ",
  );
}

export default function MemoryScreen() {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen } = useChosenWorkspace(workspaces);

  if (chosen === undefined) return null;

  // Note that the page is drawn anew for each workspace, so a search or a question never carries into another.
  return <MemoryPage key={chosen.id} workspace={chosen} />;
}

function MemoryPage({ workspace }: { readonly workspace: Workspace }) {
  const colors = useColors();
  const router = useRouter();
  const acts = useHostActs();
  const write = useWrite();
  const workspaceId = workspace.id;
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState<MemorySummary | undefined>(undefined);
  useLiveFollow(workspaceId, (id) => acts[ACT_KIND.MEMORIES_FOLLOW]({ workspaceId: id }));

  const { data: held } = useQuery({
    ...appStateQuery,
    select: useMemo(() => selectWorkspaceMemories(workspaceId), [workspaceId]),
  });

  const memories = held?.rows;
  const found = searchTokens(query);
  const now = Date.now();

  const listed =
    memories === undefined
      ? []
      : memoriesByUse(memories).filter((memory) =>
          matchesTokens([memory.text, keeperOf(memory)], found),
        );

  const question = forgetQuestion(1, 0);

  const forget = (memory: MemorySummary) =>
    void write(() => acts[ACT_KIND.MEMORIES_FORGET]({ workspaceId, id: memory.id }), {
      refused: (answer) => ("failure" in answer ? MEMORY_PAGE_WORDS.FORGET_FAILED : undefined),
      retry: true,
    });

  const body =
    memories === undefined ? (
      held?.failed === true ? (
        <EmptyState
          title={MEMORY_PAGE_WORDS.FAILED}
          symbol={GLYPH.FAILED}
          action={{
            label: VERB.TRY_AGAIN,
            look: BUTTON_LOOK.BORDERED,
            onPress: () => void acts[ACT_KIND.MEMORIES_RETRY]({ workspaceId }).catch(retryLost),
          }}
        />
      ) : (
        <EmptyState title={MEMORY_PAGE_WORDS.READING} symbol={MEMORY_SYMBOL} loading />
      )
    ) : memories.length === 0 ? (
      <EmptyState title={MEMORY_PAGE_WORDS.EMPTY} symbol={MEMORY_SYMBOL} />
    ) : listed.length === 0 ? (
      <EmptyState title={MEMORY_PAGE_WORDS.NO_MATCH} symbol={GLYPH.SEARCH} />
    ) : (
      <SettingsForm>
        <ListSection
          title={MEMORY_PAGE_WORDS.TITLE}
          count={listed.length}
          footer={MEMORY_RECALLS_WORDS}
        >
          {listed.map((memory) => (
            <NoteRow
              key={memory.id}
              words={memory.text}
              line={memoryLine(memory, now)}
              edit={
                memory.forgettable
                  ? {
                      label: MEMORY_ACT.EDIT,
                      onPress: () =>
                        router.push({
                          pathname: SETTINGS_ROUTE.MEMORY_EDIT,
                          params: { memory: memory.id },
                        }),
                    }
                  : undefined
              }
              remove={
                memory.forgettable
                  ? { label: MEMORY_ACT.FORGET, onPress: () => setAsked(memory) }
                  : undefined
              }
            />
          ))}
        </ListSection>
      </SettingsForm>
    );

  return (
    <>
      <Stack.Screen>
        <Stack.SearchBar
          placeholder={MEMORY_PAGE_WORDS.SEARCH}
          onChangeText={(event) => setQuery(event.nativeEvent.text)}
          onCancelButtonPress={() => setQuery("")}
        />
      </Stack.Screen>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={glyphSymbol(GLYPH.ADD)}
          tintColor={colors.TEXT}
          accessibilityLabel={ADD_MEMORY}
          disabled={memories === undefined}
          onPress={() => router.push(SETTINGS_ROUTE.MEMORY_EDIT)}
        />
      </Stack.Toolbar>
      <Screen>{body}</Screen>
      <ConfirmAsk
        title={question.title}
        message={question.body}
        act={question.verb}
        destructive
        presented={asked !== undefined}
        onDismiss={() => setAsked(undefined)}
        onAct={() => {
          if (asked === undefined) return;
          const memory = asked;
          setAsked(undefined);
          forget(memory);
        }}
      />
    </>
  );
}
