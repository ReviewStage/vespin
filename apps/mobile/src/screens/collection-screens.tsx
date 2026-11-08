// collection-screens.tsx -- a tab's placeholder list and detail: the Stack's two screens in a compact window, one split view in a regular one.

import {
  ChoiceList,
  EmptyState,
  LIST_LOOK,
  type ListLook,
  ListRow,
  MarkdownPage,
  PageHeader,
  ROW_ACTION_TONE,
  RowList,
  Screen,
  SplitView,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  PLACEHOLDER_REPOSITORY,
  type PlaceholderCollection,
  type PlaceholderItem,
} from "../placeholders.js";
import { useWindowSizeClass } from "../use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "../window-size-class.js";

/** The route a collection's row opens in a compact window. */
function itemHref(collection: PlaceholderCollection, id: string): string {
  return `/${collection.route}/${id}`;
}

type CollectionListProps = {
  readonly collection: PlaceholderCollection;
  readonly look: ListLook;
  readonly selected?: string | undefined;
  readonly onSelect: (id: string) => void;
};

// Note that Mark done only hides the row here, since the placeholder has no
// host to write to; the host's state replaces this list and its acts.
function CollectionList({ collection, look, selected, onSelect }: CollectionListProps) {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const items = collection.items.filter((item) => !done.has(item.id));
  return (
    <RowList
      look={look}
      selected={selected}
      onSelect={onSelect}
      title={look === LIST_LOOK.SIDEBAR ? collection.title : undefined}
    >
      {items.map((item) => (
        <ListRow
          key={item.id}
          id={item.id}
          title={item.title}
          preview={item.summary}
          previewSymbol={item.symbol}
          unread={item.unread}
          status={item.status}
          avatar={item.status === undefined ? item.from : undefined}
          at={item.at}
          trailingActions={[
            {
              label: "Mark done",
              symbol: "checkmark",
              tone: ROW_ACTION_TONE.ACCENT,
              onPress: () => setDone(new Set([...done, item.id])),
            },
          ]}
        />
      ))}
    </RowList>
  );
}

// Note that a place a message names opens nothing yet, since the placeholder
// has no screen for one; the host's routes will take it.
function openNothing() {}

function ItemDetail({ item }: { readonly item: PlaceholderItem }) {
  const [picked, setPicked] = useState<readonly string[]>([]);
  if (item.message !== undefined) {
    return (
      <MarkdownPage
        title={item.title}
        summary={item.summary}
        words={item.message}
        repository={PLACEHOLDER_REPOSITORY}
        onOpenPlace={openNothing}
      />
    );
  }
  if (item.choices === undefined) return <PageHeader title={item.title} summary={item.summary} />;
  return (
    <RowList look={LIST_LOOK.INSET}>
      <ChoiceList
        title={item.summary}
        choices={item.choices}
        recommended={item.recommended}
        picked={picked}
        onChange={setPicked}
      />
    </RowList>
  );
}

function EmptyDetail({ collection }: { readonly collection: PlaceholderCollection }) {
  return <EmptyState title={collection.emptyDetail} symbol={collection.symbol} />;
}

// A compact window: the list under the Stack's large title, each row pushing
// its detail as the Stack's next screen.
function CollectionStackList({ collection }: { readonly collection: PlaceholderCollection }) {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: collection.title, headerLargeTitle: true }} />
      <Screen>
        <CollectionList
          collection={collection}
          look={LIST_LOOK.INSET}
          onSelect={(id) => router.push(itemHref(collection, id))}
        />
      </Screen>
    </>
  );
}

// A regular window, such as the unfolded iPhone Duo's or an iPad's: the list
// as the split view's sidebar and the selected row's detail beside it. The
// Stack's header steps aside, since the split view draws each column's
// navigation bar itself.
function CollectionSplitScreen({ collection }: { readonly collection: PlaceholderCollection }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const item = collection.items.find((candidate) => candidate.id === selected);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen>
        <SplitView
          sidebar={
            <CollectionList
              collection={collection}
              look={LIST_LOOK.SIDEBAR}
              selected={selected}
              onSelect={setSelected}
            />
          }
          detail={item ? <ItemDetail item={item} /> : <EmptyDetail collection={collection} />}
        />
      </Screen>
    </>
  );
}

/** A tab's root screen: the collection's list, laid out by the window's size class. */
export function CollectionListScreen({ collection }: { collection: PlaceholderCollection }) {
  const sizeClass = useWindowSizeClass();
  return sizeClass === WINDOW_SIZE_CLASS.REGULAR ? (
    <CollectionSplitScreen collection={collection} />
  ) : (
    <CollectionStackList collection={collection} />
  );
}

/** A tab's pushed screen: one row's detail, named by the route's `id`. */
export function CollectionDetailScreen({ collection }: { collection: PlaceholderCollection }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = collection.items.find((candidate) => candidate.id === id);
  return (
    <>
      <Stack.Screen options={{ title: item?.title ?? collection.title }} />
      <Screen>{item ? <ItemDetail item={item} /> : <EmptyDetail collection={collection} />}</Screen>
    </>
  );
}
