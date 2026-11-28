// share.ts -- the share extension's entry: what Hermes lacks filled in first, then the share sheet's page registered as the root the extension's Swift stands (`share-extension/ShareViewController.swift`).
//
// Xcode bundles this entry into the extension apart from the app's
// (`app.config.ts`), so the extension loads the page and what it draws with,
// and none of the app's router, host, notifications, or crash reports.

import "./src/host/polyfills.js";
import { AppRegistry } from "react-native";
import { ShareExtensionPage } from "./src/share/share-extension-page.js";

AppRegistry.registerComponent("ShareExtension", () => ShareExtensionPage);
