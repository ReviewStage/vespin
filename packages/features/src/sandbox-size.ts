/**
 * sandbox-size.ts -- how large a cloud agent's sandbox opens: the vCPUs its workspace chose, and the memory each brings.
 *
 * The service opens an agent's sandbox at this size (`sandbox-machine.ts`),
 * and the panel names it on the agent's Runs on card, so both read it here.
 * Note that a standing sandbox resumes at the size it was created with, so
 * the service resizes a stopped one before it resumes it
 * (`@repo/sandbox`'s `getOrCreate`), and a change reaches a standing agent
 * at its next open after its sandbox stops.
 */

/**
 * The vCPUs a workspace's agents' sandboxes may open with, each bringing
 * `SANDBOX_SIZE.MEMORY_GB_PER_VCPU` of memory: 4, 8, and 16 GB. Eight is the
 * most Vercel's Pro plan opens a sandbox with.
 */
export const SANDBOX_VCPUS = {
  TWO: 2,
  FOUR: 4,
  EIGHT: 8,
} as const;

export type SandboxVcpus = (typeof SANDBOX_VCPUS)[keyof typeof SANDBOX_VCPUS];

/** Every size a workspace may choose, smallest first. */
export const SANDBOX_VCPU_SIZES: readonly SandboxVcpus[] = Object.values(SANDBOX_VCPUS);

export const SANDBOX_SIZE = {
  /**
   * The sandbox's vCPUs where its workspace chose no other; also the size a
   * workspace's drive and its repositories' snapshots are built at, since
   * Vercel opens a snapshot at whatever size the create asks. Two, because
   * provisioned memory and active CPU are most of the sandboxes' bill and
   * both scale with vCPUs, so a workspace whose checks need more chooses it
   * rather than every sandbox paying for it.
   */
  VCPUS: SANDBOX_VCPUS.TWO,
  /** The memory Vercel gives a sandbox per vCPU, in GB. */
  MEMORY_GB_PER_VCPU: 2,
} as const;

/** A sandbox's memory, in GB, at its vCPUs. */
export function sandboxMemoryGb(vcpus: number): number {
  return vcpus * SANDBOX_SIZE.MEMORY_GB_PER_VCPU;
}
