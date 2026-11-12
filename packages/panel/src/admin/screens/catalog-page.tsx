/**
 * catalog-page.tsx -- a page drawn from the admin catalog alone: its read, its gate, and its frame, for the Tools and Prompts screens.
 *
 * The catalog is the deploy's own code, the same for every scope and window,
 * so these pages offer no view options; the read still runs behind the
 * admin gate, which refuses a reader who is no admin as every admin read does.
 */

import type { AdminCatalog } from "@repo/features/admin-catalog-wire";
import { readFailedWords } from "@repo/features/words";
import { useQuery } from "@tanstack/react-query";
import { useAdminDoors } from "../admin-doors.js";
import { adminCatalogQuery, useAdminSignOut } from "../admin-queries.js";
import { adminReadView } from "../admin-read-view.js";
import { AdminPage, type ViewerAccount } from "../chrome/page-header.js";
import { PageSkeleton } from "../chrome/page-skeleton.js";

/** What the page says it covers beside its title: this deploy, whatever window the others hold. */
const CATALOG_NOTE = "This deploy";

const CATALOG_ERROR = readFailedWords("catalog");

export function CatalogPage({
  title,
  account,
  onSignOut,
  frame,
  sections,
}: {
  title: string;
  account: ViewerAccount | undefined;
  onSignOut: () => Promise<void>;
  /** Applied around every answer but the gate's own cards, which stand alone. */
  frame: (content: React.JSX.Element) => React.JSX.Element;
  /** The page's sections, from the catalog once it is read and as their skeletons until then. */
  sections: (catalog: AdminCatalog | undefined) => React.JSX.Element;
}): React.JSX.Element {
  const { reads, gate } = useAdminDoors();
  const read = useQuery({ ...adminCatalogQuery(reads), enabled: !gate.heldAtGate() });
  const withdraw = useAdminSignOut(onSignOut);
  const signOut = () => withdraw.mutate();

  return adminReadView({
    read,
    gate,
    email: account?.email,
    onSignOut: signOut,
    failure: CATALOG_ERROR,
    loading: () =>
      frame(
        <PageSkeleton title={title} note={CATALOG_NOTE} controls={null}>
          {sections(undefined)}
        </PageSkeleton>,
      ),
    failed: (error) =>
      frame(
        <AdminPage title={title} note={CATALOG_NOTE} controls={null}>
          {error}
        </AdminPage>,
      ),
    ready: (catalog, refreshed) =>
      frame(
        <AdminPage title={title} note={CATALOG_NOTE} controls={null}>
          {refreshed(sections(catalog))}
        </AdminPage>,
      ),
  });
}
