// The lookup's datasets (no DOM): each built from its data files on first use. A file given as
// { optional } is built as null when it fails to load (a newer file missing from older data, or
// the network gone); after the next retry() (a new lookup view) such a dataset is asked for once
// more by the first need() of it (the next card or list that uses it, not the overview in between),
// keeping what it has meanwhile, so a flaky moment does not leave a part empty until a reload,
// while older data costs one extra request, not one per card (backlog, step 4 review).

export const FAILED = Symbol("failed");

// definitions: { name: [files, build(...rows)] }; loadFile(name): a Promise of the file's rows;
// onLoad(name): a dataset arrived, or changed after a retry.
export function createDatasets(definitions, loadFile, onLoad) {
  const values = new Map();
  const incomplete = new Set(); // built without an optional file, not retried yet
  const retryDue = new Set(); // incomplete at a new view: retried by the next need()
  const loadRows = (file) => (typeof file === "string" ? loadFile(file) : loadFile(file.optional).catch(() => null));
  function load(name) {
    const [files, build] = definitions[name];
    return Promise.all(files.map(loadRows)).then((rows) => ({
      build: () => build(...rows),
      complete: files.every((file, position) => typeof file === "string" || rows[position] !== null),
    }));
  }

  // The value, FAILED, or undefined while loading (the first call starts the load; the first after
  // a retry() starts the retry of a dataset built without an optional file).
  function need(name) {
    if (retryDue.delete(name)) reload(name);
    if (values.has(name)) return values.get(name);
    values.set(name, undefined);
    load(name).then(({ build, complete }) => {
      if (!complete) incomplete.add(name);
      return build();
    }, () => FAILED).then((value) => {
      values.set(name, value);
      onLoad(name);
    });
    return undefined;
  }

  // One built without an optional file asks for it once more, and changes only if it arrives (a
  // needed file failing then keeps the value too).
  function reload(name) {
    load(name).then(({ build, complete }) => {
      if (!complete) return;
      values.set(name, build());
      onLoad(name);
    }, () => {});
  }

  // A new view: datasets that failed load again when next needed; one built without an optional
  // file is retried when next needed (a failed one loads from scratch instead).
  function retry() {
    for (const [name, value] of values) if (value === FAILED) values.delete(name);
    for (const name of incomplete) if (values.has(name)) retryDue.add(name);
    incomplete.clear();
  }

  // The value as need() gives it, without starting a load.
  return { need, retry, peek: (name) => values.get(name) };
}
