/**
 * use-agent-pictures.tsx -- what each picture an agent showed is drawn from: the service's address and the header its read carries, asked of the host through TanStack Query where the picture is drawn, and handed to expo-image, which downloads, caches, and decodes it itself; read ahead for the rows about to scroll in, and tried once more under a renewed header where the service refused it.
 *
 * Each picture reads its own query where it is drawn (`useAgentPictureById`,
 * handed to `@repo/ui-native` through `PictureByIdProvider`), so a picture
 * landing draws that picture again and never the agent's page or its rows,
 * one of which may hold an open long-press menu. The page only reads ahead
 * (`fetchQuery`, `Image.prefetch`), which nothing listens to. The host
 * answers where a picture stands (`ACCOUNT_PICTURE_SOURCE`), kept under the
 * account that read it; expo-image keeps the picture in memory and on disk
 * under its address, which names it by its ids alone. A fixture run's
 * picture is its own `data:` address. Note that the header goes to the
 * loader's source alone, never to a log, a report, or a counted event; and
 * that each picture is counted once as it first draws (`picture:shown`), as
 * kept where the loader had it and downloaded where it read it now.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import { PRODUCT_PICTURE_FROM, PRODUCT_PICTURE_KIND } from "@repo/features/analytics";
import {
  PICTURE_OWNER,
  PICTURE_SOURCE_FAILURE,
  type PictureSourceView,
} from "@repo/features/picture-source-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  PICTURE_CACHE,
  type PictureById,
  PictureByIdProvider,
  type PictureEvents,
  PictureEventsProvider,
  type PictureSource,
} from "@repo/ui-native";
import { type QueryClient, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { pictureFile } from "../picture-files.js";
import { usePictureShownCount } from "../picture-shown.js";

/** The key a picture's source is held under, by the account, the agent, and the picture. */
const AGENT_PICTURE_QUERY = "agent-picture-source";

/** A source the loader could not read even under a renewed header, which stands failed until Try again. */
const UNREAD: PictureSourceView = { failure: PICTURE_SOURCE_FAILURE.UNOFFERED };

/** The account signed in, whose sources a picture's query is kept under; none while signed out. */
function selectAccountId(state: AppStateSnapshot): string | undefined {
  return signedInAccountId(state.account);
}

/** What a source the host answered is drawn from: its address with the header its read carries, a fixture's own address, or `null` where it answered none. */
function drawnFrom(
  view: PictureSourceView | undefined,
  failed: boolean,
): PictureSource | null | undefined {
  if (failed) return null;

  if (view === undefined) return undefined;

  if ("failure" in view) return null;

  return view.headers === undefined ? view.uri : view;
}

/** One picture's source as a query, renewed first where `renew`. */
function sourceQuery(
  acts: ReturnType<typeof useHostActs>,
  accountId: string | undefined,
  agentId: string,
  pictureId: string,
  renew = false,
) {
  return {
    queryKey: [AGENT_PICTURE_QUERY, accountId, agentId, pictureId] as const,
    queryFn: () =>
      acts[ACT_KIND.ACCOUNT_PICTURE_SOURCE]({
        owner: PICTURE_OWNER.AGENT,
        agentId,
        pictureId,
        ...(renew ? { renew: true } : undefined),
      }),
    staleTime: Number.POSITIVE_INFINITY,
  };
}

/** Reads ahead a picture the loader reads from the service, under its header, so it draws from the loader's cache once it scrolls in. */
function readAhead(view: PictureSourceView): void {
  if ("failure" in view || view.headers === undefined) return;
  void Image.prefetch([view.uri], { cachePolicy: "memory-disk", headers: { ...view.headers } });
}

/** What one agent's page holds of its pictures beside their queries: when each was first asked for, which were renewed and counted, and each by its address. */
interface PicturesHeld {
  readonly agentId: string;
  readonly askedAt: Map<string, number>;
  readonly renewed: Set<string>;
  readonly counted: Set<string>;
  readonly byUri: Map<string, string>;
}

/** The agent's page's pictures, for each picture drawn under it. */
const AgentPicturesDoor = createContext<PicturesHeld | undefined>(undefined);

/** The account signed in, as a picture's query is kept under it. */
function useAccountId(): string | undefined {
  return useQuery({ ...appStateQuery, select: selectAccountId }).data;
}

/**
 * What one picture of the agent's page is drawn from, read where it is drawn
 * so its landing draws it alone: none for no id, while it is asked for, and
 * outside an agent's page, and `null` where it could not be read.
 */
function useAgentPictureById(pictureId: string | undefined): PictureSource | null | undefined {
  const held = useContext(AgentPicturesDoor);
  const acts = useHostActs();
  const accountId = useAccountId();

  const read = useQuery({
    ...sourceQuery(acts, accountId, held?.agentId ?? "", pictureId ?? ""),
    enabled: held !== undefined && pictureId !== undefined && accountId !== undefined,
  });

  // Note that each picture is known by its address once it lands, so the loader's word that it drew or failed finds it, and is timed from when it was first asked for.
  useEffect(() => {
    if (held === undefined || pictureId === undefined) return;

    if (!held.askedAt.has(pictureId)) held.askedAt.set(pictureId, performance.now());
    const view = read.data;

    if (view !== undefined && !("failure" in view)) held.byUri.set(view.uri, pictureId);
  }, [held, pictureId, read.data]);

  return pictureId === undefined ? undefined : drawnFrom(read.data, read.isError);
}

