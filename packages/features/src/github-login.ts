// github-login.ts -- what a GitHub account is called, an App's bot's login without the suffix GitHub gives it, the word its tag says, and its own page on GitHub, for every client that names one.

import { GITHUB_ORIGIN } from "./link-grammar.js";

/** The suffix GitHub gives an App's bot's login (`coderabbitai[bot]`), which its name drops since its tag says it is one. */
export const BOT_LOGIN_SUFFIX = "[bot]";

/** The word the quiet tag after an App's bot's name says, as GitHub's own pages mark one. */
export const BOT_TAG_WORDS = "bot";

/** Whether a GitHub login is an App's bot's, which GitHub spells with its suffix. */
export function isBotLogin(login: string): boolean {
  return login.endsWith(BOT_LOGIN_SUFFIX);
}

/** What a GitHub account is called: its login, an App's bot's without the suffix GitHub gives it. */
export function githubLoginName(account: {
  readonly login: string;
  readonly bot: boolean;
}): string {
  return account.bot && isBotLogin(account.login)
    ? account.login.slice(0, -BOT_LOGIN_SUFFIX.length)
    : account.login;
}

/** A GitHub account's own page, which a press on its name opens: a person's profile, or the App's page for an App's bot. */
export function githubAccountPage(login: string, bot: boolean): string {
  const app = bot && isBotLogin(login);
  const path = app ? `apps/${login.slice(0, -BOT_LOGIN_SUFFIX.length)}` : login;

  return new URL(path, `${GITHUB_ORIGIN}/`).href;
}
