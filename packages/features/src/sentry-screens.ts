/**
 * sentry-screens.ts -- what the iOS app's traces of its screens and taps may carry: a screen's name, a component's name, and timings, never an id or the words on screen.
 *
 * Sentry's React Native SDK names a tap by the nearest label it finds on
 * the touched element or above it (its `accessibilityLabel`, `aria-label`,
 * or `testID`), and the app's rows label themselves with what they show,
 * such as a thread's words or a channel's name. So a tap's breadcrumb, and
 * the breadcrumb of a run of taps on one element (a rage tap), keep the
 * touched components' names and files and lose every label, and their
 * message names the component, as the SDK words one it found no label for.
 *
 * A screen change's span names its screen by the route's file path, its
 * dynamic segments left as written (`agent/[id]`), and its route's value
 * only where `sendDefaultPii` is on, which the app never sets. It also
 * carries React Navigation's key for the route and the route before it,
 * a generated id for each screen pushed, which is dropped.
 *
 * Written against the few fields read rather than the SDK's types, as
 * `sentry-breadcrumbs.ts` is, so the SDK's breadcrumb and transaction come
 * back as they were given, less what is dropped.
 */

import type { SpanAttributes } from "@sentry/core";
import { Option, Schema } from "effect";

/** The breadcrumb categories the SDK writes a tap under: each tap, and a run of taps on one element. */
const TAP_CATEGORY = { TOUCH: "touch", RAGE_TAP: "ui.multiClick" } as const;

const TAP_CATEGORIES: ReadonlySet<string | undefined> = new Set(Object.values(TAP_CATEGORY));

/** What the SDK's tap breadcrumb says before the touched element. */
const TOUCH_MESSAGE = "Touch event within element: ";

/** What a tap's message names where no touched component has a name. */
const UNNAMED_COMPONENT = "unnamed";

/**
 * What of each touched component a tap's breadcrumb keeps: its name, its
 * element, and its file. Note that decoding drops every other field, its
 * label among them.
 */
const TouchedPathSchema = Schema.Array(
  Schema.Struct({
    name: Schema.optional(Schema.String),
    element: Schema.optional(Schema.String),
    file: Schema.optional(Schema.String),
  }),
);

type TouchedPath = typeof TouchedPathSchema.Type;

const decodeTouchedPath = Schema.decodeUnknownOption(TouchedPathSchema);

/** What of a breadcrumb is read: its category, and the touched path and replay node a tap's carries. */
interface BreadcrumbText {
  readonly category?: string;
  readonly message?: string;
  readonly data?: { readonly path?: unknown; readonly node?: unknown };
}

/** What of a span in a transaction is read: the attributes React Navigation keeps its generated route keys in. */
interface SpanRouteKeys {
  readonly data?: SpanAttributes;
}

/** What of a transaction is read: its root span's attributes and each other span's. */
interface TransactionRouteKeys {
  readonly contexts?: { readonly trace?: SpanRouteKeys };
  readonly spans?: readonly SpanRouteKeys[];
}

/** The nearest named component of a touched path, as the SDK words one it found no label for: its name, then its file in parentheses. */
function touchedName(path: TouchedPath): string {
  const touched = path.find(({ name }) => name !== undefined);

  if (touched?.name === undefined) return UNNAMED_COMPONENT;

  return touched.file === undefined ? touched.name : `${touched.name} (${touched.file})`;
}

/** A span less React Navigation's route keys. */
function spanWithoutRouteKeys<Span extends SpanRouteKeys>(span: Span): Span {
  if (span.data === undefined) return span;
  const { "route.key": _key, "previous_route.key": _previousKey, ...data } = span.data;

  return { ...span, data };
}

/**
 * Sentry's `beforeBreadcrumb`, after the token filter: a tap's breadcrumb,
 * or a rage tap's, with every label gone from its touched path, its message
 * naming the nearest named component, and its replay node (which repeats
 * the label) dropped; any other breadcrumb as it was.
 */
export function tapWithoutWords<Crumb extends BreadcrumbText>(breadcrumb: Crumb): Crumb {
  if (!TAP_CATEGORIES.has(breadcrumb.category)) return breadcrumb;
  const { node: _node, path, ...data } = breadcrumb.data ?? {};
  const touched = Option.getOrElse(decodeTouchedPath(path), (): TouchedPath => []);
  const name = touchedName(touched);

  return {
    ...breadcrumb,
    message: breadcrumb.category === TAP_CATEGORY.TOUCH ? `${TOUCH_MESSAGE}${name}` : name,
    data: { ...data, path: touched },
  };
}

/** Sentry's `beforeSendTransaction`: the transaction with React Navigation's route keys gone from its root span and every other span. */
export function transactionWithoutRouteKeys<Transaction extends TransactionRouteKeys>(
  transaction: Transaction,
): Transaction {
  const { contexts, spans } = transaction;

  return {
    ...transaction,
    ...(contexts?.trace
      ? { contexts: { ...contexts, trace: spanWithoutRouteKeys(contexts.trace) } }
      : undefined),
    ...(spans ? { spans: spans.map(spanWithoutRouteKeys) } : undefined),
  };
}
