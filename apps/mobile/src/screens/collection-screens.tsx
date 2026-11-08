// collection-screens.tsx -- a tab's placeholder list and detail: the Stack's two screens in a compact window, one split view in a regular one.

import {
  ContentUnavailableView,
  Host,
  Label,
  List,
  NavigationSplitView,
  type NavigationSplitViewVisibility,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  font,
  listStyle,
  navigationSplitViewStyle,
  navigationTitle,
  padding,
  tag,
} from "@expo/ui/swift-ui/modifiers";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import type { PlaceholderCollection, PlaceholderItem } from "../placeholders.js";
import { useWindowSizeClass } from "../use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "../window-size-class.js";

/** The host fills its screen, so SwiftUI lays out in the whole window. */
const FILL = { flex: 1 } as const;

/** The route a collection's row opens in a compact window. */
function itemHref(collection: PlaceholderCollection, id: string): string {
  return `/${collection.route}/${id}`;
}

/** The one row a SwiftUI `List` selection names, where it names one. */
function selectedId(selection: readonly (string | number)[]): string | undefined {
  const first = selection[0];
  return typeof first === "string" ? first : undefined;
}

function CollectionRows({ collection }: { collection: PlaceholderCollection }) {
  return collection.items.map((item) => (
    <Label key={item.id} title={item.title} systemImage={item.symbol} modifiers={[tag(item.id)]} />
  ));
}

function ItemDetail({ item }: { item: PlaceholderItem }) {
  return (
    <VStack alignment="leading" spacing={8} modifiers={[padding({ horizontal: 20, vertical: 16 })]}>
      <Text modifiers={[font({ textStyle: "title2", weight: "semibold" })]}>{item.title}</Text>
      <Text>{item.summary}</Text>
    </VStack>
  );
}

function EmptyDetail({ collection }: { collection: PlaceholderCollection }) {
  return <ContentUnavailableView title={collection.emptyDetail} systemImage={collection.symbol} />;
}

// A compact window: the list under the Stack's large title, each row pushing
// its detail as the Stack's next screen.
function CollectionStackList({ collection }: { collection: PlaceholderCollection }) {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: collection.title, headerLargeTitle: true }} />
      <Host style={FILL}>
        <List
          selection={[]}
          onSelectionChange={(selection) => {
            const id = selectedId(selection);
            if (id !== undefined) router.push(itemHref(collection, id));
          }}
          modifiers={[listStyle("insetGrouped")]}
        >
          <CollectionRows collection={collection} />
        </List>
      </Host>
    </>
  );
}

// A regular window, such as the unfolded iPhone Duo's or an iPad's: SwiftUI's
// own split view, the list as its sidebar and the selected row's detail
// beside it. The Stack's header steps aside, since the split view draws each
// column's navigation bar itself. Note that the columns start out all shown
// and balanced, because SwiftUI's automatic style hides the sidebar of a
// portrait iPad until it is asked for, and the list is what the window is
// wide enough to keep beside the detail.
function CollectionSplitScreen({ collection }: { collection: PlaceholderCollection }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [columns, setColumns] = useState<NavigationSplitViewVisibility>("all");
  const item = collection.items.find((candidate) => candidate.id === selected);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Host style={FILL}>
        <NavigationSplitView
          columnVisibility={columns}
          onColumnVisibilityChange={setColumns}
          modifiers={[navigationSplitViewStyle("balanced")]}
        >
          <NavigationSplitView.Sidebar>
            <List
              selection={selected === undefined ? [] : [selected]}
              onSelectionChange={(selection) => setSelected(selectedId(selection))}
              modifiers={[listStyle("sidebar"), navigationTitle(collection.title)]}
            >
              <CollectionRows collection={collection} />
            </List>
          </NavigationSplitView.Sidebar>
          <NavigationSplitView.Detail>
            {item ? <ItemDetail item={item} /> : <EmptyDetail collection={collection} />}
          </NavigationSplitView.Detail>
        </NavigationSplitView>
      </Host>
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
      <Host style={FILL}>
        {item ? <ItemDetail item={item} /> : <EmptyDetail collection={collection} />}
      </Host>
    </>
  );
}
