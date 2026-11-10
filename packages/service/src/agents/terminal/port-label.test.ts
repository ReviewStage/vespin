import { describe, expect, it } from "vitest";
import { labelIn, labelOf } from "./port-label.js";

/**
 * What serves a port, as the command lines a dev server is started by read:
 * named by the program and its subcommand, an interpreter by what it runs, a
 * package manager by its script and where it was pointed, a runner by what
 * it runs, and never by a flag's value or a word that does not read as a
 * name, which may be a secret.
 */

describe("a port's label", () => {
  it.each([
    { argv: ["/usr/local/bin/vite", "--port", "5173"], label: "vite" },
    { argv: ["next", "dev", "-p", "3000"], label: "next dev" },
    {
      argv: ["node", "/w/node_modules/.pnpm/next@15/node_modules/next/dist/bin/next", "dev"],
      label: "next dev",
    },
    { argv: ["node", "/w/node_modules/.bin/storybook", "dev", "-p", "3006"], label: "storybook dev" },
    { argv: ["node", "--inspect", "server.js"], label: "server" },
    { argv: ["pnpm", "--filter", "@repo/web", "dev"], label: "pnpm dev · web" },
    { argv: ["pnpm", "--filter=@repo/web...", "run", "dev"], label: "pnpm dev · web" },
    { argv: ["npm", "run", "storybook"], label: "npm storybook" },
    { argv: ["yarn", "workspace", "admin", "start"], label: "yarn start · admin" },
    { argv: ["pnpm", "exec", "vite"], label: "vite" },
    { argv: ["npx", "-y", "http-server", "-p", "8080"], label: "http-server" },
    { argv: ["env", "PORT=3000", "SECRET=hunter2", "node", "app.js"], label: "app" },
    { argv: ["python3", "-m", "http.server", "8000"], label: "http.server" },
    { argv: ["next-server (v15.0.0)        "], label: "next-server" },
    { argv: ["./serve", "sk_live_TOKEN"], label: "serve" },
    { argv: ["/opt/AB12CD"], label: undefined },
  ])("$argv reads as $label", ({ argv, label }) => {
    expect(labelOf(argv)).toBe(label);
  });

  it("names the folder a server runs in, where it reads as a name", () => {
    expect([labelIn("vite", "/w/apps/web"), labelIn("vite", "/")]).toEqual(["vite · web", "vite"]);
  });
});
