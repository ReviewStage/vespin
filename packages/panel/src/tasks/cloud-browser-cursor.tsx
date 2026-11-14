/**
 * cloud-browser-cursor.tsx -- the agent's pointer over a cloud Browser tab's live view: an arrow the panel draws over the page, never in it, gliding to each point the agent clicks or types at.
 *
 * The agent's actions report each point a beat before their input lands
 * (`@repo/features/browser-agent-cdp`'s `BROWSER_CURSOR_BEAT`), in the page's
 * CSS pixels of its visible area, and the tab's live read carries the last
 * one (`AgentBrowserTab.cursor`). It is drawn as `@repo/ui`'s `AgentPointer`
 * at that point's share of the page, which glides there about the beat, so
 * it arrives as the action lands, in the dark mode's brighter amber over a
 * dark page (`onDarkPage`). It fades once the agent has done nothing for
 * `CLOUD_BROWSER_CURSOR_IDLE`, timed on the renderer's runtime, and back in
 * on its next move, and is hidden while a member drives the tab, since the
 * pointer is theirs then.
 *
 * The arrow is no part of the frame the canvas draws; a point and a kind
 * are no page content.
 */

import type { AgentBrowserTabCursor } from "@repo/features/agent-browser-tab-wire";
import { AGENT_POINTER_GROUND, AgentPointer, forkEffect } from "@repo/ui";
import { useCreateStore, useSelector } from "@tanstack/react-store";
import { Clock, Duration, Effect } from "effect";
import { useEffect } from "react";

/** How long after the agent last acted on the tab its pointer stands; past it the pointer fades. */
const CLOUD_BROWSER_CURSOR_IDLE = Duration.seconds(4);

/** The drawn page's size in CSS pixels of the panel. */
interface CloudBrowserCursorFrame {
  readonly width: number;
  readonly height: number;
}

/** Where the pointer stands on the drawn page: its point scaled from the page's visible area onto the frame; none where either has no size. */
export function cursorPlacement(
  cursor: AgentBrowserTabCursor,
  frame: CloudBrowserCursorFrame,
): { readonly x: number; readonly y: number } | undefined {
  const { width, height } = cursor.viewport;

  if (width < 1 || height < 1 || frame.width < 1 || frame.height < 1) return undefined;
  const clamp = (value: number, most: number) => Math.max(0, Math.min(most, value));

  return {
    x: clamp((cursor.x / width) * frame.width, frame.width),
    y: clamp((cursor.y / height) * frame.height, frame.height),
  };
}

/** Settles once the agent has stood idle past the bound since `activeAt`, at once where it already has. */
function idleSince(activeAt: number): Effect.Effect<void> {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const left = activeAt + Duration.toMillis(CLOUD_BROWSER_CURSOR_IDLE) - now;

    if (left > 0) yield* Effect.sleep(Duration.millis(left));
  });
}

/**
 * Whether the agent has stood idle on the tab past the bound since
 * `activeAt`, in epoch milliseconds. Note that the store holds the moment
 * the wait settled for, so a newer act reads as active at once, before its
 * own wait is forked.
 */
function useIdle(activeAt: number): boolean {
  const idleFor = useCreateStore<number | undefined>(undefined);
  useEffect(
    () =>
      forkEffect(
        Effect.andThen(
          idleSince(activeAt),
          Effect.sync(() => idleFor.setState(() => activeAt)),
        ),
      ),
    [activeAt, idleFor],
  );

  return useSelector(idleFor) === activeAt;
}

/** The agent's pointer, drawn over the page, hidden where `hidden`: while a member drives the tab, or no page stands. */
export function CloudBrowserCursor({
  cursor,
  lastActedAt,
  hidden,
  onDarkPage,
}: {
  cursor: AgentBrowserTabCursor | undefined;
  /** Epoch milliseconds the agent last acted on the tab. */
  lastActedAt: number;
  hidden: boolean;
  /** Whether the page is dark where the pointer stands, which draws it lighter. */
  onDarkPage: boolean;
}): React.JSX.Element | null {
  const idle = useIdle(Math.max(lastActedAt, cursor?.at ?? 0));

  if (cursor === undefined) return null;
  const { width, height } = cursor.viewport;

  if (width < 1 || height < 1) return null;

  return (
    <AgentPointer
      x={cursor.x / width}
      y={cursor.y / height}
      kind={cursor.kind}
      move={cursor.at}
      shown={!hidden && !idle}
      ground={onDarkPage ? AGENT_POINTER_GROUND.DARK : AGENT_POINTER_GROUND.LIGHT}
    />
  );
}
