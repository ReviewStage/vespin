// entity-glyph.ts -- the glyph each kind of entity leads its chip with, which a mention's chip in Markdown and a pill in the words alike draw.

import { ENTITY_KIND, type EntityKind } from "@repo/features/entity-kind";
import { GLYPH, type Glyph } from "./glyph.js";

/**
 * The glyph each kind of entity leads its chip with, as the panel's
 * `entity-mark.tsx` gives each kind its own Lucide glyph; a person, the app,
 * and an MCP server or tool, which the panel marks with a face or a mark of
 * its own, lead with SF Symbols' nearest.
 */
export const ENTITY_GLYPH: Readonly<Record<EntityKind, Glyph>> = {
  [ENTITY_KIND.PLAN]: GLYPH.TASK,
  [ENTITY_KIND.SECTION]: GLYPH.HEADING,
  [ENTITY_KIND.VERSION]: GLYPH.TASK,
  [ENTITY_KIND.COMMENT]: GLYPH.COMMENT,
  [ENTITY_KIND.PAGE]: GLYPH.PAGE,
  [ENTITY_KIND.AGENT]: GLYPH.AGENT,
  [ENTITY_KIND.WORKER]: GLYPH.AGENT,
  [ENTITY_KIND.APP]: GLYPH.APP,
  [ENTITY_KIND.CHANGES]: GLYPH.CHANGES,
  [ENTITY_KIND.PULL_REQUEST]: GLYPH.PULL_REQUEST,
  [ENTITY_KIND.PULL_REQUEST_THREAD]: GLYPH.COMMENT,
  [ENTITY_KIND.ISSUE]: GLYPH.ISSUE,
  [ENTITY_KIND.LINK]: GLYPH.GLOBE,
  [ENTITY_KIND.MESSAGE]: GLYPH.COMMENT,
  [ENTITY_KIND.HOME]: GLYPH.HOME,
  [ENTITY_KIND.BOARD]: GLYPH.TASK,
  [ENTITY_KIND.INBOX]: GLYPH.INBOX,
  [ENTITY_KIND.INBOX_ITEM]: GLYPH.INBOX,
  [ENTITY_KIND.AUTOMATIONS]: GLYPH.AUTOMATION,
  [ENTITY_KIND.AUTOMATION]: GLYPH.AUTOMATION,
  [ENTITY_KIND.AUTOMATION_RUN]: GLYPH.AUTOMATION,
  [ENTITY_KIND.SETTINGS]: GLYPH.SETTINGS,
  [ENTITY_KIND.PERSON]: GLYPH.FACE,
  [ENTITY_KIND.ADMIN]: GLYPH.ADMIN,
  [ENTITY_KIND.FILE]: GLYPH.FILE,
  [ENTITY_KIND.FOLDER]: GLYPH.FOLDER,
  [ENTITY_KIND.SERVER]: GLYPH.MCP_SERVER,
  [ENTITY_KIND.TOOL]: GLYPH.MCP_TOOL,
  [ENTITY_KIND.SKILL]: GLYPH.SKILL,
  [ENTITY_KIND.REPOSITORY]: GLYPH.REPOSITORY,
  [ENTITY_KIND.WORKSPACE]: GLYPH.WORKSPACE,
  [ENTITY_KIND.DATE]: GLYPH.DATE,
  // Note that an app on a Mac is never read from the phone, so it wears an app's shape rather than its icon.
  [ENTITY_KIND.MAC_APP]: GLYPH.APP,
  [ENTITY_KIND.COMPUTER]: GLYPH.COMPUTER_USE,
  // Note that a machine's link names its id alone, and the phone reads no machine for its platform, so it wears a Mac's shape.
  [ENTITY_KIND.MACHINE]: GLYPH.MAC,
};
