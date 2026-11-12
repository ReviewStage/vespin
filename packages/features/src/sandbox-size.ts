/**
 * sandbox-size.ts -- how large a cloud agent's sandbox opens: its vCPUs, by its repository, and the memory each brings.
 *
 * The service opens the sandbox at this size (`sandbox-machine.ts`), and the
 * panel names it on the agent's Runs on card, so both read it here. Note that
 * a stopped sandbox is opened again from its snapshot at whatever size the
 * create asks, so a change here reaches a standing agent at its next open.
 */

export const SANDBOX_SIZE = {
  /**
   * The sandbox's vCPUs where its repository asks for no more
   * (`VCPUS_BY_REPOSITORY`); also the size a repository snapshot is built
   * at, since Vercel opens a snapshot at whatever size the create asks. Two,
   * because provisioned memory and active CPU are most of the sandboxes'
   * bill and both scale with vCPUs, so a repository whose own checks need
   * more asks for it rather than every sandbox paying for it.
   */
  VCPUS: 2,
  /** The memory Vercel gives a sandbox per vCPU, in GB. */
  MEMORY_GB_PER_VCPU: 2,
  /**
   * The repositories whose agents' sandboxes open larger than `VCPUS`, by
   * `owner/name` lowercased, as `sandboxVcpus` reads them; a repository asks
   * for more by a row here. This repository's own is four, because its
   * typecheck needs about 5 GB of real memory. Measured on a fresh checkout:
   * `pnpm typecheck` takes 83 seconds at four vCPUs and peaks near 5.2 GB,
   * and at two vCPUs (4 GB) it is killed out of memory at a workspace
   * concurrency of 4 or 2; at 1 it passes in 194 seconds with 216 MiB free,
   * before the agent's own runner is counted. The service's tests take 1,527
   * seconds there against 415. Note that oxlint is not the limit: with JS
   * plugins it reserves about 6 GiB per thread, which the kernel's default
   * overcommit refuses at 4 GB, but it uses under one, and
   * `vm.overcommit_memory=1`, set on every boot, since a resumed sandbox
   * boots with the default, lets it lint there in 36 seconds.
   */
  // SAFETY: a Map is a ReadonlyMap; the narrower type keeps callers from writing to the shared table.
  VCPUS_BY_REPOSITORY: new Map([["reviewstage/vespin", 4]]) as ReadonlyMap<string, number>,
} as const;

/** The vCPUs an agent's sandbox opens with: what its repository asks for, or `SANDBOX_SIZE.VCPUS` for one that asks for nothing and for an agent with no repository. */
export function sandboxVcpus(repository: string | null): number {
  if (repository === null) return SANDBOX_SIZE.VCPUS;

  return SANDBOX_SIZE.VCPUS_BY_REPOSITORY.get(repository.toLowerCase()) ?? SANDBOX_SIZE.VCPUS;
}

/** A sandbox's memory, in GB, at its vCPUs. */
export function sandboxMemoryGb(vcpus: number): number {
  return vcpus * SANDBOX_SIZE.MEMORY_GB_PER_VCPU;
}
