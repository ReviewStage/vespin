import {
  GAP,
  Inline,
  PdfPagesSkeleton,
  SKELETON_KIND,
  Skeleton,
  SkeletonRegion,
  Stack,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * skeletons.tsx -- each shape, lines set in a heading's and the body's type
 * so they stand where those lines will, a list's rows while it is read, and
 * a PDF while pdf.js opens it in the file viewer, one blank page in the
 * column its pages scroll in, each drawn by a `*Skeleton` component, as
 * every skeleton is.
 */

/** How wide each placeholder member's name stands. */
const MEMBER_WIDTHS = ["70%", "45%", "60%"] as const;

/** Each shape, its box the catalog's own size for it. */
function KindsSkeleton(): React.JSX.Element {
  return (
    <Inline gap={GAP.FIELD}>
      <span className="catalog-skeleton-line">
        <Skeleton width="160px" />
      </span>
      <span className="catalog-skeleton-control">
        <Skeleton kind={SKELETON_KIND.CONTROL} />
      </span>
      <Skeleton kind={SKELETON_KIND.CIRCLE} />
      <span className="catalog-skeleton-block">
        <Skeleton kind={SKELETON_KIND.BLOCK} />
      </span>
    </Inline>
  );
}

/** A description's heading over its lines, each block in the type its words will stand in. */
function DescriptionSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label="Reading the description">
      <Stack gap={GAP.TIGHT}>
        <Text variant={TEXT_VARIANT.TITLE} as={TEXT_ELEMENT.DIV}>
          <Skeleton width="55%" />
        </Text>
        <Text as={TEXT_ELEMENT.DIV}>
          <Skeleton />
        </Text>
        <Text as={TEXT_ELEMENT.DIV}>
          <Skeleton width="80%" />
        </Text>
      </Stack>
    </SkeletonRegion>
  );
}

/** A list's rows while it is read, a person's circle before each name. */
function MembersSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label="Reading members">
      <Stack gap={GAP.CONTROL}>
        {MEMBER_WIDTHS.map((width) => (
          <Inline key={width} gap={GAP.ICON} wrap={false}>
            <Skeleton kind={SKELETON_KIND.CIRCLE} width="20px" />
            <div className="catalog-skeleton-grow">
              <Text as={TEXT_ELEMENT.DIV}>
                <Skeleton width={width} />
              </Text>
            </div>
          </Inline>
        ))}
      </Stack>
    </SkeletonRegion>
  );
}

function Skeletons(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="skeleton-shapes" title="Shapes">
        <KindsSkeleton />
      </CatalogSection>
      <CatalogSection id="skeleton-type" title="Lines in their type">
        <div className="catalog-column">
          <DescriptionSkeleton />
        </div>
      </CatalogSection>
      <CatalogSection id="skeleton-rows" title="A list's rows">
        <div className="catalog-narrow">
          <MembersSkeleton />
        </div>
      </CatalogSection>
      <CatalogSection id="skeleton-pdf" title="A PDF opening">
        <div className="catalog-pdf-room">
          <PdfPagesSkeleton label="plan.pdf" />
        </div>
      </CatalogSection>
    </>
  );
}

export const SKELETONS_EXAMPLE: Example = {
  id: "skeletons",
  title: "Skeletons",
  Render: Skeletons,
};
