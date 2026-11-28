import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  AVATAR_SIZE,
  Avatar,
  ComposeIcon,
  GearIcon,
  IconButton,
  NAV_CURRENT,
  NAV_ITEM_VARIANT,
  NavItem,
  ProductMark,
  SearchIcon,
  SIDEBAR_FOOT_LOOK,
  SidebarAccountRow,
  SidebarFoot,
  SidebarIdentity,
  SidebarPlaces,
  SidebarRail,
  SidebarRule,
} from "@repo/ui";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * sidebar-parts.tsx -- the parts every surface drawing the app's sidebar
 * shares: the app's head, and the same head naming the surface it stands on;
 * the places over their rule; the foot's account row; and the rail, its
 * places as tiles between a head and a foot.
 */

function SidebarParts(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="sidebar-identity" title="Head">
        <div className="catalog-narrow">
          <SidebarIdentity name={PRODUCT_NAME} mark={<ProductMark fill small />} />
        </div>
      </CatalogSection>
      <CatalogSection id="sidebar-identity-qualified" title="Head on a surface of its own">
        <div className="catalog-narrow">
          <SidebarIdentity
            name={PRODUCT_NAME}
            qualifier="Admin"
            mark={<ProductMark fill small />}
          />
        </div>
      </CatalogSection>
      <CatalogSection id="sidebar-places" title="Places over their rule">
        <div className="catalog-narrow">
          <SidebarPlaces label="Places">
            <NavItem icon={<ComposeIcon />}>New task</NavItem>
            <NavItem icon={<SearchIcon />} current={NAV_CURRENT.PAGE}>
              Search
            </NavItem>
          </SidebarPlaces>
          <SidebarRule />
        </div>
      </CatalogSection>
      <CatalogSection id="sidebar-foot" title="Foot">
        <div className="catalog-narrow">
          <SidebarFoot>
            <SidebarAccountRow>
              <NavItem icon={<Avatar name="Ada Lovelace" size={AVATAR_SIZE.ACCOUNT} decorative />}>
                Ada Lovelace
              </NavItem>
              <IconButton icon={<GearIcon />} label="Settings" />
            </SidebarAccountRow>
          </SidebarFoot>
        </div>
      </CatalogSection>
      <CatalogSection id="sidebar-rail" title="Rail of tiles">
        <SidebarRail
          label="Sidebar places"
          head={<Avatar name="Acme" size={AVATAR_SIZE.CARD} decorative />}
          foot={
            <SidebarFoot look={SIDEBAR_FOOT_LOOK.RAIL}>
              <SidebarAccountRow look={SIDEBAR_FOOT_LOOK.RAIL}>
                <IconButton icon={<GearIcon />} label="Settings" />
              </SidebarAccountRow>
            </SidebarFoot>
          }
        >
          <NavItem variant={NAV_ITEM_VARIANT.TILE} hint="Search" icon={<SearchIcon />}>
            Search
          </NavItem>
          <NavItem
            variant={NAV_ITEM_VARIANT.TILE}
            hint="New task"
            icon={<ComposeIcon />}
            current={NAV_CURRENT.PAGE}
            count={{ value: 3, noun: "waiting on you" }}
          >
            New task
          </NavItem>
        </SidebarRail>
      </CatalogSection>
    </>
  );
}

export const SIDEBAR_PARTS_EXAMPLE: Example = {
  id: "sidebar-parts",
  title: "Sidebar parts",
  Render: SidebarParts,
};
