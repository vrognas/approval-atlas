import * as d3 from "d3";
import { UI, formatShare } from "./labels.js";

// Compact tiles: the flag counts, labelled with their type badge's hue.
const COMPACT_HUES = { orphan: "pink", biosimilar: "teal", generic: "gold", advancedTherapy: "purple" };

// counts: countTiles() output. The four type tiles (2 x 2 beside "Authorized over time"; the
// headline states the medicines and those currently authorized, owner decision 2026-09-29), each
// with its share of the medicines matching the filters and a meter, and in one line what it counts.
// A tile explains its type on hover and keyboard focus (tabindex 0: a tab stop, as there is no
// other keyboard path to the Orphan explanation) and on a tap; screen readers read the explanation
// after the label.
export function renderTiles(container, counts) {
  const root = d3.select(container);
  if (root.select(".tile").empty()) {
    const tiles = root.selectAll("div").data(UI.tiles).join("div")
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
    tiles.append("p").attr("class", "tile-caption").text((spec) => spec.caption);
  }
  root.selectAll(".tile-value").text((spec) => d3.format(",")(counts[spec.key]));
  root.selectAll(".tile-share").text((spec) => formatShare(counts[spec.key], counts.products));
  root.selectAll(".meter-fill").style("width", (spec) => formatShare(counts[spec.key], counts.products));
}
