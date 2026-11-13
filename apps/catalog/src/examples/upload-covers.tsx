import {
  ATTACHMENT_CHIP_STATE,
  AttachmentChip,
  AttachmentRef,
  CARD_CORNER,
  CARD_ELEMENT,
  CARD_PADDING,
  Card,
  DocumentIcon,
  UPLOAD_COVER_SIZE,
  UPLOAD_COVER_STATE,
  UploadCover,
} from "@repo/ui";
import { UNREPORTED } from "@repo/ui/reported-failure";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * upload-covers.tsx -- a file's upload drawn on the file: a picture in
 * written words going up, at a share and with none, failed with Retry and
 * Remove, and refused with Remove alone; a chip's picture and file going
 * up and failed, its face the Retry; and pictures and files named in a
 * line's words while it goes up. Each press says what it did.
 */

/** A synthetic screenshot drawn in place, so the catalog renders offline. */
const PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 190"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#7aa7f4"/><stop offset="1" stop-color="#3d5ac8"/></linearGradient></defs><rect width="320" height="190" fill="url(#g)"/><rect x="20" y="20" width="280" height="26" rx="3" fill="#fffd"/><rect x="20" y="64" width="180" height="14" rx="2" fill="#fffd"/><rect x="20" y="88" width="220" height="14" rx="2" fill="#fffd"/><rect x="20" y="140" width="90" height="30" rx="4" fill="#fff"/></svg>',
)}`;

/** A picture in written words, its frame the box the cover lays itself over. */
function Covered({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Card
      as={CARD_ELEMENT.SPAN}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.FLUSH}
      className="catalog-upload-cover"
    >
      <img src={PICTURE} alt="Screenshot" />
      {children}
    </Card>
  );
}

function UploadCovers(): React.JSX.Element {
  const [pressed, setPressed] = useState<string>();

  return (
    <>
      <CatalogSection id="upload-cover-block" title="A picture in written words">
        <div className="catalog-upload-covers">
          <Covered>
            <UploadCover
              size={UPLOAD_COVER_SIZE.BLOCK}
              state={UPLOAD_COVER_STATE.UPLOADING}
              name="Screenshot"
            />
          </Covered>
          <Covered>
            <UploadCover
              size={UPLOAD_COVER_SIZE.BLOCK}
              state={UPLOAD_COVER_STATE.UPLOADING}
              name="Screenshot"
              progress={40}
            />
          </Covered>
          <Covered>
            <UploadCover
              size={UPLOAD_COVER_SIZE.BLOCK}
              state={UPLOAD_COVER_STATE.FAILED}
              name="Screenshot"
              failure={UNREPORTED.INPUT}
              onRetry={() => setPressed("Retry")}
              onRemove={() => setPressed("Remove")}
            >
              The image could not be uploaded.
            </UploadCover>
          </Covered>
          <Covered>
            <UploadCover
              size={UPLOAD_COVER_SIZE.BLOCK}
              state={UPLOAD_COVER_STATE.FAILED}
              name="Screenshot"
              failure={UNREPORTED.INPUT}
              onRemove={() => setPressed("Remove")}
            >
              This description already holds as many pictures as it can.
            </UploadCover>
          </Covered>
        </div>
      </CatalogSection>
      <CatalogSection id="upload-cover-chip" title="A chip">
        <ul className="catalog-attachments" aria-label="Files going up">
          <AttachmentChip
            name="screenshot.png"
            image={PICTURE}
            state={ATTACHMENT_CHIP_STATE.UPLOADING}
            onRemove={() => setPressed("Remove")}
          />
          <AttachmentChip
            name="screenshot.png"
            image={PICTURE}
            state={ATTACHMENT_CHIP_STATE.FAILED}
            failure="The image could not be uploaded."
            onRetry={() => setPressed("Retry")}
            onRemove={() => setPressed("Remove")}
          />
          <AttachmentChip
            name="spec.pdf"
            icon={<DocumentIcon />}
            detail="180 kB"
            state={ATTACHMENT_CHIP_STATE.UPLOADING}
          />
          <AttachmentChip
            name="spec.pdf"
            icon={<DocumentIcon />}
            state={ATTACHMENT_CHIP_STATE.FAILED}
            failure="The PDF could not be uploaded."
            onRetry={() => setPressed("Retry")}
            onRemove={() => setPressed("Remove")}
          />
        </ul>
      </CatalogSection>
      <CatalogSection id="upload-cover-pill" title="Files in a line still going up">
        <p>
          Here is the flow <AttachmentRef name="Picture 1" image={PICTURE} uploading /> and{" "}
          <AttachmentRef name="notes.md" glyph={<DocumentIcon />} uploading />.
        </p>
      </CatalogSection>
      <p>{pressed === undefined ? "Nothing pressed" : `Pressed ${pressed}`}</p>
    </>
  );
}

export const UPLOAD_COVERS_EXAMPLE: Example = {
  id: "upload-covers",
  title: "Upload covers",
  Render: UploadCovers,
};
