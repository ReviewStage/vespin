/**
 * main.tsx -- the web app's entry, loaded by `app.html`: the panel's stylesheet, and the panel drawn into the page's root.
 */

import "./app.css";
import { mountWebApp } from "./web-root";

const rootElement = document.getElementById("root");

if (!rootElement) throw new Error("The app's root element is missing");

void mountWebApp(rootElement);

// PROTOTYPE (manager overview): a development tab opened on `/app?fixture=inbox&overview=<a|b|c|d>` goes on to the fixture's Release manager, whose address a direct load cannot open.
if (import.meta.env.DEV) {
  const asked = new URLSearchParams(location.search);

  if (asked.get("fixture") === "inbox" && asked.has("overview") && location.pathname === "/app") {
    window.setTimeout(() => {
      history.pushState(
        {},
        "",
        `/personal/agent/81e2a425-6d3f-4a07-92df-9eafb0c1d2e8${location.search}`,
      );
      dispatchEvent(new PopStateEvent("popstate"));
    }, 1500);
  }
}
