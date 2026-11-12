/**
 * site-markdown.tsx -- the site's Markdown documents drawn as HTML when it is built: CHANGELOG.md read as releases, PRIVACY.md as a policy, and each file under `guides/` as a guide, all by `@repo/ui/markdown`, the renderer every Markdown in the app is drawn with.
 *
 * Only the build reads this module (`scripts/site-markdown.ts`, which hands
 * a page what it answers as a module of finished values), so the pages
 * carry their markup and no parser rides into the site's bundle. Every
 * document is written in this repository, so their HTML is ours: it is
 * parsed (a release's `<kbd>` keys say a chord) and never sanitized, as a
 * visitor's words would be.
 */

import { markdownTree } from "@repo/features/markdown-tree";
import {
  MARKDOWN_HTML_STEP,
  MARKDOWN_LOOK,
  Markdown,
  type MarkdownComponents,
} from "@repo/ui/markdown";
import { Schema } from "effect";
import type { Heading, Nodes, PhrasingContent, RootContent } from "mdast";
import { renderToStaticMarkup } from "react-dom/server";
import { parse as parseYaml } from "yaml";
import type { Release, ReleaseImage } from "./changelog-releases";
import type { Guide, GuideQuestion } from "./guides";
import { REPOSITORY_URL } from "./SiteChrome";

/** One `##` section of the policy, its heading and body as HTML; the opening one has no heading. */
export interface PolicySection {
  readonly title: string | null;
  readonly html: string;
}

/** The policy cut at its headings: the `#` title, and the sections under it. */
export interface Policy {
  readonly title: string;
  readonly sections: readonly PolicySection[];
}

/** The standing sections every release may end on, which name no feature. */
const STANDING_SECTIONS: ReadonlySet<string> = new Set(["Improvements", "Fixes", "Misc"]);

/**
 * The heading shape is CHANGELOG.md's contract with this page: the version
 * becomes the sticky rail and the release's own address. repository-checks.sh
 * refuses a heading that does not parse, so the throw here is the backstop,
 * not the gate.
 */
const RELEASE_HEADING = /^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})$/;
const PUBLIC_PREFIX = "apps/web/public";

/** A guide's file name: its slug, lower-case words joined by hyphens, then `.md`. */
const GUIDE_FILE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

/** A guide's front matter: the YAML between a `---` line opening the file and the next. */
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The steps a document's tree takes: its own HTML parsed, as written. */
const DOCUMENT_STEPS = [MARKDOWN_HTML_STEP.PARSE];

/* Screenshots are written repository-relative in the markdown so GitHub
   renders them too; here the public prefix comes off, because Vite serves
   that directory at the root. */
const servedPath = (href: string) =>
  href.startsWith(`${PUBLIC_PREFIX}/`) ? href.slice(PUBLIC_PREFIX.length) : href;

/* A link to a file beside CHANGELOG.md (`PRIVACY.md`) reads on GitHub as the
   repository's file, and anywhere else would resolve under whatever page or
   feed holds it, so it is written as that file on GitHub. */
