// .pnpmfile.cjs -- package manifests pnpm reads differently from how they were published.

/**
 * `drizzle-orm` declares `expo-sqlite` an optional peer, and pnpm links an
 * optional peer to any copy the lockfile holds, so once the iOS app took
 * `expo-sqlite` the service's and the web app's `drizzle-orm` pulled Expo and
 * React Native, at the web's React, into the server's tree. Nothing on the
 * server opens drizzle's Expo driver, so the peer is dropped.
 */
function readPackage(manifest) {
  if (manifest.name === "drizzle-orm") {
    delete manifest.peerDependencies?.["expo-sqlite"];
    delete manifest.peerDependenciesMeta?.["expo-sqlite"];
  }

  return manifest;
}

module.exports = { hooks: { readPackage } };
