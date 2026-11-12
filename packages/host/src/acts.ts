import { PRODUCT_NAME } from "@repo/features/product-name";
import { andList } from "@repo/features/words";
import { workspaceInvitationSchema } from "@repo/features/workspace-invitation-wire";
import {
  formerMemberSchema,
  WORKSPACE_BOUNDS,
  WORKSPACE_ROLE,
  WORKSPACE_SLUG_PROBLEM,
  type Workspace,
  type WorkspaceSlugProblem,
  workspaceMemberSchema,
} from "@repo/features/workspace-wire";
import { Schema as EffectSchema } from "effect";
import { PORT_ACT_KIND } from "./contract/kinds.js";

/**
 * Every effect a window may ask this build's main process for, named once:
 * the kinds of the window's act port (`contract/kinds.ts`), by the name its
 * call sites spell. Adding an effect is adding its kind there, its contract
 * procedure, and its one act-port procedure — a command with no kind
 * reaches nothing.
 */
export const ACT_KIND = PORT_ACT_KIND;

/**
 * What the account's deletion is refused with where Better Auth found the
 * session signed in longer ago than it deletes an account under
 * (`SESSION_EXPIRED`), in place of the act's own sentence: a new sign-in
 * answers it, which no retry under the same session does.
 */
export const ACCOUNT_DELETE_SESSION_EXPIRED_REFUSAL =
  "You signed in too long ago to delete the account. Sign out and back in, then delete it again." as const;

/**
 * What the account's deletion is refused with where the service no longer
 * took the Mac's session and nothing the Mac holds could tell whether the
 * account is gone, in place of the act's own sentence: the account may
 * already be deleted, so the refusal says the deletion is unconfirmed
 * rather than that it failed.
 */
export const ACCOUNT_DELETE_UNCONFIRMED_REFUSAL =
  "Couldn't confirm whether the account was deleted. Check your connection, then try again." as const;

/**
 * What a refused delete tells the person to do, as the panel's Account page
 * and the iOS app's both say it. Note that Better Auth deletes an account
 * only within a day of its sign-in, and the host refuses a delete past that
 * in its own sentence (`ACCOUNT_DELETE_SESSION_EXPIRED_REFUSAL`), which a
 * retry alone never gets past, so only that refusal says to sign in again.
 * A deletion the host could not confirm (`ACCOUNT_DELETE_UNCONFIRMED_REFUSAL`)
 * may already have happened, so it says so in the host's words rather than
 * that it failed; anything else, such as a service that did not answer,
 * says to try again.
 */
export function accountDeleteRefusalWords(cause: unknown): string {
  const said = cause instanceof Error ? cause.message : undefined;

  if (said === ACCOUNT_DELETE_SESSION_EXPIRED_REFUSAL) {
    return "The account could not be deleted. Sign out and back in, then delete it again.";
  }

  if (said === ACCOUNT_DELETE_UNCONFIRMED_REFUSAL) return ACCOUNT_DELETE_UNCONFIRMED_REFUSAL;

  return "The account could not be deleted. Try again.";
}

/**
 * What the account's delete asks after its warning about the workspaces that
 * go with the account, the ones it owns and is the only member of, as
 * Better Auth deletes them (`auth-policy.ts`'s `accountDeletion`): their
 * names where the list is read whole, and nothing where it names none;
 * while it is unread, or its read failed, the rule itself, since a question
 * saying nothing then would read as though nothing else goes. Note that a
 * list from a service before member counts names none.
 */
export function accountDeleteWorkspacesWords(
  workspaces: readonly Workspace[] | undefined,
  listKnown: boolean,
): string | undefined {
  if (workspaces === undefined || !listKnown) {
    return "Workspaces you own and are the only member of are also deleted, with everything in them.";
  }

  const names = workspaces
    .filter(({ role, memberCount }) => role === WORKSPACE_ROLE.OWNER && memberCount === 1)
    .map(({ name }) => name);

  return names.length > 0 ? `Also deleted, with everything in them: ${andList(names)}.` : undefined;
}

/**
 * What a workspace act whose role does not allow it is refused with, in place
 * of its kind's own sentence: a member renaming the workspace, setting its
 * photo, or removing someone, or an owner removed or leaving.
 */
export const WORKSPACE_NOT_PERMITTED_REFUSAL =
  "Your role in this workspace does not allow that." as const;

/**
 * What is wrong with a workspace's slug, in the words its field says as it
 * is typed and a refused change is answered with: the same words whether the
 * window or the service found it.
 */
