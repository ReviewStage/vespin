/**
 * task-follower.ts -- one member following a task, as every reader of the task's followers reads them.
 *
 * A follower is named by their account's id; a reader names them from the
 * workspace's members it already holds. `assignee` says whether they are the
 * task's assignee, who follows it while assigned and may not unfollow, and
 * `machines` whether the task's agents may use their machines, a switch
 * only they flip. Declared here, below the task's own wire, so the hosted
 * service, its tools, and every client spell one shape.
 */

import { Schema } from "effect";

export const taskFollowerSchema = Schema.Struct({
  userId: Schema.String,
  assignee: Schema.Boolean,
  machines: Schema.Boolean,
});

export type TaskFollowerWire = typeof taskFollowerSchema.Type;
