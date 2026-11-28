// picture-source.tsx -- what a picture React Native draws is read from: a file or `data:` address, or the service's address with the headers its read carries, which expo-image downloads, caches in memory and on disk, and decodes at the size it is drawn; and the door a drawn picture tells its page through as it lands or fails.

import { Predicate } from "effect";
import { Image, type ImageSource } from "expo-image";
import { type ComponentRef, createContext, type ReactNode, type Ref, useContext } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";

/** A picture the platform's image loader reads from the service: its address, which names it by its ids alone, and the headers its read carries. */
export type RemotePicture = {
  readonly uri: string;
  readonly headers?: Readonly<Record<string, string>> | undefined;
};

/** What a picture is drawn from: a file or `data:` address, or a picture the loader reads from the service. */
export type PictureSource = string | RemotePicture;

/** Where a drawn picture's bytes came from, as the loader says: read now, or from its own cache on disk or in memory. */
export const PICTURE_CACHE = {
  NONE: "none",
  DISK: "disk",
  MEMORY: "memory",
} as const;

export type PictureCache = (typeof PICTURE_CACHE)[keyof typeof PICTURE_CACHE];

/** What a page hears of the pictures it draws, by the address each is read from. */
export interface PictureEvents {
  /** A picture drew, from where its bytes came. */
  readonly shown: (uri: string, cache: PictureCache) => void;
  /** A picture could not be read, as one the service refused under a header that ran out. */
  readonly failed: (uri: string) => void;
}

/** The page's ears for its pictures; none where nothing listens. */
const PictureEventsDoor = createContext<PictureEvents | undefined>(undefined);

/** How an address holding its bytes begins. */
const DATA_ADDRESS = "data:";

/** The address a picture is drawn from, whichever way it is held. */
export function pictureUri(source: PictureSource): string {
  return Predicate.isString(source) ? source : source.uri;
}

/** The loader's source for a picture: its address, with the headers its read carries where it has any. */
function loaderSource(source: PictureSource): ImageSource {
  if (Predicate.isString(source)) return { uri: source };

  return source.headers === undefined
    ? { uri: source.uri }
    : { uri: source.uri, headers: { ...source.headers } };
}

/** Hands the pictures drawn under it the page's ears. */
export function PictureEventsProvider({
  events,
  children,
}: {
  readonly events: PictureEvents;
  readonly children: ReactNode;
}) {
  return <PictureEventsDoor.Provider value={events}>{children}</PictureEventsDoor.Provider>;
}

/** The page's ears for the picture drawn here; none where nothing listens. */
export function usePictureEvents(): PictureEvents | undefined {
  return useContext(PictureEventsDoor);
}

/** How a picture fills its box: cropped to fill it, or standing whole inside it. */
export const PICTURE_FIT = {
  COVER: "cover",
  CONTAIN: "contain",
} as const;

export type PictureFit = (typeof PICTURE_FIT)[keyof typeof PICTURE_FIT];

const styles = StyleSheet.create({
  box: { overflow: "hidden" },
});

/**
 * A picture drawn by expo-image from its source, inside a box of `style`
 * whose place in the window a press measures (`drawn`), as the viewer grows
 * a picture out of its thumbnail. The loader reads it with the headers its
 * source carries, keeps it in memory and on disk under its address, but for
 * a `data:` address, which it keeps in memory alone, since its bytes are
 * already in hand, such as a picture a message on its way carries, which
 * must never be written to disk; and it decodes it at the size it stands at; it tells the page's ears
 * (`usePictureEvents`) as it draws, from where its bytes came, and where it
 * could not be read, and hands its own size in pixels to `onSize`.
 */
export function LoaderImage({
  source,
  fit,
  style,
  drawn,
  onSize,
}: {
  readonly source: PictureSource;
  readonly fit: PictureFit;
  readonly style: StyleProp<ViewStyle>;
  readonly drawn?: Ref<ComponentRef<typeof View>> | undefined;
  readonly onSize?: ((width: number, height: number) => void) | undefined;
}) {
  const events = usePictureEvents();
  const uri = pictureUri(source);

  return (
    <View ref={drawn} collapsable={false} style={[styles.box, style]}>
      <Image
        source={loaderSource(source)}
        cachePolicy={uri.startsWith(DATA_ADDRESS) ? "memory" : "memory-disk"}
        recyclingKey={uri}
        contentFit={fit}
        style={StyleSheet.absoluteFill}
        onLoad={(event) => {
          onSize?.(event.source.width, event.source.height);
          events?.shown(uri, event.cacheType);
        }}
        onError={() => events?.failed(uri)}
        accessible={false}
      />
    </View>
  );
}

/**
 * A picture the page keeps by its id rather than its source, which the
 * picture reads where it is drawn (`usePictureRef`), so its source landing
 * draws the picture alone again, never its row or the rows around it, such
 * as one holding an open long-press menu. `peek` reads what has landed so far
 * without listening, for an act that runs later, such as VoiceOver's Open.
 */
export type PictureById = {
  readonly pictureId: string;
  readonly peek: () => PictureSource | null | undefined;
};

/** What a picture is drawn from: its source, or its id for the page to read where it is drawn. */
export type PictureRef = PictureSource | PictureById;

/** How the page reads one picture by its id, as a hook: none for no id, and the same function for the page's life. */
export type UsePictureById = (pictureId: string | undefined) => PictureSource | null | undefined;

/** The page's read of a picture by its id; none where the page keeps none by id. */
const PictureByIdDoor = createContext<UsePictureById>(() => undefined);

/** Whether a picture is kept by its id. */
function isById(ref: PictureRef | null | undefined): ref is PictureById {
  return ref != null && !Predicate.isString(ref) && "pictureId" in ref;
}

/** Hands the pictures drawn under it the page's read of a picture by its id. */
export function PictureByIdProvider({
  use,
  children,
}: {
  readonly use: UsePictureById;
  readonly children: ReactNode;
}) {
  return <PictureByIdDoor.Provider value={use}>{children}</PictureByIdDoor.Provider>;
}

/** What a picture is drawn from: its own source, or the one the page reads for its id, listened to here alone. */
export function usePictureRef(
  ref: PictureRef | null | undefined,
): PictureSource | null | undefined {
  const useById = useContext(PictureByIdDoor);
  const read = useById(isById(ref) ? ref.pictureId : undefined);

  return isById(ref) ? read : ref;
}

/** What a picture is drawn from now, without listening, for an act that runs later. */
export function peekPicture(ref: PictureRef | null | undefined): PictureSource | null | undefined {
  return isById(ref) ? ref.peek() : ref;
}
