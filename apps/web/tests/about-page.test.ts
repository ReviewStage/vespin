// @vitest-environment jsdom
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { test } from "vitest";
import { AboutPage } from "../src/AboutPage";

/**
 * The About page as the prerender writes it: one title, the founders' section and a heading
 * per founder, and the backer's chip and each founder's profiles named for whom they belong to. The site's chrome
 * is site-chrome.test.ts's.
 */

/** The page's main as the prerender writes it. */
function main(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderToString(createElement(AboutPage));
  const region = root.querySelector("main");
  assert.ok(region !== null);

  return region;
}

test("the page is titled About, with the founders' section and a heading for each founder", () => {
  const headings = Array.from(main().querySelectorAll("h1, h2, h3, h4, h5, h6"));
  assert.deepEqual(
    headings.map((heading) => `${heading.tagName} ${heading.textContent}`),
    ["H1 About", "H2 Founders", "H3 Charles Pan", "H3 Dean Stratakos"],
  );
});

test("the backer's page and each founder's profiles open in a new tab, each named", () => {
  const links = Array.from(main().querySelectorAll("a"));
  assert.deepEqual(
    links.map((link) => `${link.getAttribute("aria-label")} -> ${link.getAttribute("href")}`),
    [
      "Backed by Y Combinator -> https://www.ycombinator.com/companies/vespin",
      "Charles Pan on LinkedIn -> https://www.linkedin.com/in/charleslpan/",
      "Charles Pan on X -> https://x.com/ceefryingpan",
      "Dean Stratakos on LinkedIn -> https://www.linkedin.com/in/dean-stratakos/",
      "Dean Stratakos on X -> https://x.com/DeanStratakos",
    ],
  );

  for (const link of links) assert.equal(link.getAttribute("target"), "_blank");
});
