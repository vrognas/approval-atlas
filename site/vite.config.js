import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PLACEHOLDER = "__BUILD_VERSION__";

// Stamps dist/sw.js (copied from public/) with a hash of the built file names, which carry content
// hashes: a deploy that changes any asset installs a new worker with a new cache, and the new
// worker deletes the old cache so hashed assets don't pile up.
export function serviceWorkerVersion() {
  return {
    name: "service-worker-version",
    apply: "build",
    writeBundle(options, bundle) {
      const version = createHash("sha256").update(Object.keys(bundle).sort().join("\n")).digest("hex").slice(0, 12);
      const path = join(options.dir, "sw.js");
      const source = readFileSync(path, "utf8");
      if (!source.includes(PLACEHOLDER)) throw new Error(`${PLACEHOLDER} not found in ${path}`);
      writeFileSync(path, source.replace(PLACEHOLDER, version));
    },
  };
}

export default { plugins: [serviceWorkerVersion()] };
