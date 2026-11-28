/**
 * share-page.tsx -- the share page: where a share goes, ticked in one list over the composer that holds what was shared, as Dean picked it (STAG-5328's C, Nov 27, 2026).
 *
 * One page, as a share to a few people goes in Messages, drawn in the app
 * over a kept draft and in the share sheet itself, each standing it under a
 * bar of its own (`Bar`): the list of where a
 * share may go stands over the docked composer, in `RowList`'s Select mode,
 * so a tap ticks a row and several may be ticked. New task stands first, then
 * Recent and each kind under its heading (`shareSections`), every row drawn
 * by the app's own row for its kind and read from the snapshot the app left
 * (`ios-share-wire.ts`), so it says what names the place and never a live
 * state it cannot keep current. The system's search field narrows the list.
 * The composer stands in its box look, as a page that starts work does
 * (`COMPOSER_LOOK.BOX`), so its row holds the "To" capsule: the one place
 * ticked, or how many, in the ink, whose menu unticks one. What was shared
 * stands inside the field as its pills, a link as its chip and a picture as
 * its thumbnail's (`ComposerPills`), never in a block of its own. Send stands
 * held until a place is ticked, then goes once the field holds something,
 * handing the places ticked and the words to `onSend`.
 */

import {
  SHARE_KIND_HEADING,
  SHARE_NEW_TASK_ID,
  SHARE_PAGE_WORDS,
  shareDestinationName,
  shareSections,
  shareToLabel,
} from "@repo/features/ios-share-page-model";
import {
  SHARE_DESTINATION_KIND,
  type ShareDestination,
  type ShareDestinations,
} from "@repo/features/ios-share-wire";
import {
  AGENT_ROW_STATE,
  AgentRow,
  AskNote,
  COMPOSER_LOOK,
  Composer,
  type ComposerPills,
  EmptyState,
  GLYPH,
  GlassDock,
  type Glyph,
  LIST_LOOK,
  ListRow,
  ListSection,
  MENU_CHIP_LOOK,
  MenuChip,
  PlaceRow,
  RowList,
  Screen,
  TaskRow,
} from "@repo/ui-native";
import { type ComponentType, useMemo, useState } from "react";

/** The names a flow finds the page's pieces by. */
export const SHARE_PAGE_TEST_ID = {
  FIELD: "share-field",
  ADD: "share-add",
  TO: "share-to",
} as const;

/** The glyph each kind of place leads the "To" capsule with, as its row's mark says it. */
const KIND_GLYPH = {
  [SHARE_DESTINATION_KIND.MANAGER]: GLYPH.AGENT,
  [SHARE_DESTINATION_KIND.AGENT]: GLYPH.AGENT,
  [SHARE_DESTINATION_KIND.THREAD]: GLYPH.INBOX,
  [SHARE_DESTINATION_KIND.TASK]: GLYPH.TASK,
} as const;

/** One place ticked, as the "To" capsule names it. */
interface Ticked {
  readonly id: string;
  readonly name: string;
  readonly glyph: Glyph;
}

/** A place a share may go, by the app's own row for its kind, with no live state the snapshot cannot keep current. */
function DestinationRow({ row }: { readonly row: ShareDestination }) {
  switch (row.kind) {
    case SHARE_DESTINATION_KIND.MANAGER:
      return (
        <AgentRow
          id={row.id}
          name={row.name}
          face={row.face}
          state={AGENT_ROW_STATE.REST}
          waiting={0}
        />
      );
    case SHARE_DESTINATION_KIND.AGENT:
      return (
        <AgentRow
          id={row.id}
          name={row.name}
          harness={row.harness}
          task={row.task}
          state={AGENT_ROW_STATE.REST}
          waiting={0}
        />
      );
    case SHARE_DESTINATION_KIND.THREAD:
      return (
        <ListRow
          id={row.id}
          title={row.title}
          task={
            row.holderFace === undefined
              ? { name: row.holder, status: row.holderStatus }
              : { name: row.holder, manager: { face: row.holderFace, working: false } }
          }
        />
      );
    case SHARE_DESTINATION_KIND.TASK:
      return <TaskRow id={row.id} name={row.name} status={row.status} />;
  }
}

/** The "To" capsule: the one place ticked, or how many, in the ink, whose menu lists them ticked so one may be unticked. */
function ToChip({
  ticked,
  onUntick,
}: {
  readonly ticked: readonly Ticked[];
  readonly onUntick: (id: string) => void;
}) {
  const label = shareToLabel(ticked.map((each) => each.name));

  if (label === undefined) return null;
  const [only] = ticked;

  return (
    <MenuChip
      look={MENU_CHIP_LOOK.COMPOSER}
      symbol={ticked.length === 1 ? only?.glyph : undefined}
      label={label}
      testId={SHARE_PAGE_TEST_ID.TO}
      menu={{
        groups: [
          {
            choices: ticked.map((each) => ({
              id: each.id,
              label: each.name,
              on: true,
              onPress: () => onUntick(each.id),
            })),
          },
        ],
      }}
    />
  );
}

