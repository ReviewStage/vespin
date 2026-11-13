import { Announcer } from "@repo/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ComputerPreviewDemo } from "../src/examples/computer-preview-demo";
import "./demo.css";

/** demo-main.tsx -- THROWAWAY: the computer preview demo as a page of its own. */

const rootElement = document.getElementById("root");

if (!rootElement) throw new Error("Root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <ComputerPreviewDemo />
    <Announcer />
  </StrictMode>,
);
