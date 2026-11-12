/**
 * catalog-page.tsx -- a page drawn from the admin catalog alone: its read, its gate, and its frame, for the Tools and Prompts screens.
 *
 * The catalog is the deploy's own code, the same for every scope and window,
 * so these pages offer no view options; the read still runs behind the
 * admin gate, which refuses a reader who is no admin as every admin read does.
 */

import type { AdminCatalog } from "@repo/features/admin-catalog-wire";
import { readFailedWords } from "@repo/features/words";
import {
  CodeCard,
  DIALOG_SIZE,
  Dialog,
  DialogActions,
  Fact,
  Facts,
  GAP,
  Stack,
  Text,
} from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { copyThroughShell } from "../../copy-feedback.js";
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

/** One block of a detail's text: what it is, and its words. */
export interface CatalogDetailBlock {
  title: string;
  code: string;
}

/** What a detail dialog shows of the row pressed: its facts by name, its prose, and its blocks of code. */
export interface CatalogDetail {
  title: string;
  facts: readonly { label: string; value: React.ReactNode }[];
  prose?: string | undefined;
  blocks: readonly CatalogDetailBlock[];
}

/**
 * The row a table opened, held through the dialog's fade out so its words
 * stay while it goes: `open` presses a row, `close` puts the dialog away.
 */
export function useCatalogDetail<Row>() {
  const [shown, setShown] = useState<Row | undefined>(undefined);
  const [open, setOpen] = useState(false);

  return {
    shown,
    open,
    show: (row: Row) => {
      setShown(row);
      setOpen(true);
    },
    close: () => setOpen(false),
    exited: () => setShown(undefined),
  };
}

/** A pressed row's detail over the page: its facts, then its text, each block with its Copy. */
export function CatalogDetailDialog({
  detail,
  open,
  onClose,
  onExited,
}: {
  detail: CatalogDetail | undefined;
  open: boolean;
  onClose: () => void;
  onExited: () => void;
}): React.JSX.Element | null {
  if (detail === undefined) return null;

  return (
    <Dialog
      open={open}
      title={detail.title}
      size={DIALOG_SIZE.WIDE}
      onDismiss={onClose}
      onExited={onExited}
      actions={<DialogActions onDone={onClose} />}
    >
      <Stack gap={GAP.FIELD}>
        <Facts>
          {detail.facts.map((fact) => (
            <Fact key={fact.label} label={fact.label}>
              {fact.value}
            </Fact>
          ))}
        </Facts>
        {detail.prose === undefined ? null : <Text>{detail.prose}</Text>}
        {detail.blocks.map((block) => (
          <CodeCard
            key={block.title}
            title={block.title}
            code={block.code}
            copy={copyThroughShell}
          />
        ))}
      </Stack>
    </Dialog>
  );
}
