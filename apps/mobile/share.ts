// share.ts -- the share extension's entry: what Hermes lacks filled in first, then the share sheet's page registered as the root the extension's Swift stands (`share-extension/ShareViewController.swift`).
//
// Xcode bundles this entry into the extension apart from the app's
// (`app.config.ts`), so the extension loads the page and what it draws with,
// and none of the app's router, host, notifications, or crash reports.

import "./src/host/polyfills.js";
import { createElement } from "react";
import { Appearance, AppRegistry } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { shareExtensionModule } from "./src/share/share-extension-module.js";
import { ShareExtensionPage } from "./src/share/share-extension-page.js";

// Note that the page's first frame is drawn in the sheet's appearance, which React Native cannot read in an extension, and the extension's Swift tells it every change after.
Appearance.setColorScheme(shareExtensionModule.colorScheme());

/** The page under the safe area the app's router gives its screens, which the extension, with no router, gives it here. */
function ShareExtensionRoot() {
  return createElement(SafeAreaProvider, null, createElement(ShareExtensionPage));
}

AppRegistry.registerComponent("ShareExtension", () => ShareExtensionRoot);
