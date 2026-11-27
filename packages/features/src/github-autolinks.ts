// github-autolinks.ts -- the words GitHub links on its own in a comment's Markdown (`@login`, `#123`, `owner/name#123`, a commit's whole hash), found in plain words, as a client that draws the Markdown rather than GitHub's rendering links them.

/** One word GitHub links: where it stands in the words, what it shows, and the page it opens. */
export interface GitHubAutolink {
  readonly start: number;
  readonly end: number;
  /** What it shows: as written, but a commit's hash by its first seven, as GitHub shows one. */
  readonly label: string;
  readonly href: string;
}

const GITHUB = "https://github.com";

/** How many of a commit's hash GitHub shows. */
const SHORT_HASH = 7;

/**
 * Each word GitHub links, by its kind: a person or a team (`@login`,
 * `@org/team`), an issue or a pull request of this repository or another
 * (`#123`, `owner/name#123`), and a commit by its whole hash, of this
 * repository or another (`owner/name@hash`). Note that a short hash is
 * linked by GitHub only where the commit is known to it, which words alone
 * cannot say, so it stays words.
 */
const AUTOLINK =
  /@([a-zA-Z\d](?:[a-zA-Z\d]|-(?=[a-zA-Z\d])){0,38})(?:\/([a-zA-Z\d][\w.-]*))?|(?:([a-zA-Z\d][\w.-]*)\/([\w.-]+))?#(\d{1,10})|(?:([a-zA-Z\d][\w.-]*)\/([\w.-]+)@)?([\da-f]{40})/gu;

/** What may not stand right before a linked word, which would make it part of a longer one: an address's or a path's character. */
const JOINED_BEFORE = /[\w./@#&+-]/u;

/** What may not stand right after one: a word's character. */
const JOINED_AFTER = /\w/u;

/** The repository a reference names, its own where it names none; none where neither is known. */
function repositoryOf(
  owner: string | undefined,
  name: string | undefined,
  repository: string | null,
): string | undefined {
  return owner !== undefined && name !== undefined ? `${owner}/${name}` : (repository ?? undefined);
}

/** The page a match opens and what it shows, by its kind; none where it names no repository to read it in. */
function linkOf(match: RegExpExecArray, repository: string | null) {
  const [written, login, team, owner, name, number, hashOwner, hashName, hash] = match;

  if (login !== undefined) {
    return {
      label: written,
      href: team === undefined ? `${GITHUB}/${login}` : `${GITHUB}/orgs/${login}/teams/${team}`,
    };
  }

  if (number !== undefined) {
    const named = repositoryOf(owner, name, repository);

    return named === undefined
      ? undefined
      : { label: written, href: `${GITHUB}/${named}/issues/${number}` };
  }

  const named = repositoryOf(hashOwner, hashName, repository);

  if (hash === undefined || named === undefined) return undefined;
  const short = hash.slice(0, SHORT_HASH);

  return {
    label: hashOwner === undefined ? short : `${named}@${short}`,
    href: `${GITHUB}/${named}/commit/${hash}`,
  };
}

/**
 * Each word GitHub links in `words`, plain words of a comment written in
 * `repository` (`owner/name`, or none), in order: a person or a team to
 * their page, an issue or a pull request to its page (GitHub's `/issues/`
 * address, which it sends on to a pull request's own), and a commit to its
 * page. A word joined to a longer one, as in an email address or a path,
 * is no link, and a reference with no repository to read it in stays words.
 */
export function githubAutolinks(
  words: string,
  repository: string | null,
): readonly GitHubAutolink[] {
  const found: GitHubAutolink[] = [];

  for (const match of words.matchAll(AUTOLINK)) {
    const start = match.index;
    const end = start + match[0].length;
    const before = words[start - 1] ?? "";
    const after = words[end] ?? "";

    if (JOINED_BEFORE.test(before) || JOINED_AFTER.test(after)) continue;
    const link = linkOf(match, repository);

    if (link !== undefined) found.push({ start, end, ...link });
  }

  return found;
}
