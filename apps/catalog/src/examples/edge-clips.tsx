import { EDGE_CLIP_LAYOUT, EdgeClip, TEXT_VARIANT, Text } from "@repo/ui";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * edge-clips.tsx -- what a rounded frame holds, clipped inside its edge:
 * a card's head over a body drawn to its foot's corners, and a thumb's
 * picture filling its shape, each frame's edge whole at every corner.
 */

function EdgeClips(): React.JSX.Element {
  return (
    <CatalogSection id="edge-clip" title="Clipped inside a frame's edge">
      <div className="catalog-edge-frames">
        <div className="catalog-edge-frame">
          <EdgeClip>
            <Text variant={TEXT_VARIANT.SECTION} className="catalog-edge-head">
              A head over a body
            </Text>
            <div className="catalog-edge-body" />
          </EdgeClip>
        </div>
        <div className="catalog-edge-frame catalog-edge-shape">
          <EdgeClip layout={EDGE_CLIP_LAYOUT.FILL}>
            <div className="catalog-edge-body" />
          </EdgeClip>
        </div>
      </div>
    </CatalogSection>
  );
}

export const EDGE_CLIPS_EXAMPLE: Example = {
  id: "edge-clips",
  title: "Edge clips",
  Render: EdgeClips,
};
