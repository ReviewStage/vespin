import type { LinkPreviewPicture } from "@repo/features/link-preview-wire";
import { ACT_KIND } from "@repo/host/acts";
import { HoverCard, HoverCardHead, HoverCardNote, HoverCardSkeleton, PageThumb } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { siteName } from "@repo/ui/link-face";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { askAct } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";

/**
 * link-preview-card.tsx -- the card a plain web link hangs: what the page it opens says of itself, read through the service as the card shows.
 *
 * A link the window has no chip for (`../text-link.tsx`) hangs this card
 * where a chip hangs its own: the page's icon and title, its site's name
 * over its host under them, its description as the card's note, and its
 * picture under that, each where the page says one, as a message app
 * unfurls a link. The page is read by the service, never by this window,
 * which loads nothing from a third party: each picture arrives as bytes
 * the card draws from a `data:` URL of its own (`link-preview-wire.ts`).
 * While the read is under way the card stands as its skeleton, a globe
 * and the page's host, and where the page has no preview, an address the
 * service may not read or a page it could not, the card says the host and
 * nothing more, so hovering a link always says where it goes. The read is
 * asked only as the card first shows and kept by the window for a while,
 * so a link hovered again asks nothing.
 */

/** How long a window keeps what it read of a page: a preview for a while, a failure a moment, so a page that was down is asked again soon. */
const PREVIEW_KEPT_MS = {
  PREVIEW: 10 * 60_000,
  NONE: 30_000,
} as const;

/** What parts a site's name from its host under the title. */
const SEPARATOR = " · ";

/** The page's preview, by its address, as the host answers it. */
const linkPreviewQuery = (href: string) =>
  queryOptions({
    queryKey: [QUERY_ROOT.LINK_PREVIEW, href],
    queryFn: () => askAct(ACT_KIND.TASKS_LINK_PREVIEW, { url: href }),
    staleTime: (query) =>
      query.state.data !== undefined && "preview" in query.state.data
        ? PREVIEW_KEPT_MS.PREVIEW
        : PREVIEW_KEPT_MS.NONE,
    retry: false,
  });

/** A picture as the card draws it, from the bytes the service carried. */
function dataUrlOf(picture: LinkPreviewPicture): string {
  return `data:${picture.type};base64,${picture.base64}`;
}

/** The line under the title: the site's name over its host, or the host alone where the page names no site or names it as its host. */
function subOf(host: string, site: string | undefined): string {
  if (site === undefined || site.toLowerCase() === host.toLowerCase()) return host;
  return `${site}${SEPARATOR}${host}`;
}

/** The card a plain link to `href` hangs. */
export function LinkPreviewCard({ href }: { href: string }): React.JSX.Element {
  const host = siteName(href) ?? href;
  const { data, isPending } = useQuery(linkPreviewQuery(href));
  const globe = <GLYPH.WEBSITE />;
  if (isPending) {
    return <HoverCardSkeleton glyph={globe} name={host} sub notes={2} data-link-preview="" />;
  }
  // Note that an ask the port refused, as one that failed, says the host, as a page with no preview does.
  if (data === undefined || !("preview" in data)) {
    return (
      <HoverCard data-link-preview="" data-link-preview-state="none">
        <HoverCardHead glyph={globe} name={host} />
      </HoverCard>
    );
  }
  const { preview } = data;
  const icon =
    preview.icon === undefined ? (
      globe
    ) : (
      <img src={dataUrlOf(preview.icon)} alt="" draggable={false} />
    );
  return (
    <HoverCard data-link-preview="" data-link-preview-state="read">
      <HoverCardHead
        glyph={icon}
        name={preview.title ?? host}
        sub={subOf(host, preview.siteName)}
      />
      {preview.description === undefined ? null : (
        <HoverCardNote>{preview.description}</HoverCardNote>
      )}
      {preview.image === undefined ? null : <PageThumb image={dataUrlOf(preview.image)} />}
    </HoverCard>
  );
}
