// picture-shown.ts -- counts how long a picture took from its page asking for it to its file in hand, once a read, on a rung, as `picture:shown`, with where it came from, whose it is, and its size on a rung.

import {
  PRODUCT_SURFACE_EVENT,
  type ProductPictureFrom,
  type ProductPictureKind,
  productOpenMilliseconds,
  productPictureBytes,
} from "@repo/features/analytics";
import Constants from "expo-constants";
import { useCallback } from "react";
import { AppState } from "react-native";
import { useHostCount } from "./host/host-provider.js";

/** The build number this build was released as (`CFBundleVersion`), which a picture's wait is read beside; none where the build names none. */
const BUILD_NUMBER = Constants.expoConfig?.ios?.buildNumber;

/** Counts one picture in hand: where it came from, when its page asked for it by `performance.now()`, and its size in bytes where it is known. */
export type PictureShown = (from: ProductPictureFrom, askedAt: number, bytes?: number) => void;

/**
 * Counts each picture of `kind` as it lands, the time from its page asking
 * for it to its file in hand on a rung of `productOpenMilliseconds`, as
 * `picture:shown` with whether it was the phone's own copy or read through
 * the service, and its size on a rung where it is known: never which
 * picture, page, or agent, and never a time itself. Note that the wait holds
 * the time a picture stood behind the others asked with it, since they share
 * the JS thread, which is the wait a reader sits through; and that one that
 * lands while the app is away from the front counts nothing, since its time
 * would hold a wait nobody sat through.
 */
export function usePictureShownCount(kind: ProductPictureKind): PictureShown {
  const count = useHostCount();

  return useCallback(
    (from, askedAt, bytes) => {
      if (AppState.currentState !== "active") return;

      count(PRODUCT_SURFACE_EVENT.PICTURE_SHOWN, {
        read_ms: productOpenMilliseconds(performance.now() - askedAt),
        picture_from: from,
        picture_kind: kind,
        ...(bytes === undefined ? undefined : { picture_bytes: productPictureBytes(bytes) }),
        ...(BUILD_NUMBER === undefined ? undefined : { app_build: BUILD_NUMBER }),
      });
    },
    [count, kind],
  );
}
