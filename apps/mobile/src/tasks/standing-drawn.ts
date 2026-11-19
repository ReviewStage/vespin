// standing-drawn.ts -- counts how long a task's standing chip, its status, priority, or assignee, took to draw the value a press set, once a press, on a rung, as `standing:drawn`.

import {
  PRODUCT_STANDING_FIELD,
  PRODUCT_SURFACE_EVENT,
  type ProductStandingField,
  productDrawnMilliseconds,
} from "@repo/features/analytics";
import type { TaskSummary } from "@repo/features/task-wire";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useHostCount } from "../host/host-provider.js";

/** A value a press set on a chip and not yet seen drawn: when, on `performance.now`'s clock, and the value, an assignee by their id or null for nobody. */
interface Pressed {
  readonly at: number;
  readonly value: string | null;
}

/** Each chip's press not yet counted, by its task's id, then by the chip. */
const pressed = new Map<string, Map<ProductStandingField, Pressed>>();

/** What a task holds on each chip, as a press's value names it. */
function standingOf(task: TaskSummary, field: ProductStandingField): string | null {
  if (field === PRODUCT_STANDING_FIELD.STATUS) return task.status ?? null;

  if (field === PRODUCT_STANDING_FIELD.PRIORITY) return task.priority ?? null;

  return task.assignee?.userId ?? null;
}

/** Notes a press that set `field` of a task to `value`, the moment its wait to draw starts; a newer press on the same chip takes its place. */
export function standingPressed(
  taskId: string,
  field: ProductStandingField,
  value: string | null,
): void {
  const chips = pressed.get(taskId) ?? new Map<ProductStandingField, Pressed>();
  chips.set(field, { at: performance.now(), value });
  pressed.set(taskId, chips);
}

/**
 * Counts, once a press, the time from a standing chip's press to the first
 * frame after the task draws the value it set, as `standing:drawn` with that
 * time on a rung of `productDrawnMilliseconds` and which chip it was, and
 * nothing else: never the value, the task, or who. Note that a press whose
 * value the task never draws, as one the service refused, is let go by the
 * next press on that chip; and that a draw once the app has left the front
 * counts nothing, since its time would hold a wait nobody sat through.
 */
export function useStandingDrawnCount(task: TaskSummary | undefined): void {
  const count = useHostCount();

  useEffect(() => {
    const chips = task === undefined ? undefined : pressed.get(task.id);

    if (task === undefined || chips === undefined) return;

    for (const [field, press] of chips) {
      if (standingOf(task, field) !== press.value) continue;
      chips.delete(field);
      requestAnimationFrame(() => {
        if (AppState.currentState !== "active") return;
        count(PRODUCT_SURFACE_EVENT.STANDING_DRAWN, {
          drawn_ms: productDrawnMilliseconds(performance.now() - press.at),
          standing_field: field,
        });
      });
    }

    if (chips.size === 0) pressed.delete(task.id);
  }, [count, task]);
}