/** What the page hands its bar: the search's words as they change, and the ✕. */
export interface SharePageBarProps {
  readonly onSearch: (words: string) => void;
  readonly onCancel: () => void;
}

/** What the share page is handed: its bar, where a share may go, what was shared as the composer's words and pills, and what Send and ✕ do. */
export interface SharePageProps {
  /** The bar it stands under, its title, search field and ✕: the app's stack's in the app (`StackShareBar`), and the extension's own system bar in the share sheet. */
  readonly Bar: ComponentType<SharePageBarProps>;
  /** Where a share may go, as the snapshot holds it; none where the app wrote none, when New task stands alone. */
  readonly destinations: ShareDestinations | undefined;
  readonly words: string;
  readonly onWords: (words: string) => void;
  /** The field's pills, which hold what was shared: its link as a chip, its pictures as theirs. */
  readonly pills: ComposerPills;
  /** Whether the field holds a picture, which a share may go with alone. */
  readonly holdsPictures: boolean;
  /** The places ticked as the page opens, such as a kept draft's, by their ids; none ticked where none is given. */
  readonly initialTicked?: readonly string[] | undefined;
  /** Whether Send is held and the field read-only whatever is ticked, as while a send is out, so nothing typed meanwhile is lost to it, or once the share sheet kept the share for the app. */
  readonly held?: boolean | undefined;
  /** What a send that did not go said, standing over the field; none while nothing did. */
  readonly note?: string | undefined;
  /** Sends the words to the places ticked, by their ids (`SHARE_NEW_TASK_ID` for New task); whether it took them. */
  readonly onSend: (to: readonly string[], words: string) => boolean;
  readonly onCancel: () => void;
}

/** The share page: the places to tick over the composer that holds what was shared. */
export function SharePage(props: SharePageProps) {
  const { Bar, destinations, words, onWords, pills, holdsPictures, note, onSend, onCancel } = props;
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<readonly string[]>(props.initialTicked ?? []);
  const rows = destinations?.rows ?? [];
  const sections = useMemo(() => shareSections(rows, search), [rows, search]);
  const searching = search.trim() !== "";

  // Note that the capsule names the places in the order they were ticked, as a To line lists its names.
  const ticked = chosen.flatMap((id): readonly Ticked[] => {
    if (id === SHARE_NEW_TASK_ID) {
      return [{ id, name: SHARE_PAGE_WORDS.NEW_TASK, glyph: GLYPH.NEW_TASK }];
    }

    const row = rows.find((each) => each.id === id);

    return row === undefined
      ? []
      : [{ id, name: shareDestinationName(row), glyph: KIND_GLYPH[row.kind] }];
  });

  // Note that Send is held, dimmed, until a place is ticked, as Messages holds it until a recipient is named, and lit with no words where a picture goes alone.
  const held = ticked.length === 0 || props.held === true;

  const nothingFound = searching && sections.kinds.length === 0;

  return (
    <>
      <Bar onSearch={setSearch} onCancel={onCancel} />
      <GlassDock
        bar={
          <Composer
            look={COMPOSER_LOOK.BOX}
            placeholder={SHARE_PAGE_WORDS.PLACEHOLDER}
            words={words}
            onWords={onWords}
            pills={pills}
            head={note === undefined ? undefined : <AskNote words={note} />}
            sendable={!held && holdsPictures}
            sendHeld={held}
            editable={props.held !== true}
            onSend={(sent) => onSend(chosen, sent)}
            tools={
              <ToChip
                ticked={ticked}
                onUntick={(id) => setChosen((now) => now.filter((each) => each !== id))}
              />
            }
            testIds={{ field: SHARE_PAGE_TEST_ID.FIELD, add: SHARE_PAGE_TEST_ID.ADD }}
          />
        }
      >
        <Screen>
          <RowList
            look={LIST_LOOK.PLAIN}
            choosing={{ chosen, onChoose: setChosen }}
            searched={search}
            empty={
              nothingFound ? (
                <EmptyState title={SHARE_PAGE_WORDS.NO_MATCH} symbol={GLYPH.SEARCH} />
              ) : undefined
            }
          >
            {searching ? null : (
              <ListSection>
                <PlaceRow
                  id={SHARE_NEW_TASK_ID}
                  symbol={GLYPH.NEW_TASK}
                  label={SHARE_PAGE_WORDS.NEW_TASK}
                />
              </ListSection>
            )}
            {sections.recent.length === 0 ? null : (
              <ListSection title={SHARE_PAGE_WORDS.RECENT}>
                {sections.recent.map((row) => (
                  <DestinationRow key={row.id} row={row} />
                ))}
              </ListSection>
            )}
            {sections.kinds.map((section) => (
              <ListSection
                key={section.kind}
                title={SHARE_KIND_HEADING[section.kind]}
                count={section.rows.length}
              >
                {section.rows.map((row) => (
                  <DestinationRow key={row.id} row={row} />
                ))}
              </ListSection>
            ))}
          </RowList>
        </Screen>
      </GlassDock>
    </>
  );
}
