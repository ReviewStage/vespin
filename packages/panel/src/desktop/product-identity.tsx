import { PRODUCT_NAME } from "@repo/features/product-name";
import { ProductMark, SidebarIdentity } from "@repo/ui";
import type { ReactNode } from "react";

/**
 * The product at the head of the sidebar: its mark and its name. The head does
 * not say what the app is doing, and the mark holds still. A surface that is
 * ours but not the app itself, the web's admin dashboard, names itself under
 * its name (`qualifier`), muted, so the head reads as the app's and still says
 * where the reader is. A control may stand at its end (`end`), as the
 * sidebar's New task does until a workspace heads the sidebar.
 */
export function ProductIdentity({
  qualifier,
  end,
}: {
  qualifier?: string | undefined;
  end?: ReactNode;
}): React.JSX.Element {
  return (
    <SidebarIdentity
      name={PRODUCT_NAME}
      qualifier={qualifier}
      mark={<ProductMark fill small />}
      replayUnmasked
      end={end}
    />
  );
}
