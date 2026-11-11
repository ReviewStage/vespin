/**
 * checkout-path.ts -- where an agent's checkout stands, in the cloud and on a Mac, and a path an agent wrote read as a path in it.
 *
 * A harness's own file tools name every file by its absolute path, and an
 * agent writes either kind in its words, so the transcript reads both into
 * the checkout here, once, for every chip of a file it draws. The window
 * knows no agent's checkout folder, only where every one stands: the cloud's
 * at one path in its sandbox, and a Mac's in the agent's own folder under
 * its starter's home, whose home the path does not say. So an absolute path
 * is read under the checkout only where it stands at one of those two, and
 * nowhere else that happens to hold a folder named like one.
 *
 * A leaf importing nothing, because the sandbox's contract
 * (`repository-sandbox-contract.ts`) names the cloud checkout from here and
 * every coding agent tool file reads that contract.
 */

/** Where a cloud agent's checkout stands in its sandbox. */
export const CLOUD_CHECKOUT_PATH = "/workspace/repository";

/** The folders under a Mac's home its local agents' things stand in (`deviceAgentLayoutIn`). */
export const DEVICE_AGENT_FOLDER = {
  /** Every local agent's folder, one per agent under its id. */
  ROOT: ".vespin/agents",
  /** The agent's worktree, which the Mac makes as it takes the launch line. */
  REPOSITORY: "repository",
} as const;

/** A path in a Mac agent's checkout, past `…/.vespin/agents/<agent>/repository/`; none for any other. */
function inMacCheckout(path: string): string | undefined {
  const root = `/${DEVICE_AGENT_FOLDER.ROOT}/`;
  const at = path.indexOf(root);
  if (at < 0) return undefined;
  const agent = path.slice(at + root.length);
  const slash = agent.indexOf("/");
  const checkout = `${DEVICE_AGENT_FOLDER.REPOSITORY}/`;
  if (slash <= 0 || !agent.startsWith(checkout, slash + 1)) return undefined;
  return agent.slice(slash + 1 + checkout.length);
}

/**
 * A path as written, read as a path in the checkout: a relative one as it
 * is, past a leading `./`; an absolute one in the cloud's checkout or a Mac
 * agent's; none for an absolute one anywhere else, or one that climbs out
 * or names no file.
 */
export function checkoutRelativePath(written: string): string | undefined {
  const cloud = `${CLOUD_CHECKOUT_PATH}/`;
  let path: string | undefined = written;
  if (written.startsWith(cloud)) path = written.slice(cloud.length);
  else if (written.startsWith("/")) path = inMacCheckout(written);
  else if (written.startsWith("./")) path = written.slice(2);
  if (path === undefined) return undefined;
  const steps = path.split("/");
  if (steps.some((step) => step === "" || step === "." || step === "..")) return undefined;
  return path;
}
