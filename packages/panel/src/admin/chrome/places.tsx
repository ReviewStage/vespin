/**
 * places.tsx -- the admin's sections, each by its name and glyph: what the
 * sidebar lists, and what a page under one leads back to from its toolbar.
 */

import { ENTITY_KIND } from "@repo/features/entity-kind";
import {
  ActivityIcon,
  Building2Icon,
  CircleDollarSignIcon,
  GaugeIcon,
  LayoutDashboardIcon,
  ReceiptIcon,
  ScrollTextIcon,
  UsersIcon,
  WrenchIcon,
} from "@repo/ui/icons";
import { EntityGlyph } from "../../entities/entity-glyph.js";
import { ADMIN_SECTION_WORDS, ADMIN_TAB, type AdminTab } from "../routing.js";

/** One section: the tab it opens, its name, and its glyph. */
export interface AdminPlace {
  tab: AdminTab;
  label: string;
  icon: React.ReactNode;
}

/** Each section's glyph, by the tab it opens. */
const GLYPH_BY_TAB = {
  [ADMIN_TAB.DASHBOARD]: <LayoutDashboardIcon />,
  [ADMIN_TAB.COST]: <CircleDollarSignIcon />,
  [ADMIN_TAB.BILLING]: <ReceiptIcon />,
  [ADMIN_TAB.RELIABILITY]: <ActivityIcon />,
  [ADMIN_TAB.AGENTS]: <EntityGlyph kind={ENTITY_KIND.AGENT} />,
  [ADMIN_TAB.TOOLS]: <WrenchIcon />,
  [ADMIN_TAB.PROMPTS]: <ScrollTextIcon />,
  [ADMIN_TAB.WORKSPACES]: <Building2Icon />,
  [ADMIN_TAB.USERS]: <UsersIcon />,
  [ADMIN_TAB.LIMITS]: <GaugeIcon />,
} satisfies { readonly [Tab in AdminTab]: React.ReactNode };

/** The sidebar's places, in the order it lists them. */
export const ADMIN_PLACES: readonly AdminPlace[] = Object.values(ADMIN_TAB).map((tab) => ({
  tab,
  label: ADMIN_SECTION_WORDS[tab],
  icon: GLYPH_BY_TAB[tab],
}));

/** The section `tab` opens. */
export function adminPlace(tab: AdminTab): AdminPlace {
  return { tab, label: ADMIN_SECTION_WORDS[tab], icon: GLYPH_BY_TAB[tab] };
}
