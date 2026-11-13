# Vespin docs

The source of [vespin.dev/docs](https://vespin.dev/docs), built by
[Mintlify](https://mintlify.com) from `docs.json` and the `.mdx` pages
beside it. Mintlify deploys `main` on every push that changes this folder,
and vespin.dev passes `/docs` on to it through routes in the root
`vercel.json` (Mintlify's custom domain is vespin.dev at the base path
`docs`).

Preview locally with Mintlify's CLI:

```sh
cd apps/docs
npx mint dev
```

The logos and favicon are copies of `packages/brand`'s artwork; its
`README.md` lists the commands that refresh them.

Screenshots go in `images/` and are taken the way the changelog's are
(`.agents/skills/changelog-screenshots`).

## Style

A page states only what a reader needs in order to act
(`docs/DESIGN.md`, "Copy: delete what describes, keep what instructs").
Every claim comes from the code on `main`: a label, a key, a limit. If you
can't find it in the code, leave it out.

### Page shape

- Frontmatter: a `title` of one to three words, and a `description` of one
  line with no period ("Start agents on a schedule, on GitHub and Sentry
  events, or from a webhook").
- The first sentence defines the subject: "An automation starts an agent with
  a prompt you write whenever its trigger fires." The second says why it
  exists or what it gives you. No heading above them.
- Then `##` sections with plain task headings: "Start a task", "Triggers",
  "What the agent gets", "Limits". Never a question, never "Overview" or
  "Introduction". A heading the app or another page links to by anchor, if
  it holds an apostrophe, takes an explicit id
  (`## The agent's browser {#the-agents-browser}`), since Mintlify keeps
  the curly apostrophe in the anchor it makes.
- A section ends with its cross-link, if it has one: "For every key, see
  [Keyboard shortcuts](/shortcuts)." A page ends on its last instruction,
  never a summary.

### Voice

- Second person, present tense, active voice: "you" do things, "the agent"
  does things. Not "we", not "users".
- Short declarative sentences, about 6 to 20 words, one fact each.
- Concrete nouns: "the task's **Overview** tab", not "the relevant view".
- Imperatives for steps: "Press <kbd>R</kbd> to reply." Bullets are
  imperatives or fragments, never paragraphs.
- Say what happens, then stop. Don't reassure, don't predict how the reader
  feels, don't describe the screen they're looking at.

### Naming UI and keys

- Name a control exactly as the app spells and capitalizes it, in bold:
  **New automation**, **Mark done**, **Couldn't do it**. Find the string in
  `packages/panel/src` or `packages/ui/src`; don't paraphrase it.
- A path through Settings uses `›`: **Settings › Workspace**.
- Keys go in `<kbd>`, one chord per element, with the Mac's glyphs as
  `apps/docs/shortcuts.mdx` prints them: <kbd>⇧⌘I</kbd>, a range as
  <kbd>1</kbd>–<kbd>9</kbd>. Give the browser's chord where it differs:
  <kbd>⌘N</kbd> (<kbd>⌥⌘N</kbd> in a browser).
- Code, commands, file names, and literal values go in backticks.

### Tables, lists, callouts, pictures

- A **table** only where rows share columns: limits with a default and a
  maximum, keys with their actions. Never a table of one column.
- A **numbered list** for steps in order, or an order the app follows. A
  **bulleted list** for parallel items of a line or two. Prose otherwise.
- A **callout** (`<Note>`, `<Warning>`) only for what costs the reader
  something if missed: data lost, a secret shown once. At most one a page.
- A **picture** only where it shows what words can't, in a `<Frame>` with
  alt text saying what it shows. Taken from the Mac, as above.

### Before and after

From the first draft of `index.mdx`, a list that sold the product:

> - Built-in task management: agents break work into sub-tasks and hand
>   them to other agents.
> - Agents that work together: they start other agents, message each other,
>   and manage your task board.

What it says now, which tells the reader what happens and what they do:

> You describe a task, and Claude Code or Codex agents work on it in cloud
> sandboxes and open pull requests. When an agent needs a decision, a to-do,
> or your review, it posts a thread to your Inbox, and you answer it there.

From the first draft of `quickstart.mdx`, a step that described the screen:

> **Watch the agent work.** The task opens on its agent's tab, which shows
> each step the agent takes.

What it says now, a fact the reader can't see for themselves:

> The agent works in a cloud sandbox with its own checkout of the
> repository, not in your local checkout.

### Never write

`scripts/style-check.mjs` fails on these in any `.mdx` page, outside code
and link targets, and `scripts/repository-checks.sh` runs it. Reword the
sentence; there is no way to silence it.

- Words that sell: seamless, powerful, robust, effortless, unlock,
  supercharge, leverage, game-changing, cutting-edge, streamline, empower,
  delve.
- Filler openers: "Whether you're…", "In today's…", "Let's dive in", "It's
  worth noting".
- Minimizers: "simply" and "just".
- Questions, rhetorical or not. State the answer.
- Emoji. Name it in words, or as Slack spells it in code (`:eyes:`).
- Two em dashes in one line, and "not just X, but Y".
- Sign-offs: "In summary", "In conclusion", "To sum up", "In short".

The check can't see these, so the reader holds them:

- Triplets that pad: "fast, simple, and reliable". Keep the one item that
  is true and specific.
- Adjectives that grade the product: "easy", "intuitive", "beautiful".
- A sentence that restates the heading above it, or the sentence before.
- "Note that", "Keep in mind", "Remember": state the fact.

Run it by hand with `node apps/docs/scripts/style-check.mjs [page.mdx ...]`.
