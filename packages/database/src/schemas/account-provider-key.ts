import {
  type ChatGptDeviceSettled,
  type FastAccess,
  PROVIDER_KEY_KIND,
  type ProviderKeyKind,
  type ProviderKeyProvider,
  type ProviderKeyStatus,
} from "@repo/features/provider-key-wire";
import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * One of an account's own provider credentials, an API key or a
 * subscription's credential as its kind says, sealed by
 * `models/provider-key-seal.ts`: no column holds the key or the data key in
 * the clear. A provider holds at most one API key, and as many
 * subscriptions of a kind as the account adds, each its own row in the
 * account's order (`position`), so a provider's API key and its
 * subscriptions stand side by side. The hint is the one part of the key
 * kept readable, its prefix and last four characters, so the account can
 * tell its keys apart. Saving over a row replaces its credential whole,
 * removing one deletes it, and every row leaves with the account.
 */
export const accountProviderKey = pgTable(
  "account_provider_key",
  {
    /** The row's own id, which names one subscription among the account's several of a kind. */
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").$type<ProviderKeyProvider>().notNull(),
    /** What the credential is; every row from before kinds is an API key. */
    kind: text("kind").$type<ProviderKeyKind>().notNull().default(PROVIDER_KEY_KIND.API_KEY),
    /** The version of the deployment's key-encryption key the data key is wrapped under. */
    keyVersion: integer("key_version").notNull(),
    /** base64 of nonce, ciphertext, and tag: the data key under the key-encryption key. */
    sealedDataKey: text("sealed_data_key").notNull(),
    /** base64 of nonce, ciphertext, and tag: the provider key under the data key. */
    sealedKey: text("sealed_key").notNull(),
    hint: text("hint").notNull(),
    status: text("status").$type<ProviderKeyStatus>().notNull(),
    statusAt: timestamptz("status_at").notNull(),
    /** Whether the key's organization may run Anthropic's fast mode, as a fast request on the key last settled; null where none has. */
    fastAccess: text("fast_access").$type<FastAccess>(),
    /**
     * When the access token a ChatGPT plan's sealed credentials hold
     * expires, so a refresh is due without opening them; null for every
     * other kind, whose credential carries no expiry we read.
     */
    accessExpiresAt: timestamptz("access_expires_at"),
    /**
     * Whether a subscription credential pays for the account's coding agents
     * by default ("Use my Claude plan for coding agents"): on as the plan is
     * connected, kept across a replaced token, and gone with the row on a
     * disconnect, so connecting again turns it back on. Start may pick
     * another payer for one agent whatever it says. An API key's row keeps
     * the default and nothing reads it.
     */
    forAgents: boolean("for_agents").notNull().default(true),
    /** When a plan's reached usage limit resets, where its provider said; null for every other status. */
    limitResetsAt: timestamptz("limit_resets_at"),
    /** Where the subscription stands in the account's order of its kind, the first paying first; an API key's is 0. */
    position: integer("position").notNull().default(0),
    /** The name the account gave the subscription; null for the name it is shown by default. */
    label: text("label"),
    /** The email of the account a ChatGPT subscription signed in as, as its ID token named it; null for every other kind. */
    accountEmail: text("account_email"),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    // A provider holds one API key per account, which a save replaces.
    uniqueIndex("account_provider_key_api_key")
      .on(table.userId, table.provider)
      .where(sql`${table.kind} = 'api_key'`),
    // An account's subscriptions of a kind are read in their order.
    index("account_provider_key_order").on(
      table.userId,
      table.provider,
      table.kind,
      table.position,
    ),
  ],
);

/**
 * One of the account's pending connections of a ChatGPT plan through
 * Codex's device-code login, keyed by the login, so two sign-ins may stand
 * at once and each adds or replaces its own subscription; the account's
 * next start clears those whose code lapsed. The device authorization and its user code,
 * which together claim the sign-in at OpenAI, are held only as the service
 * sealed them (`models/provider-key-seal.ts`'s `sealChatGptDeviceCodes`),
 * bound to the account and the login, never in the clear and never in the
 * panel, and leave the row once it settles. `outcome` is how it settled,
 * null while it is pending, so a poll after the one that settled it answers
 * the same. The row leaves with its account.
 */
export const accountChatGptDeviceLogin = pgTable("account_chatgpt_device_login", {
  /** The opaque id the panel polls and cancels the login by, minted afresh at every start. */
  loginId: text("login_id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Whether the plan it connects is added at the bottom of the account's order rather than replacing its first. */
  adds: boolean("adds").notNull().default(false),
  /** The device authorization and user code as the service sealed them; null once the login settled. */
  sealedCodes: text("sealed_codes"),
  /** How the login settled; null while it is pending. */
  outcome: text("outcome").$type<ChatGptDeviceSettled>(),
  /** When OpenAI stops taking the user code, fifteen minutes after the start. */
  expiresAt: timestamptz("expires_at").notNull(),
  createdAt: timestamptz("created_at").notNull(),
});
