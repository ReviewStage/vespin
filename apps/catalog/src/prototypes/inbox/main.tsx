import { Announcer } from "@repo/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Prototype } from "./prototype";
// The site's faces, bundled from the workspace as the catalog bundles them, then the catalog's page and the prototype's own layout.
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "../../catalog.css";
import "./inbox.css";

/**
 * main.tsx -- the Inbox threads prototype's entry, a page of the catalog
 * beside it (`inbox-prototype.html`), drawn beside the window's `Announcer`.
 */

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");
createRoot(rootElement).render(
  <StrictMode>
    <Prototype />
    <Announcer />
  </StrictMode>,
);