export const WORKSPACE_SLUG_REFUSAL = {
  [WORKSPACE_SLUG_PROBLEM.MALFORMED]: `Use lowercase letters and numbers, with single hyphens between them, up to ${WORKSPACE_BOUNDS.MAX_SLUG_CHARS} characters.`,
  [WORKSPACE_SLUG_PROBLEM.RESERVED]: "That link is reserved. Choose another.",
  [WORKSPACE_SLUG_PROBLEM.TAKEN]: "Another workspace already uses that link.",
} as const satisfies Record<WorkspaceSlugProblem, string>;

const _workspaceMembersSchema = EffectSchema.Array(workspaceMemberSchema);
const _formerMembersSchema = EffectSchema.Array(formerMemberSchema);

const _workspaceInvitationsSchema = EffectSchema.Array(workspaceInvitationSchema);

/** What a GitHub disconnect is refused with where GitHub is the account's only way to sign in. */
export const GITHUB_LAST_SIGN_IN_REFUSAL =
  `GitHub is the only way you sign in to this ${PRODUCT_NAME} account, so it cannot be disconnected.` as const;

/** What an invitation is refused with where the address is already in the workspace or already invited. */
export const ALREADY_INVITED_REFUSAL =
  "That address is already in this workspace or invited." as const;

/** An identifier's ends, admitted as written rather than trimmed, and refused when it carries nothing. */
function exactText(max: number): EffectSchema.Codec<string, string> {
  return EffectSchema.String.check(
    EffectSchema.makeFilter((value) => value.trim().length > 0),
    EffectSchema.isMaxLength(max),
  );
}

/**
 * An identifier that has to match the one it names elsewhere — a task or an
 * account — so its ends are admitted as written rather than trimmed into a
 * value the host would not hold.
 */
export const exactId = exactText(512);

/**
 * The longest fenced block a transcript asks main to color. Note that a
 * longer one is drawn plain rather than cut, because coloring costs main
 * a pass over every character and a block that long is a log, not a snippet.
 */
export const COLORED_CODE_MAX_CHARS = 20_000;

/** The longest language name a fence may give for its block to be colored. */
export const FENCE_LANGUAGE_MAX_CHARS = 32;

/** The one host the browser is sent to from a task: a repository's page, or the App's installation page. */
const GITHUB_ADDRESS = /^https:\/\/github\.com\//u;

/** An address on GitHub, and nowhere else: what a repository link, the installation link, or our own issues open. */
export const githubAddress = EffectSchema.String.check(
  EffectSchema.isMaxLength(2_048),
  EffectSchema.isPattern(GITHUB_ADDRESS),
);

/** Whether `github.open` takes an address, so a link drawn as a press is one the act will open. */
export const isGitHubAddress: (address: string) => boolean = EffectSchema.is(githubAddress);

/** An absolute web address's scheme, which is all `web.open` lets through to the browser. */
const WEB_ADDRESS = /^https?:\/\//iu;

/**
 * An address on the web, wherever it is: an absolute http or https address
 * the URL parser reads. Note that the scheme is the whole of the check,
 * because the browser is the one thing it opens in, and a `file:`,
 * `javascript:`, or another app's scheme would hand the address to
 * something else.
 */
const webAddress = EffectSchema.String.check(
  EffectSchema.isMaxLength(2_048),
  EffectSchema.isPattern(WEB_ADDRESS),
  EffectSchema.makeFilter((address) => URL.canParse(address)),
);

/** Whether an address is on the web, as `webAddress` reads it. */
export const isWebAddress: (address: string) => boolean = EffectSchema.is(webAddress);

/** A mail address's scheme. */
const MAIL_ADDRESS = /^mailto:/iu;

/**
 * A mail address as a link names it, `mailto:` and what follows, which
 * opens a draft in the mail app and nothing else. Note that it is let out
 * beside the web's alone, because it hands the system no more than a draft
 * to show.
 */
const mailAddress = EffectSchema.String.check(
  EffectSchema.isMaxLength(2_048),
  EffectSchema.isPattern(MAIL_ADDRESS),
  EffectSchema.makeFilter((address) => URL.canParse(address)),
);

/** Whether an address is a mail address, as `mailAddress` reads it. */
export const isMailAddress: (address: string) => boolean = EffectSchema.is(mailAddress);

/** What `web.open` lets out of the window: a web address, to the browser, or a mail address, to the mail app. */
export const openableAddress = EffectSchema.Union([webAddress, mailAddress]);
