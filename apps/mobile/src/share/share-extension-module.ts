/**
 * share-extension-module.ts -- the share extension's own module (`modules/share-extension/`) as its page's JavaScript reads it: what was shared, the snapshot the app left, the access token at send time, the draft for the app, the notification of a task started, the bar's words and search, and the sheet's end.
 *
 * The module is linked into the share extension alone, never the app, so
 * only the extension's entry (`share.ts`) reaches this file.
 */

import type { SharedRead, ShareStartedNotice } from "@repo/features/ios-share-extension";
import { type NativeModule, requireNativeModule } from "expo";

/** What was shared, as the extension's Swift read it, with how many pictures did not fit one message. */
type SharedItems = Partial<SharedRead> & { readonly leftOut?: number };

/** What the module hands on, as an event. */
type ShareExtensionEvents = {
  /** The bar's search field's words changed. */
  readonly onSearch: (event: { readonly text: string }) => void;
};

declare class ShareExtensionModule extends NativeModule<ShareExtensionEvents> {
  /** The extension's version, which names it on every call, as the app's names the app. */
  readonly appVersion: string;
  /** What another app shared, once the extension has read it. */
  sharedItems(): Promise<SharedItems>;
  /** The snapshot's text as the app wrote it, or none. */
  snapshot(): Promise<string | null>;
  /** The account's access token, read from the Keychain item the app keeps, or none where it kept none or it has expired; asked only as a share is sent. */
  accessToken(): Promise<string | null>;
  /** A picture the extension wrote, as base64, by its file's address. */
  picture(path: string): Promise<string | null>;
  /** Keeps `json` as the draft for the app and the pictures at `pictures`, in order, as its picture files; whether all of it was kept. */
  keepDraft(json: string, pictures: readonly string[]): Promise<boolean>;
  /** Posts the notification of a task started; whether it was posted. */
  notify(
    id: string,
    title: string,
    body: string,
    payload: ShareStartedNotice["payload"],
  ): Promise<boolean>;
  /** The bar's title, its search field's prompt, and its close button's name. */
  setBar(title: string, search: string, close: string): Promise<void>;
  /** Tells the extension the page has drawn its first frame. */
  drawn(): Promise<void>;
  /** Ends the sheet as done. */
  finish(): Promise<void>;
}

/** The module. */
export const shareExtensionModule = requireNativeModule<ShareExtensionModule>("ShareExtension");
