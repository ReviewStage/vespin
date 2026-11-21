/**
 * mutation-calls.ts -- a mutation's calls, for a caller that draws nothing of where the mutation stands.
 *
 * `useMutation` follows its mutation as it runs, so its caller is drawn
 * again as each call goes out and again as it lands, whether or not the
 * caller reads `isPending` or `data`. The window's hooks (`useTasksTab`,
 * `useAgents`, `AppWindow`) hold dozens of mutations whose calls are all they
 * read, so each step between tasks, whose open is one of those calls, drew the
 * whole window twice more for nothing. These calls run the same mutation,
 * under the same options and the same mutation cache, and draw nothing.
 */

import {
  type DefaultError,
  MutationObserver,
  type UseMutationOptions,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";

/** A mutation's two calls, as `useMutation` hands them, standing across draws. */
interface MutationCalls<TData, TVariables> {
  /** Runs the mutation, a failure caught, as `useMutation`'s `mutate` does. */
  readonly mutate: (variables: TVariables) => void;
  /** Runs the mutation and answers with what it lands with, or throws what it failed with. */
  readonly mutateAsync: (variables: TVariables) => Promise<TData>;
}

/** Nothing, which hears the observer and catches a failure `mutate` lets go. */
const IGNORE = (): void => undefined;

/**
 * The calls of the mutation `options` describes, without following it. Note
 * that the observer is still listened to while the caller stands, by
 * nothing, so it lets go of its last mutation as the caller leaves, as
 * `useMutation`'s does.
 */
export function useMutationCalls<
  TData = unknown,
  TError = DefaultError,
  TVariables = void,
  TContext = unknown,
>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
): MutationCalls<TData, TVariables> {
  const client = useQueryClient();
  const [observer] = useState(() => new MutationObserver(client, options));
  useEffect(() => {
    observer.setOptions(options);
  }, [observer, options]);
  useEffect(() => observer.subscribe(IGNORE), [observer]);

  const [calls] = useState<MutationCalls<TData, TVariables>>(() => ({
    mutate: (variables) => {
      observer.mutate(variables).catch(IGNORE);
    },
    mutateAsync: (variables) => observer.mutate(variables),
  }));

  return calls;
}
