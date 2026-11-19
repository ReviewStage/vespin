// chip-mark-model.ts -- which mark a chip leads with for the entity it names, from what the app holds of it, as the panel's `entity-mark.tsx` reads it.

import { ENTITY_KIND, type Entity } from "@repo/features/entity-kind";
import {
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
} from "@repo/features/integration-wire";
import { providerOf } from "@repo/features/model-label";
import type { ModelProvider } from "@repo/features/models-wire";
import { TASK_STATUS_TONE } from "@repo/features/task-standing-words";
import type { TaskStatus } from "@repo/features/task-wire";
import type { Glyph } from "./glyph.js";
import { STATUS_MARK_SYMBOL } from "./status-mark-model.js";
import type { StatusTone } from "./tokens/status-tone.js";
import type { SwitcherWorkspace } from "./workspace-tile.js";

/** The kinds of mark a chip may lead with beyond its kind's own glyph. */
export const CHIP_MARK = {
  /** A glyph in a tone, such as a task's status ring. */
  GLYPH: "glyph",
  /** A person's photo, or their letters where none is held. */
  FACE: "face",
  /** The mark of the harness an agent runs in. */
  HARNESS: "harness",
  /** A workspace's tile. */
  TILE: "tile",
  /** The mark of the integration a link's page is on, as the desktop draws it. */
  PROVIDER: "provider",
} as const;

/** What a chip leads with for the entity it names, where the app holds it. */
export type ChipMark =
  | { readonly kind: typeof CHIP_MARK.GLYPH; readonly glyph: Glyph; readonly tone: StatusTone }
  | {
      readonly kind: typeof CHIP_MARK.FACE;
      readonly name: string;
      readonly picture?: string | undefined;
    }
  | { readonly kind: typeof CHIP_MARK.HARNESS; readonly harness: ModelProvider }
  | { readonly kind: typeof CHIP_MARK.TILE; readonly workspace: SwitcherWorkspace }
  | { readonly kind: typeof CHIP_MARK.PROVIDER; readonly provider: IntegrationProvider };

/** An entity's mark by what the app holds of it; none where it holds nothing, which leaves the chip its kind's glyph. */
export type ChipMarkOf = (entity: Entity) => ChipMark | undefined;

/** What the app holds that a chip's mark is read from, each by the id an entity names it by; none for what it doesn't hold. */
export interface ChipMarksHeld {
  readonly taskStatus: (taskId: string) => TaskStatus | undefined;
  /** The catalog id of the model an agent runs on, which its harness is read off. */
  readonly agentModel: (agentId: string) => string | undefined;
  readonly member: (
    userId: string,
  ) => { readonly name: string; readonly picture: string | undefined } | undefined;
  /** A workspace by its slug, a former one included, as its tile draws it. */
  readonly workspace: (slug: string) => SwitcherWorkspace | undefined;
}

/** A task's status ring in its tone, as its row draws it; none while its status is unread. */
function taskMark(status: TaskStatus | undefined): ChipMark | undefined {
  return status === undefined
    ? undefined
    : { kind: CHIP_MARK.GLYPH, glyph: STATUS_MARK_SYMBOL[status], tone: TASK_STATUS_TONE[status] };
}

/** Whether a well-known site is one of the integrations, as Gmail, Google Calendar and Google Drive are, whose mark it wears. */
function isProvider(site: string): site is IntegrationProvider {
  return INTEGRATION_PROVIDER_LIST.some((provider) => provider === site);
}

/**
 * The mark a link's chip leads with, as the panel's leads it with its
 * provider's or its site's (`ProviderMark`): an integration's page its
 * provider's, and a well-known site's page its site's where the site is an
 * integration too; none for any other site, whose mark the app's catalog
 * holds no image of yet, which keeps the link's glyph.
 */
function linkMark(link: Extract<Entity, { readonly kind: typeof ENTITY_KIND.LINK }>) {
  const provider = "site" in link ? link.site : link.provider;

  return isProvider(provider) ? { kind: CHIP_MARK.PROVIDER, provider } : undefined;
}

/**
 * The mark a chip leads with for `entity`, as the panel's chip does: a task
 * (or a version of its description) its status ring in its tone, an agent
 * its harness's mark, a person their face, a workspace its tile, and a
 * link its provider's mark (`linkMark`). Every other kind, and any the app holds
 * nothing of, keeps its kind's own glyph.
 */
export function chipMarkOf(entity: Entity, held: ChipMarksHeld): ChipMark | undefined {
  switch (entity.kind) {
    case ENTITY_KIND.PLAN:
      return taskMark(held.taskStatus(entity.taskId));
    case ENTITY_KIND.VERSION:
      return taskMark(held.taskStatus(entity.taskId));
    case ENTITY_KIND.AGENT: {
      const model = held.agentModel(entity.agentId);
      const harness = model === undefined ? undefined : providerOf(model);

      return harness === undefined ? undefined : { kind: CHIP_MARK.HARNESS, harness };
    }

    case ENTITY_KIND.PERSON: {
      const member = held.member(entity.userId);

      return member === undefined ? undefined : { kind: CHIP_MARK.FACE, ...member };
    }

    case ENTITY_KIND.LINK:
      return linkMark(entity);
    case ENTITY_KIND.WORKSPACE: {
      const workspace = held.workspace(entity.workspace);

      return workspace === undefined ? undefined : { kind: CHIP_MARK.TILE, workspace };
    }

    default:
      return undefined;
  }
}