/**
 * Hands the pictures drawn under it the agent's page: each reads its own
 * source where it is drawn (`useAgentPictureById`), and the loader's word
 * that one drew is counted once (`picture:shown`), and that one failed asks
 * for it once more under a renewed header, then stands it failed.
 */
export function AgentPicturesProvider({
  agentId,
  children,
}: {
  readonly agentId: string;
  readonly children: ReactNode;
}) {
  const acts = useHostActs();
  const client = useQueryClient();
  const count = usePictureShownCount(PRODUCT_PICTURE_KIND.AGENT);
  const accountId = useAccountId();

  const held = useMemo<PicturesHeld>(
    () => ({
      agentId,
      askedAt: new Map(),
      renewed: new Set(),
      counted: new Set(),
      byUri: new Map(),
    }),
    [agentId],
  );

  const events = useMemo<PictureEvents>(
    () => ({
      shown: (uri, cache) => {
        const pictureId = held.byUri.get(uri);
        const askedAt = pictureId === undefined ? undefined : held.askedAt.get(pictureId);

        if (pictureId === undefined || askedAt === undefined || held.counted.has(pictureId)) {
          return;
        }

        held.counted.add(pictureId);
        count(
          cache === PICTURE_CACHE.NONE
            ? PRODUCT_PICTURE_FROM.DOWNLOADED
            : PRODUCT_PICTURE_FROM.KEPT,
          askedAt,
        );
      },
      // Note that a picture the loader could not read is asked for once more under a renewed header, and stands failed after that.
      failed: (uri) => {
        const pictureId = held.byUri.get(uri);

        if (pictureId === undefined) return;
        const query = sourceQuery(acts, accountId, agentId, pictureId, true);

        if (held.renewed.has(pictureId)) {
          client.setQueryData(query.queryKey, UNREAD);

          return;
        }

        held.renewed.add(pictureId);
        void client.fetchQuery({ ...query, staleTime: 0 });
      },
    }),
    [acts, accountId, agentId, client, count, held],
  );

  return (
    <AgentPicturesDoor.Provider value={held}>
      <PictureByIdProvider use={useAgentPictureById}>
        <PictureEventsProvider events={events}>{children}</PictureEventsProvider>
      </PictureByIdProvider>
    </AgentPicturesDoor.Provider>
  );
}

/** What an agent's page draws its pictures from and does with them, none of which listens to their sources. */
interface AgentPictures {
  /** A picture kept by its id, which it reads where it is drawn. */
  readonly refOf: (pictureId: string) => PictureById;
  /** Reads a picture whose read failed again. */
  readonly retry: (pictureId: string) => void;
}

/** What a picture has landed as so far, read without listening. */
function peekOf(
  client: QueryClient,
  key: ReturnType<typeof sourceQuery>["queryKey"],
): PictureSource | null | undefined {
  const state = client.getQueryState<PictureSourceView>(key);

  return drawnFrom(state?.data, state?.status === "error");
}

/**
 * The agent's page's pictures among `ids`, the rows on screen and those
 * about to scroll in: each read ahead through the query it is drawn by
 * (`fetchQuery`) and by the loader (`Image.prefetch`), neither of which the
 * page listens to, so no picture landing draws the page again; and each
 * handed to its row by its id (`refOf`), which it reads where it is drawn.
 */
export function useAgentPictures(agentId: string, ids: readonly string[]): AgentPictures {
  const acts = useHostActs();
  const client = useQueryClient();
  const accountId = useAccountId();

  useEffect(() => {
    if (accountId === undefined) return;

    for (const pictureId of ids) {
      void client
        .fetchQuery(sourceQuery(acts, accountId, agentId, pictureId))
        .then(readAhead, () => undefined);
    }
  }, [acts, accountId, agentId, client, ids]);

  const refOf = useCallback(
    (pictureId: string): PictureById => ({
      pictureId,
      peek: () => peekOf(client, sourceQuery(acts, accountId, agentId, pictureId).queryKey),
    }),
    [acts, accountId, agentId, client],
  );

  const retry = useCallback(
    (pictureId: string) => {
      void client.resetQueries({
        queryKey: sourceQuery(acts, accountId, agentId, pictureId).queryKey,
      });
    },
    [acts, accountId, agentId, client],
  );

  return { refOf, retry };
}

/** The key a picture's file is held under, by the account, the agent, and the picture. */
const AGENT_PICTURE_FILE_QUERY = "agent-picture-file";

/**
 * The file each picture among `ids` stands in, where SwiftUI or the viewer
 * draws it, such as an app's capsule's icon or window: the one expo-image
 * keeps for it, downloaded first where it keeps none (`pictureFile`), asked
 * through TanStack Query, which tries a read that failed again. One on its
 * way is absent, and one that could not be read is `null`.
 */
export function useAgentPictureFiles(
  agentId: string,
  ids: readonly string[],
): ReadonlyMap<string, string | null> {
  const acts = useHostActs();
  const count = usePictureShownCount(PRODUCT_PICTURE_KIND.AGENT);
  const accountId = useAccountId();

  const reads = useQueries({
    queries: ids.map((pictureId) => ({
      queryKey: [AGENT_PICTURE_FILE_QUERY, accountId, agentId, pictureId] as const,
      queryFn: () => pictureFile(acts, { owner: PICTURE_OWNER.AGENT, agentId, pictureId }, count),
      enabled: accountId !== undefined,
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });

  const files = new Map<string, string | null>();

  ids.forEach((pictureId, at) => {
    const read = reads[at];

    if (read?.isError === true) files.set(pictureId, null);
    else if (read?.data !== undefined) files.set(pictureId, read.data);
  });

  return files;
}
