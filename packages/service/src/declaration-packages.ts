/**
 * declaration-packages.ts -- the packages this one's declarations name types from, imported so the compiler can name them.
 *
 * Better Auth's plugins type their endpoints with zod's core types, so the
 * declarations this package emits for `auth` and the test plugins beside it
 * name them (`tsconfig.package.json`). The compiler names a type in a
 * package only by a path some file of the program already imported that
 * package through; reached only through `better-auth`'s own folder under
 * pnpm's store, it refuses them as not portable. Note that we import zod's
 * core here, its bindings left out, rather than in each file whose
 * declarations name it, because one import anywhere in the program is enough
 * and those files read nothing from it.
 */

import type {} from "zod/v4/core";
