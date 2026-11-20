// Search, the `/` shortcut, and the table of contents' current section.
const { base } = document.body.dataset;
/** @type {HTMLDialogElement} */
const dialog = document.querySelector("#Search");
const input = dialog.querySelector("input");
const results = dialog.querySelector(".results");
// Results on the current page only change the fragment.
results.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("a")) {
    dialog.close();
  }
});

/** @type {Promise<{ name: string; kind: string; url: string; parent?: string }[]> | undefined} */
let index;

/**
 * @param {string} query What to search for.
 */
async function search(query) {
  // A failed request is made again on the next search.
  index ??= fetch(`${base}assets/search.json`)
    .then((response) => {
      if (!response.ok) throw new Error(response.statusText);
      return response.json();
    })
    .catch((/** @type {unknown} */ e) => {
      index = undefined;
      const item = document.createElement("li");
      item.textContent = "Search could not be loaded. Try again.";
      results.replaceChildren(item);
      throw e;
    });
  const entries = await index;
  const needle = query.trim().toLowerCase();
  if (input.value.trim().toLowerCase() !== needle) return;
  const matches = needle
    ? entries.flatMap((entry) => {
        // Members are found by their names, and as `Parent.member`.
        const name = entry.name.toLowerCase();
        const full =
          entry.parent === undefined
            ? name
            : `${entry.parent.toLowerCase()}.${name}`;
        if (!full.includes(needle)) return [];
        return [
          {
            entry,
            isPrefix: name.startsWith(needle) || full.startsWith(needle),
          },
        ];
      })
    : [];
  // Names starting with the query first, then shorter names.
  matches.sort(
    (left, right) =>
      Number(right.isPrefix) - Number(left.isPrefix) ||
      left.entry.name.length - right.entry.name.length,
  );
  if (needle && matches.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No results";
    results.replaceChildren(item);
    return;
  }
  results.replaceChildren(
    ...matches.slice(0, 20).map(({ entry }) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      // URLs are relative to the site, or absolute for dependencies.
      link.href = new URL(entry.url, new URL(base, location.href)).href;
      const name = document.createElement("span");
      if (entry.parent !== undefined) {
        const parent = document.createElement("span");
        parent.className = "result-parent";
        parent.textContent = `${entry.parent}.`;
        name.append(parent);
      }
      name.append(entry.name);
      const kind = document.createElement("span");
      kind.className = "result-kind";
      kind.textContent = entry.kind;
      link.append(name, kind);
      item.append(link);
      return item;
    }),
  );
}

input.addEventListener("input", () => {
  search(input.value).catch(reportError);
});
input.addEventListener("keydown", (event) => {
  // Enter also ends input methods' compositions.
  if (event.key === "Enter" && !event.isComposing) {
    results.querySelector("a")?.click();
  }
});
dialog.addEventListener("close", () => {
  input.value = "";
  results.replaceChildren();
});

// A modified shortcut, which typing and dictation cannot trigger.
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "k" && !dialog.open) {
    event.preventDefault();
    dialog.showModal();
  }
});

/**
 * Mirrors the section in view, which CSS highlights, for assistive technology.
 */
function syncCurrent() {
  const current = document.querySelector(".toc a:target-current");
  for (const link of document.querySelectorAll(".toc a")) {
    link.setAttribute("aria-current", String(link === current));
  }
}

if (CSS.supports("scroll-target-group: auto")) {
  syncCurrent();
  document.addEventListener("scrollend", syncCurrent);
}

export {};
