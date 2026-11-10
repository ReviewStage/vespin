import { ENTITY_KIND, type EntityKind } from "@repo/features/entity-kind";
import { ProductMark } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";

/**
 * entity-glyph.tsx -- the one glyph each kind of entity is drawn with where nothing of the entity itself is known: a kind's row, a group's heading, a place in the sidebar, a mark's fallback.
 *
 * An entity that is known wears its mark (`entity-mark.tsx`): a task its
 * status, an agent its harness, a person their face. Where only its kind
 * is, as a list of kinds to browse, the sidebar's places, or a mark whose
 * entity is still being read, it wears this, so a task's kind and a task
 * whose status is not yet known look alike everywhere, and never like the
 * description's document. The table is keyed by `ENTITY_KIND` with no
 * default, so a kind added there fails to compile until it has its glyph,
 * and each drawing is the registry's (`GLYPH`), so one meaning keeps one
 * drawing across the app.
 */

/** Each kind's glyph. */
const ENTITY_GLYPH: { readonly [K in EntityKind]: () => React.JSX.Element } = {
  [ENTITY_KIND.PLAN]: GLYPH.TASK,
  [ENTITY_KIND.SECTION]: GLYPH.HEADING,
  [ENTITY_KIND.VERSION]: GLYPH.VERSION_CHANGES,
  [ENTITY_KIND.COMMENT]: GLYPH.COMMENT,
  [ENTITY_KIND.PAGE]: GLYPH.PAGE,
  [ENTITY_KIND.AGENT]: GLYPH.AGENT,
  [ENTITY_KIND.WORKER]: GLYPH.AGENT,
  // Note that the app's own mark is its glyph; its chip wears the app's tile, a face, as a person's wears theirs.
  [ENTITY_KIND.APP]: () => <ProductMark glyph />,
  [ENTITY_KIND.CHANGES]: GLYPH.PULL_REQUEST_CHANGES,
  [ENTITY_KIND.PULL_REQUEST]: GLYPH.PULL_REQUEST,
  [ENTITY_KIND.PULL_REQUEST_THREAD]: GLYPH.COMMENT,
  [ENTITY_KIND.ISSUE]: GLYPH.ISSUE,
  [ENTITY_KIND.LINK]: GLYPH.WEBSITE,
  // Note that a message of an agent's is a comment's drawing, as its chip has always worn it.
  [ENTITY_KIND.MESSAGE]: GLYPH.COMMENT,
  [ENTITY_KIND.HOME]: GLYPH.HOME,
  [ENTITY_KIND.BOARD]: GLYPH.TASK,
  [ENTITY_KIND.INBOX]: GLYPH.INBOX,
  [ENTITY_KIND.INBOX_ITEM]: GLYPH.THREAD,
  [ENTITY_KIND.AUTOMATIONS]: GLYPH.AUTOMATION,
  [ENTITY_KIND.AUTOMATION]: GLYPH.AUTOMATION,
  [ENTITY_KIND.AUTOMATION_RUN]: GLYPH.AUTOMATION,
  [ENTITY_KIND.SETTINGS]: GLYPH.SETTINGS,
  [ENTITY_KIND.PERSON]: GLYPH.PERSON,
  [ENTITY_KIND.ADMIN]: GLYPH.ADMIN,
  [ENTITY_KIND.FILE]: GLYPH.FILE,
  [ENTITY_KIND.FOLDER]: GLYPH.FOLDER,
  [ENTITY_KIND.SERVER]: GLYPH.MCP_SERVER,
  [ENTITY_KIND.TOOL]: GLYPH.MCP_SERVER,
  [ENTITY_KIND.SKILL]: GLYPH.SKILL,
  [ENTITY_KIND.REPOSITORY]: GLYPH.REPOSITORY,
  [ENTITY_KIND.WORKSPACE]: GLYPH.WORKSPACE,
  [ENTITY_KIND.DATE]: GLYPH.DATE,
};

/** The glyph of an entity of `kind` where nothing more of it is known. */
export function EntityGlyph({ kind }: { kind: EntityKind }): React.JSX.Element {
  const Glyph = ENTITY_GLYPH[kind];
  return <Glyph />;
}
