/**
 * use-agent-pictures.ts -- what each picture an agent showed is drawn from: the service's address and the header its read carries, asked of the host through TanStack Query, and handed to expo-image, which downloads, caches, and decodes it itself, read ahead for the rows about to scroll in and tried once more under a renewed header where the service refused it.
 *
 * The host answers where a picture stands (`ACCOUNT_PICTURE_SOURCE`), one
 * query a picture, kept under the account that read it. expo-image keeps the
 * picture in memory and on disk under its address, which names it by its ids
 * alone. A fixture run's picture is its own `data:` address. Note that the
 * header goes to the loader's source alone, never to a log, a report, or a
 * counted event; and that each picture is counted once as it first draws
 * (`picture:shown`), as kept where the loader had it and downloaded where it
 * read it now.
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
import { PICTURE_CACHE, type PictureEvents, type PictureSource } from "@repo/ui-native";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useEffect, useMemo, useRef } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { pictureFile } from "../picture-files.js";
import { usePictureShownCount } from "../picture-shown.js";

/** The key a picture's source is held under, by the account, the agent, and the picture. */
const AGENT_PICTURE_QUERY = "agent-picture-source";

/** A source the loader could not read even under a renewed header, which stands failed until Try again. */
const UNREAD: PictureSourceView = { failure: PICTURE_SOURCE_FAILURE.UNOFFERED };

/** What an agent's pictures are drawn from, by id, what the page's pictures tell as they draw, and what reads one that failed again. */
export interface AgentPictures {
  /** What each picture is drawn from, by its id; none while it is asked for, and `null` where it could not be read. */
  readonly sources: ReadonlyMap<string, PictureSource | null>;
  readonly events: PictureEvents;
  readonly retry: (pictureId: string) => void;
}

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

/**
 * What each picture the agent showed, among `ids`, is drawn from: asked of
 * the host once a picture through TanStack Query, kept for the account that
 * read it, and read ahead by the loader as it lands, so the rows about to
 * scroll in draw from its cache. A picture the loader could not read is
 * asked for once more under a renewed header, as the account's calls retry
 * a 401, and stands failed with Try again after that (`retry`).
 */
export function useAgentPictures(agentId: string, ids: readonly string[]): AgentPictures {
  const acts = useHostActs();
  const client = useQueryClient();
  const count = usePictureShownCount(PRODUCT_PICTURE_KIND.AGENT);
  const { data: accountId } = useQuery({ ...appStateQuery, select: selectAccountId });

  const keyOf = (pictureId: string) =>
    [AGENT_PICTURE_QUERY, accountId, agentId, pictureId] as const;

  const sourceOf = (pictureId: string, renew: boolean) => () =>
    acts[ACT_KIND.ACCOUNT_PICTURE_SOURCE]({
      owner: PICTURE_OWNER.AGENT,
      agentId,
      pictureId,
      ...(renew ? { renew: true } : undefined),
    });

  const reads = useQueries({
    queries: ids.map((pictureId) => ({
      queryKey: keyOf(pictureId),
      queryFn: sourceOf(pictureId, false),
      enabled: accountId !== undefined,
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });

  // Note that each picture is renewed once and counted once, and timed from when it was first asked for, held apart from what the queries keep.
  const held = useRef({
    renewed: new Set<string>(),
    counted: new Set<string>(),
    askedAt: new Map<string, number>(),
    byUri: new Map<string, string>(),
  });

  const sources = new Map<string, PictureSource | null>();

  ids.forEach((pictureId, at) => {
    const read = reads[at];
    const source = drawnFrom(read?.data, read?.isError === true);

    if (source !== undefined) sources.set(pictureId, source);
  });

  // Note that each picture the loader reads from the service is read ahead as its source lands, and each is timed from when the page first asked for it.
  useEffect(() => {
    const now = performance.now();

    ids.forEach((pictureId, at) => {
      if (!held.current.askedAt.has(pictureId)) held.current.askedAt.set(pictureId, now);
      const view = reads[at]?.data;

      if (view === undefined || "failure" in view || held.current.byUri.has(view.uri)) return;
      held.current.byUri.set(view.uri, pictureId);

      if (view.headers !== undefined) {
        void Image.prefetch([view.uri], {
          cachePolicy: "memory-disk",
          headers: { ...view.headers },
        });
      }
    });
  });

  const events = useMemo<PictureEvents>(
    () => ({
      shown: (uri, cache) => {
        const pictureId = held.current.byUri.get(uri);
        const askedAt = pictureId === undefined ? undefined : held.current.askedAt.get(pictureId);

        if (
          pictureId === undefined ||
          askedAt === undefined ||
          held.current.counted.has(pictureId)
        ) {
          return;
        }

        held.current.counted.add(pictureId);
        count(
          cache === PICTURE_CACHE.NONE
            ? PRODUCT_PICTURE_FROM.DOWNLOADED
            : PRODUCT_PICTURE_FROM.KEPT,
          askedAt,
        );
      },
      // Note that a picture the loader could not read is asked for once more under a renewed header, and stands failed after that.
      failed: (uri) => {
        const pictureId = held.current.byUri.get(uri);

        if (pictureId === undefined) return;
        const key = [AGENT_PICTURE_QUERY, accountId, agentId, pictureId] as const;

        if (held.current.renewed.has(pictureId)) {
          client.setQueryData(key, UNREAD);

          return;
        }

        held.current.renewed.add(pictureId);
        void client.fetchQuery({
          queryKey: key,
          queryFn: () =>
            acts[ACT_KIND.ACCOUNT_PICTURE_SOURCE]({
              owner: PICTURE_OWNER.AGENT,
              agentId,
              pictureId,
              renew: true,
            }),
          staleTime: 0,
        });
      },
    }),
    [acts, accountId, agentId, client, count],
  );

  const retry = (pictureId: string) => {
    held.current.renewed.delete(pictureId);
    void client.resetQueries({ queryKey: keyOf(pictureId) });
  };

  return { sources, events, retry };
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
  const { data: accountId } = useQuery({ ...appStateQuery, select: selectAccountId });

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
