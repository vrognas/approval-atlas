import * as d3 from "d3";
import { UI, formatShare } from "./labels.js";

// Compact tiles: the flag counts, labelled with their type badge's hue.
const COMPACT_HUES = { orphan: "pink", biosimilar: "teal", generic: "gold", advancedTherapy: "purple" };

// counts: countTiles() output plus authorized (authorized today). Two wide tiles (the medicines
// matching the filters, every status; those authorized today), then four compact ones with their
// share of the medicines and a meter; each says in one line what it counts (filtered: a filter is
// active, for the captions that say so).
// A compact tile explains its type on hover and keyboard focus (tabindex 0: a tab stop, as there is
// no other keyboard path to the Orphan explanation) and on a tap; screen readers read the
// explanation after the label.
export function renderTiles(container, counts, filtered) {
  const root = d3.select(container);
  const wide = UI.tiles.filter((spec) => !COMPACT_HUES[spec.key]);
  const compact = UI.tiles.filter((spec) => COMPACT_HUES[spec.key]);
  if (root.select(".tile").empty()) {
    root.selectAll("div.tile-wide").data(wide).join((enter) => {
      const tile = enter.append("div").attr("class", "tile tile-wide");
      tile.append("p").attr("class", "tile-label").text((spec) => spec.label);
      tile.append("p").attr("class", "tile-value");
      tile.append("p").attr("class", "tile-caption");
      return tile;
    });
    const tiles = root.append("div").attr("class", "tile-group").selectAll("div").data(compact).join("div")
      .attr("class", "tile tile-compact")
      .attr("data-tip", (spec) => UI.typeTips[spec.label])
      .attr("tabindex", "0");
    const label = tiles.append("p").attr("class", "tile-label");
    label.append("span").attr("class", (spec) => `badge hue-${COMPACT_HUES[spec.key]}`).text((spec) => spec.label);
    label.append("span").attr("class", "visually-hidden").text((spec) => `: ${UI.typeTips[spec.label]}`);
    const figure = tiles.append("p").attr("class", "tile-figure");
    figure.append("span").attr("class", "tile-value");
    figure.append("span").attr("class", "tile-share");
    tiles.append("div").attr("class", "meter").attr("aria-hidden", "true").append("div").attr("class", "meter-fill");
    tiles.append("p").attr("class", "tile-caption");
  }
  root.selectAll(".tile-caption").text((spec) => (filtered && spec.captionFiltered) || spec.caption);
  root.selectAll(".tile-value").text((spec) => d3.format(",")(counts[spec.key]));
  root.selectAll(".tile-share").text((spec) => formatShare(counts[spec.key], counts.products));
  root.selectAll(".meter-fill").style("width", (spec) => formatShare(counts[spec.key], counts.products));
}
