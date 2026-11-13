import { PHOTO_WORDS } from "@repo/features/workspace-settings-words";
import { GLYPH } from "../../icons/glyph-registry.js";
import { CameraIcon, ImageUpIcon } from "../../icons/icons.js";
import { ReplayMask } from "../../session-replay-marks.js";
import { AVATAR_OUTLINE, AVATAR_SIZE, Avatar } from "../avatar/avatar.js";
import type { FilePicker } from "../file-picker/file-picker.js";
import { Menu, useMenu } from "../menu/menu.js";
import { Tooltip } from "../tooltip/hint.js";
import {
  UPLOAD_COVER_SIZE,
  UPLOAD_COVER_STATE,
  UploadCover,
} from "../upload-cover/upload-cover.js";

/**
 * photo-pick.tsx -- a thing's photo as its own tile, the tile itself the press that picks one, beside the name it stands for.
 *
 * The tile is what the thing is marked by wherever it is listed: its photo,
 * or its name's letter on its hue until one stands, so the person sees the
 * tile they are making as they make it; dashed around a camera while
 * nothing is named, the camera laid over the tile under the pointer or the
 * keyboard's focus once something is. A press picks a photo; with one set,
 * which its caller says by offering its removal (`onRemove`), a press opens
 * Replace photo and Delete photo instead. A finger's tap is its press. The caller holds
 * the picker and the photo, since what a picked file becomes is the
 * caller's to decide, and the picker's hidden input is drawn here, beside
 * the tile. Note that the words it is named by are a hint on a rest, since
 * the tile says what it is by itself. While a photo picked goes up
 * (`uploading`), the tile wears the upload's cover (`UploadCover`) and takes
 * no press; a refusal is its caller's to say.
 */

/**
 * The tile as a press: a workspace tile's box and corner, lighting its camera
 * under the pointer or the keyboard's focus. On a coarse pointer it takes a
 * press `--ui-touch-target` across, centered on it, while it draws at its own
 * size, so it stops clipping there and its veil keeps the corner itself.
 */
const TILE =
  "ui-photo-pick group/photo relative m-0 inline-flex size-avatar-card flex-none items-center justify-center overflow-hidden rounded-avatar-tile border-0 bg-transparent p-0 text-muted-foreground cursor-press disabled:cursor-default disabled:opacity-disabled data-[blank=true]:border data-[blank=true]:border-dashed data-[blank=true]:border-border-strong data-[blank=true]:bg-well [&_svg]:size-control-icon pointer-coarse:overflow-visible pointer-coarse:before:absolute pointer-coarse:before:top-1/2 pointer-coarse:before:left-1/2 pointer-coarse:before:size-[max(100%,var(--ui-touch-target))] pointer-coarse:before:[transform:translate(-50%,-50%)] pointer-coarse:before:content-['']";

/** The camera laid over a tile that stands, shown under the pointer or the keyboard's focus. */
const OVER =
  "ui-photo-pick-over absolute inset-0 flex items-center justify-center rounded-avatar-tile bg-veil text-on-veil opacity-0 transition-opacity duration-(--ui-duration-hover) ease-plain group-hover/photo:opacity-100 group-focus-visible/photo:opacity-100";

/** The photo of `name`, picked through `picker`; `unnamed` is the name its tile says while none is typed. */
export function PhotoPick({
  name,
  unnamed,
  id,
  photo,
  picker,
  onRemove,
  disabled = false,
  uploading = false,
}: {
  name: string;
  unnamed: string;
  /** What the tile's hue is kept by, as the thing's tile is drawn wherever it is listed; its name where none is given. */
  id?: string | undefined;
  /** The photo's URL, or nothing while none is picked. */
  photo: string | undefined;
  picker: FilePicker;
  /** Removes the photo set, given only while one is, offered beside Replace photo; without it a press picks. */
  onRemove?: (() => void) | undefined;
  disabled?: boolean | undefined;
  /** Whether a photo picked is on its way up, the tile covered and taking no press until it lands. */
  uploading?: boolean | undefined;
}): React.JSX.Element {
  const named = name.trim();
  const blank = named === "" && photo === undefined;
  // Note that a photo set is told by its removal being offered, because the photo's own picture may still be on its way.
  const choosing = onRemove !== undefined;
  const menu = useMenu(choosing);
  const label = photo === undefined && !choosing ? PHOTO_WORDS.ADD : PHOTO_WORDS.CHANGE;
  const press = choosing ? menu.trigger() : { onClick: picker.open };

  return (
    <>
      <Tooltip label={label}>
        <button
          type="button"
          className={TILE}
          aria-label={label}
          aria-busy={uploading ? true : undefined}
          disabled={disabled || uploading}
          data-blank={blank ? "true" : undefined}
          {...press}
        >
          {blank ? (
            <CameraIcon aria-hidden="true" />
          ) : (
            <>
              <ReplayMask>
                <Avatar
                  name={named === "" ? unnamed : named}
                  {...(id === undefined ? {} : { id })}
                  src={photo}
                  size={AVATAR_SIZE.CARD}
                  outline={AVATAR_OUTLINE.TILE}
                  decorative
                />
              </ReplayMask>
              <span className={OVER} aria-hidden="true">
                <CameraIcon />
              </span>
            </>
          )}
          {uploading ? (
            <UploadCover size={UPLOAD_COVER_SIZE.CHIP} state={UPLOAD_COVER_STATE.UPLOADING} />
          ) : null}
        </button>
      </Tooltip>
      {menu.drawn === undefined || onRemove === undefined ? null : (
        <Menu
          label={label}
          menu={menu.drawn}
          groups={[
            [{ label: PHOTO_WORDS.REPLACE, icon: <ImageUpIcon />, onSelect: picker.open }],
            [
              {
                label: PHOTO_WORDS.DELETE,
                icon: <GLYPH.DELETE />,
                danger: true,
                onSelect: onRemove,
              },
            ],
          ]}
          onClose={menu.close}
          replayUnmasked
        />
      )}
      {picker.input}
    </>
  );
}
