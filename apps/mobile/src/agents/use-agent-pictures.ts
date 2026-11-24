/**
 * use-agent-pictures.ts -- what each picture an agent showed is drawn from: the service's address and the header its read carries, which expo-image downloads, caches, and decodes itself, asked of the host once a picture, read ahead for the rows about to scroll in, and tried once more under a renewed header where the service refused it.
 *
 * The host answers where a picture stands (`ACCOUNT_PICTURE_SOURCE`); the
 * transcript hands it to expo-image's own view, which keeps the picture in
 * memory and on disk under its address, which names it by its ids alone. A
 * fixture run's picture is its own `data:` address. Note that the header
 * goes to the loader's source alone, never to a log, a report, or a counted
 * event; and that each picture is counted once as it first draws
 * (`picture:shown`), as kept where the loader had it and downloaded where it
 * read it now.
 */

import { PRODUCT_PICTURE_FROM, PRODUCT_PICTURE_KIND } from "@repo/features/analytics";
import { PICTURE_OWNER } from "@repo/features/picture-source-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  PICTURE_CACHE,
  type PictureEvents,
  type PictureSource,
  type RemotePicture,
} from "@repo/ui-native";
import { Image } from "expo-image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useHostActs } from "../host/host-provider.js";
import { usePictureShownCount } from "../picture-shown.js";

/** No picture asked for yet, held as one value so a page that holds none reads the same each time. */
const NO_SOURCES: ReadonlyMap<string, PictureSource | null> = new Map();

/** What an agent's pictures are drawn from, by id, what the page's pictures tell as they draw, and what reads one that failed again. */
export interface AgentPictures {
  /** What each picture is drawn from, by its id; none while it is asked for, and `null` where it could not be read. */
  readonly sources: ReadonlyMap<string, PictureSource | null>;
  readonly events: PictureEvents;
  readonly retry: (pictureId: string) => void;
}

/** One picture asked for: when, and whether its header was renewed after a refusal. */
interface Asked {
  readonly at: number;
  renewed: boolean;
  counted: boolean;
}

/** The pictures of the agent's page as one page holds them: each asked for, by id, and each id by the address its source names. */
interface Standing {
  readonly agentId: string;
  readonly asked: Map<string, Asked>;
  readonly byUri: Map<string, string>;
}

/** Reads ahead every picture the loader reads from the service, under the header each carries, so a row scrolled in draws from its cache. */
function readAhead(sources: readonly RemotePicture[]): void {
  for (const source of sources) {
    void Image.prefetch([source.uri], {
      cachePolicy: "memory-disk",
      ...(source.headers === undefined ? undefined : { headers: { ...source.headers } }),
    });
  }
}

/**
 * What each picture the agent showed, among `ids`, is drawn from: asked of
 * the host once while the agent's page stands, and read ahead by the loader
 * as it lands, so the rows about to scroll in draw from its cache. A picture
 * the loader could not read is asked for once more under a renewed header,
 * as the account's calls retry a 401, and stands failed with Try again
 * after that (`retry`).
 */
export function useAgentPictures(agentId: string, ids: readonly string[]): AgentPictures {
  const acts = useHostActs();
  const count = usePictureShownCount(PRODUCT_PICTURE_KIND.AGENT);

  const [shown, setShown] = useState<{
    readonly agentId: string;
    readonly sources: ReadonlyMap<string, PictureSource | null>;
  }>({ agentId, sources: new Map() });

  const standing = useRef<Standing>({ agentId, asked: new Map(), byUri: new Map() });

  // Note that another agent's page starts its own asks afresh, before any of its pictures is asked for below.
  useEffect(() => {
    if (standing.current.agentId !== agentId) {
      standing.current = { agentId, asked: new Map(), byUri: new Map() };
    }
  }, [agentId]);

  // Each source standing for the agent, `source` for an id, or none to ask it again.
  const stand = (owner: string, pictureId: string, source: PictureSource | null | undefined) =>
    setShown((held) => {
      if (owner !== standing.current.agentId) return held;
      const sources = new Map(held.agentId === owner ? held.sources : undefined);

      if (source === undefined) sources.delete(pictureId);
      else sources.set(pictureId, source);

      return { agentId: owner, sources };
    });

  // Asks the host where one picture stands, renewed first where `renew`, and stands what it answers.
  const ask = (owner: string, pictureId: string, renew: boolean) =>
    acts[ACT_KIND.ACCOUNT_PICTURE_SOURCE]({
      owner: PICTURE_OWNER.AGENT,
      agentId: owner,
      pictureId,
      ...(renew ? { renew: true } : undefined),
    }).then(
      (answer) => {
        if ("failure" in answer) {
          stand(owner, pictureId, null);

          return;
        }

        standing.current.byUri.set(answer.uri, pictureId);
        const source: PictureSource = answer.headers === undefined ? answer.uri : answer;
        stand(owner, pictureId, source);

        if (answer.headers !== undefined) readAhead([answer]);
      },
      (cause: unknown) => {
        console.error("Where a picture the agent showed stands was not read.", cause);
        stand(owner, pictureId, null);
      },
    );

  useEffect(() => {
    const { asked } = standing.current;

    for (const pictureId of ids) {
      if (asked.has(pictureId)) continue;
      asked.set(pictureId, { at: performance.now(), renewed: false, counted: false });
      void ask(agentId, pictureId, false);
    }
    // Note that `ask` reads the page's own holder, so the read follows the ids and the agent alone.
  }, [agentId, ids]);

  const events = useMemo<PictureEvents>(
    () => ({
      shown: (uri, cache) => {
        const pictureId = standing.current.byUri.get(uri);
        const asked = pictureId === undefined ? undefined : standing.current.asked.get(pictureId);

        if (asked === undefined || asked.counted) return;
        asked.counted = true;

        count(
          cache === PICTURE_CACHE.NONE
            ? PRODUCT_PICTURE_FROM.DOWNLOADED
            : PRODUCT_PICTURE_FROM.KEPT,
          asked.at,
        );
      },
      // Note that a picture the loader could not read is asked for once more under a renewed header, and stands failed after that.
      failed: (uri) => {
        const owner = standing.current.agentId;
        const pictureId = standing.current.byUri.get(uri);
        const asked = pictureId === undefined ? undefined : standing.current.asked.get(pictureId);

        if (pictureId === undefined || asked === undefined) return;

        if (asked.renewed) {
          stand(owner, pictureId, null);

          return;
        }

        asked.renewed = true;
        void ask(owner, pictureId, true);
      },
    }),
    [count],
  );

  const retry = (pictureId: string) => {
    const owner = standing.current.agentId;
    standing.current.asked.set(pictureId, {
      at: performance.now(),
      renewed: false,
      counted: false,
    });
    stand(owner, pictureId, undefined);
    void ask(owner, pictureId, false);
  };

  return { sources: shown.agentId === agentId ? shown.sources : NO_SOURCES, events, retry };
}
