/**
 * main.tsx -- PROTOTYPE, throwaway: seven ways to see your Managers as a team, one per `?variant=`, on fixture data.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/bricolage-grotesque/wght.css";
import "../catalog.css";
import "./prototype.css";
import { Building } from "./v-building";
import { TradingCards } from "./v-cards";
import { Newspaper } from "./v-newspaper";
import { Roster } from "./v-roster";
import { SolarSystem } from "./v-solar";
import { Studio } from "./v-studio";
import { TransitMap } from "./v-transit";

export const VARIANTS = {
  roster: Roster,
  cards: TradingCards,
  newspaper: Newspaper,
  transit: TransitMap,
  studio: Studio,
  solar: SolarSystem,
  building: Building,
} as const;

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.setAttribute("data-ui-theme", theme);
const key = (params.get("variant") ?? "roster") as keyof typeof VARIANTS;
const Variant = VARIANTS[key] ?? Roster;

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing");

createRoot(root).render(
  <StrictMode>
    <div className="pt-stage" data-variant={key}>
      <Variant />
    </div>
  </StrictMode>,
);
