import { drawnDark, onDrawnThemeChange } from "@repo/ui/appearance";
import {
  DIAGRAM_APPEARANCE,
  DIAGRAM_DRAWING,
  type DiagramAppearance,
  type DiagramDrawing,
  type DiagramModule,
} from "@repo/ui/diagram-contract";
import { useQuery } from "@tanstack/react-query";
import { createStore, useSelector } from "@tanstack/react-store";
import { useEffect, useSyncExternalStore } from "react";
import { useSideBundles } from "./bundle-loader.js";

/**
 * diagram-drawing.ts -- a Mermaid code drawn as its picture in the window's appearance: the diagram bundle loaded the first time one is drawn, and each picture kept by its appearance and code.
 *
 * A description's fence (`description-diagram.tsx`) and a Mermaid file opened in the file
 * viewer (`tasks/attachment-viewer.tsx`) draw through this one cache, so a
 * diagram shown in both is drawn once.
 */

/** How many pictures the window keeps in each appearance, the oldest let go first; enough for every diagram in a description, and the drafts the editor's preview drew. */
const HELD_PICTURES = 64;

/**
 * Each drawing the window holds, by appearance and then by code, oldest
 * first; a drawing landing writes a new map, so each figure waiting on it
 * draws again.
 */
const drawnStore = createStore<ReadonlyMap<DiagramAppearance, ReadonlyMap<string, DiagramDrawing>>>(
  new Map(),
);

/** Each draw still running, by appearance and then by code, which a second figure of the same code joins. */
const drawing = new Map<DiagramAppearance, Map<string, Promise<DiagramDrawing>>>();

/** A drawing kept, as the newest, the oldest past the bound let go. */
function keep(appearance: DiagramAppearance, code: string, answer: DiagramDrawing): void {
  drawnStore.setState((now) => {
    const held = new Map(now.get(appearance));
    held.delete(code);
    held.set(code, answer);
    const oldest = held.keys().next();

    if (held.size > HELD_PICTURES && oldest.done !== true) held.delete(oldest.value);

    return new Map(now).set(appearance, held);
  });
}

/** A code drawn in an appearance, joining the draw already running for it; a draw that fails answers a refusal, never a rejection (`DiagramModule`). */
function drawnBy(
  module: DiagramModule,
  appearance: DiagramAppearance,
  code: string,
): Promise<DiagramDrawing> {
  const running = drawing.get(appearance)?.get(code);

  if (running !== undefined) return running;
  const pending = drawing.get(appearance) ?? new Map<string, Promise<DiagramDrawing>>();
  drawing.set(appearance, pending);

  const answer = module.draw(code, appearance).then((settled) => {
    keep(appearance, code, settled);
    pending.delete(code);

    return settled;
  });

  pending.set(code, answer);

  return answer;
}

/** The window's appearance now. */
function appearanceNow(): DiagramAppearance {
  return drawnDark() ? DIAGRAM_APPEARANCE.DARK : DIAGRAM_APPEARANCE.LIGHT;
}

/** Calls back each time the window's appearance flips; answers what stops it. */
function onAppearance(changed: () => void): () => void {
  return onDrawnThemeChange(changed);
}

/** The window's appearance, kept as it flips. */
export function useAppearance(): DiagramAppearance {
  return useSyncExternalStore(onAppearance, appearanceNow, appearanceNow);
}

type UseDrawingResult = {
  readonly drawing: DiagramDrawing | undefined;
  readonly retry: (() => void) | undefined;
};

/**
 * A code's drawing in the window's appearance: the one held, or nothing
 * while the bundle loads and the draw runs, which then lands. A bundle that
 * could not load refuses every code, so each fence stands as its code, with
 * the `retry` that imports the bundle again; a fence the bundle itself
 * refused has none, since drawing it again would refuse it again. No code,
 * as where a viewer shows a file that is no diagram, draws nothing and
 * imports no bundle.
 */
export function useDrawing(
  code: string | undefined,
  appearance: DiagramAppearance,
): UseDrawingResult {
  const { diagram } = useSideBundles();
  // Note that a drawer of no code reads nothing, so a surface that may draw a diagram imports Mermaid only once it does.
  const bundle = useQuery({ ...diagram, enabled: code !== undefined });
  const retryBundle = () => void bundle.refetch();
  const module = bundle.data;

  const held = useSelector(drawnStore, (now) =>
    code === undefined ? undefined : now.get(appearance)?.get(code),
  );

  useEffect(() => {
    if (code === undefined || held !== undefined || module === undefined) return;
    void drawnBy(module, appearance, code);
  }, [held, module, appearance, code]);

  if (code === undefined) return { drawing: undefined, retry: undefined };

  if (held !== undefined) return { drawing: held, retry: undefined };

  return bundle.isError
    ? { drawing: { kind: DIAGRAM_DRAWING.REFUSED }, retry: retryBundle }
    : { drawing: undefined, retry: undefined };
}
