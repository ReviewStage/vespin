import { useQuery } from "@tanstack/react-query";
import { appStateQuery, selectRun } from "./use-app-state.js";

/**
 * repository-pictures.ts -- whether a surface draws a repository by its owner's picture.
 *
 * Every surface asks the window's run. A fixture run draws none, because
 * its frames ask nothing of the network.
 */
export function useRepositoryPictures(): boolean {
  return useQuery({ ...appStateQuery, select: selectRun }).data?.fixtureMode !== true;
}