const RELATIVE_LINK = /^(?![a-z][a-z0-9+.-]*:|\/|#)/i;

const repositoryFile = (href: string) =>
  RELATIVE_LINK.test(href) ? `${REPOSITORY_URL}/blob/main/${href}` : href;

/** Each address a document names, as the site serves it: a screenshot from the site's root, a file beside the document on GitHub. */
function siteUrl(url: string, key: string): string {
  return key === "src" ? servedPath(url) : repositoryFile(url);
}

/**
 * A screenshot drawn at the column's measure is a preview of the full
 * capture, so it links out to the file itself, the same way GitHub wraps a
 * rendered markdown image. Lazy, because every release adds images above
 * the ones already here.
 */
const RELEASE_COMPONENTS: MarkdownComponents = {
  img: ({ src, alt, title }) => (
    <a href={src} target="_blank" rel="noreferrer">
      <img src={src} alt={alt} title={title} loading="lazy" />
    </a>
  ),
};

/** Inline words drawn bare, for a heading the page sets itself. */
const INLINE_COMPONENTS: MarkdownComponents = { p: ({ children }) => <>{children}</> };

/** Markdown drawn as a document's HTML, with no root of its own: the page's `Prose` is its root. */
function documentHtml(words: string, components?: MarkdownComponents): string {
  return renderToStaticMarkup(
    <Markdown
      look={MARKDOWN_LOOK.DOCUMENT}
      words={words}
      components={components}
      rehypePlugins={DOCUMENT_STEPS}
      urlTransform={siteUrl}
    />,
  );
}

/** The words a run of nodes was written as, from the first's start to the last's end. */
function writtenAs(markdown: string, nodes: readonly Nodes[]): string {
  const from = nodes[0]?.position?.start.offset;
  const to = nodes.at(-1)?.position?.end.offset;

  return from === undefined || to === undefined ? "" : markdown.slice(from, to);
}

/** The plain words of inline nodes: links, emphasis, and code read as their text, a picture as nothing. */
function plainText(nodes: readonly PhrasingContent[]): string {
  return nodes
    .map((node): string => {
      if (node.type === "image" || node.type === "imageReference") return "";

      if (node.type === "break") return " ";

      if ("value" in node) return node.value;

      return "children" in node ? plainText(node.children) : "";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether a block is a paragraph of pictures alone. */
function picturesAlone(node: RootContent): boolean {
  return (
    node.type === "paragraph" &&
    node.children.every((child) => child.type === "image" || child.type === "imageReference")
  );
}

/** The first picture under some nodes, at its served address. */
function firstImage(nodes: readonly Nodes[]): ReleaseImage | undefined {
  for (const node of nodes) {
    if (node.type === "image") return { src: servedPath(node.url), alt: node.alt ?? "" };
    const inside = "children" in node ? firstImage(node.children) : undefined;

    if (inside !== undefined) return inside;
  }

  return undefined;
}

/** The headline, summary, and first screenshot a release's notes open on. */
function releaseHighlights(body: string): Pick<Release, "headline" | "summary" | "image"> {
  const blocks = markdownTree(body).children;

  const heading = blocks.find(
    (node): node is Heading => node.type === "heading" && node.depth === 3,
  );

  const named = heading === undefined ? undefined : writtenAs(body, heading.children);
  const headline = named !== undefined && !STANDING_SECTIONS.has(named) ? named : undefined;
  const paragraph = blocks.find((node) => node.type === "paragraph" && !picturesAlone(node));
  const list = blocks.find((node) => node.type === "list");

  const opening =
    paragraph?.type === "paragraph"
      ? paragraph.children
      : list?.type === "list" && list.children[0]?.children[0]?.type === "paragraph"
        ? list.children[0].children[0].children
        : [];

  return { headline, summary: plainText(opening), image: firstImage(blocks) };
}

/** Every release in CHANGELOG.md, newest first, as the file lists them. */
export function parseReleases(markdown: string): readonly Release[] {
  const sections = markdown.split(/^(?=## )/m);

  return sections.slice(1).map((section) => {
    const headingEnd = section.indexOf("\n");
    const heading = headingEnd === -1 ? section : section.slice(0, headingEnd);
    const match = RELEASE_HEADING.exec(heading.trimEnd());
    const version = match?.[1];
    const date = match?.[2];

    if (!version || !date) {
      throw new Error(`CHANGELOG.md release heading must be "## <version> — <date>": ${heading}`);
    }

    const body = headingEnd === -1 ? "" : section.slice(headingEnd + 1);

    return {
      version,
      date,
      html: documentHtml(body, RELEASE_COMPONENTS),
      ...releaseHighlights(body),
    };
  });
}

/**
 * PRIVACY.md cut at its `#` and `##` headings, so the page draws the title
 * and each section itself and the generated markup is only what lies
 * between.
 */
export function policyOf(markdown: string): Policy {
  let title: string | null = null;
  const sections: { title: string | null; blocks: RootContent[] }[] = [{ title: null, blocks: [] }];

  for (const node of markdownTree(markdown).children) {
    if (node.type === "heading" && node.depth === 1)
      title = documentHtml(writtenAs(markdown, node.children), INLINE_COMPONENTS);
    else if (node.type === "heading" && node.depth === 2)
      sections.push({
        title: documentHtml(writtenAs(markdown, node.children), INLINE_COMPONENTS),
        blocks: [],
      });
    else sections.at(-1)?.blocks.push(node);
  }

  if (title === null) throw new Error("PRIVACY.md has no `#` title");

  return {
    title,
    sections: sections.flatMap((section) =>
      section.title !== null || section.blocks.length > 0
        ? [{ title: section.title, html: documentHtml(writtenAs(markdown, section.blocks)) }]
        : [],
    ),
  };
}

/** A guide as its front matter and body give it, before the guides beside it are known. */
export interface GuideSource {
  readonly guide: Guide;
  /** Whether it is a draft, which a production build leaves out. */
  readonly draft: boolean;
}

/** A guide's FAQ entry as written: a question, and its answer in Markdown. */
const GUIDE_QUESTION = Schema.Struct({ q: Schema.NonEmptyString, a: Schema.NonEmptyString });

/** A front matter day, `YYYY-MM-DD`, as YAML 1.2 reads one: words. */
const GUIDE_DAY = Schema.String.check(Schema.isPattern(DAY));

/** A guide's front matter as `guides/README.md` documents it; any other key is refused. */
const GUIDE_FRONT_MATTER = Schema.Struct({
  title: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  published: GUIDE_DAY,
  updated: GUIDE_DAY,
  related: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  faq: Schema.Array(GUIDE_QUESTION).check(Schema.isMinLength(1)),
  draft: Schema.optionalKey(Schema.Boolean),
});

const decodeFrontMatter = Schema.decodeUnknownSync(GUIDE_FRONT_MATTER, {
  onExcessProperty: "error",
});

/** One FAQ entry, its answer drawn as HTML and read as plain words. */
function questionOf(entry: typeof GUIDE_QUESTION.Type): GuideQuestion {
  const answer = entry.a.trim();

  const text = markdownTree(answer)
    .children.flatMap((node) => (node.type === "paragraph" ? [plainText(node.children)] : []))
    .join(" ");

  return { question: entry.q.trim(), answer, html: documentHtml(answer), text: text || answer };
}

/** A guide's front matter decoded, or the build failed naming the file and what is wrong. */
function frontMatterOf(file: string, yaml: string): typeof GUIDE_FRONT_MATTER.Type {
  try {
    return decodeFrontMatter(parseYaml(yaml));
  } catch (error) {
    throw new Error(`guides/${file}: the front matter breaks guides/README.md's format: ${error}`);
  }
}

/**
 * One file under `guides/`, read as a guide: the YAML front matter that
 * `guides/README.md` documents, checked, and the body under it drawn. A file
 * that breaks the format fails the build, naming the file and the key.
 */
export function parseGuide(file: string, markdown: string): GuideSource {
  const slug = GUIDE_FILE.exec(file)?.[1];

  if (slug === undefined)
    throw new Error(
      `guides/${file}: a guide's file is named <slug>.md, in lower-case words and hyphens`,
    );
  const match = FRONT_MATTER.exec(markdown);

  if (match === null)
    throw new Error(`guides/${file}: a guide opens on front matter between --- lines`);
  const front = frontMatterOf(file, match[1] ?? "");

  if (front.updated < front.published)
    throw new Error(`guides/${file}: \`updated\` is before \`published\``);
  const body = markdown.slice(match[0].length).trim();

  if (body === "") throw new Error(`guides/${file}: the guide has no words under its front matter`);

  if (markdownTree(body).children.some((node) => node.type === "heading" && node.depth === 1))
    throw new Error(`guides/${file}: the page sets the title, so the body has no \`#\` heading`);

  return {
    draft: front.draft === true,
    guide: {
      slug,
      title: front.title.trim(),
      description: front.description.trim(),
      published: front.published,
      updated: front.updated,
      related: front.related ?? [],
      html: documentHtml(body, RELEASE_COMPONENTS),
      markdown: body,
      faq: front.faq.map(questionOf),
    },
  };
}

/**
 * Every guide under `guides/`, by file name and words, drafts left out where
 * `drafts` is false. A guide that names a related guide no file holds, or
 * itself, fails the build.
 */
export function parseGuides(
  files: readonly { readonly file: string; readonly words: string }[],
  drafts: boolean,
): readonly Guide[] {
  const guides = files.flatMap(({ file, words }) => {
    const source = parseGuide(file, words);

    return drafts || !source.draft ? [source.guide] : [];
  });

  const slugs = new Set(guides.map((guide) => guide.slug));

  for (const guide of guides) {
    const missing = guide.related.filter((slug) => !slugs.has(slug) || slug === guide.slug);

    if (missing.length > 0)
      throw new Error(
        `guides/${guide.slug}.md: \`related\` names no other guide: ${missing.join(", ")}`,
      );
  }

  return guides;
}
