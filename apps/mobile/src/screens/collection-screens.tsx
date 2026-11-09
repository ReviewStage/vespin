// collection-screens.tsx -- a tab's placeholder list and detail: the Stack's two screens in a compact window, one split view in a regular one.

import {
  ChoiceList,
  EmptyState,
  LIST_LOOK,
  type ListLook,
  ListRow,
  PageHeader,
  ROW_ACTION_TONE,
  type RowAction,
  RowList,
  Screen,
  SplitView,
  TaskRow,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  COLLECTION_ROUTE,
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
      {items.map((item) => {
        const acts: readonly RowAction[] = [
          {
            label: "Mark done",
            symbol: "checkmark",
            tone: ROW_ACTION_TONE.ACCENT,
            onPress: () => setDone(new Set([...done, item.id])),
          },
        ];
        return collection.route === COLLECTION_ROUTE.TASKS && item.status !== undefined ? (
          <TaskRow
            key={item.id}
            id={item.id}
            name={item.title}
            status={item.status}
            unread={item.unread}
            pullRequest={item.pullRequest}
            at={item.at}
            trailingActions={acts}
          />
        ) : (
          <ListRow
            key={item.id}
            id={item.id}
            title={item.title}
            task={item.task}
            line={item.line}
            summary={item.summary}
            unread={item.unread}
            done={item.done}
            face={item.face}
            at={item.at}
            trailingActions={acts}
          />
        );
      })}
    </RowList>
  );
}

function ItemDetail({ item }: { readonly item: PlaceholderItem }) {
  const [picked, setPicked] = useState<readonly string[]>([]);
  if (item.ask === undefined) {
    return <PageHeader title={item.title} summary={item.summary} status={item.status} />;
  }
  return (
    <RowList look={LIST_LOOK.PLAIN}>
      <ChoiceList
        title={item.ask.question}
        choices={item.ask.choices}
        recommended={item.ask.recommended}
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
          look={LIST_LOOK.PLAIN}
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
