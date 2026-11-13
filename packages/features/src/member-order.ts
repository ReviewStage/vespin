// member-order.ts -- the order every people list of a workspace stands in: the reader first, then everyone else by name.

/** The members with the reader first and everyone else by name, as every people menu lists them, the panel's and the iPhone's alike. */
export function readerFirst<Member extends { readonly userId: string; readonly name: string }>(
  members: readonly Member[],
  readerId: string | undefined,
): readonly Member[] {
  return [...members].sort(
    (one, other) =>
      Number(other.userId === readerId) - Number(one.userId === readerId) ||
      one.name.localeCompare(other.name),
  );
}
