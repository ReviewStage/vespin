/**
 * admin-catalog-wire.ts -- the admin catalog's answer: the coding agent's tools, the prompts, the service's own limits, and the turn pipeline, as this deploy's code holds them.
 *
 * Nothing in it is read from the database or counted from use: each figure
 * is measured from the module that holds it, so it says what the running
 * deploy offers, never what was called. A size is in characters of the text
 * a model is handed, since a token count depends on its tokenizer.
 */

/** Where a coding agent meets a tool: listed from its first turn, or found only through tool search. */
export const ADMIN_TOOL_LOADING = {
  FIRST_TURN: "first-turn",
  SEARCH: "search",
} as const;

export type AdminToolLoading = (typeof ADMIN_TOOL_LOADING)[keyof typeof ADMIN_TOOL_LOADING];

/** How a limit's value is read: a span in milliseconds or a plain count. */
export const ADMIN_LIMIT_UNIT = {
  DURATION_MS: "duration-ms",
  COUNT: "count",
} as const;

export type AdminLimitUnit = (typeof ADMIN_LIMIT_UNIT)[keyof typeof ADMIN_LIMIT_UNIT];

/** Which queue a queued turn rides to the function that runs it. */
export const ADMIN_TURN_PIPELINE = {
  VERCEL_QUEUES: "vercel-queues",
  IN_PROCESS: "in-process",
} as const;

export type AdminTurnPipeline = (typeof ADMIN_TURN_PIPELINE)[keyof typeof ADMIN_TURN_PIPELINE];

/** One of Vespin's own tools as a coding agent is offered it. */
export interface AdminCatalogTool {
  name: string;
  /** Its description and its input's JSON Schema together, in characters. */
  definitionChars: number;
  loading: AdminToolLoading;
  /** The gate it stands behind, by the gate's own name; null for a tool every agent is offered. */
  gate: string | null;
}

/** One `## ` section of a prompt, the text before the first heading named by none. */
export interface AdminPromptSection {
  heading: string | null;
  chars: number;
}

/** One prompt a model is handed, measured as its static text stands. */
export interface AdminCatalogPrompt {
  /** What the prompt is for, in the admin's words. */
  label: string;
  /** The symbol that holds or builds it, for a reader to grep. */
  source: string;
  chars: number;
  sections: AdminPromptSection[];
}

/** One limit only the service holds, as its constant says it. */
export interface AdminCatalogLimit {
  /** The area it bounds, as the Limits page groups it. */
  group: string;
  label: string;
  /** The constant that holds it, for a reader to grep. */
  constant: string;
  unit: AdminLimitUnit;
  value: number;
}

export interface AdminCatalog {
  generatedAt: number;
  /** The tools in the order an agent's tool list names them. */
  tools: AdminCatalogTool[];
  prompts: AdminCatalogPrompt[];
  limits: AdminCatalogLimit[];
  pipeline: AdminTurnPipeline;
}
