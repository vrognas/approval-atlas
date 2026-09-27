import * as d3 from "d3";
import { UI, formatShare } from "./labels.js";

// Compact tiles: the flag counts, labelled with their type badge's hue.
const COMPACT_HUES = { orphan: "pink", biosimilar: "teal", generic: "gold", advancedTherapy: "purple" };

// counts: countTiles() output. Two wide tiles (products, substances), then four compact ones
// with their share of the authorized products and a meter; each says in one line what it counts.
export function renderTiles(container, counts) {
  const root = d3.select(container);
  const wide = UI.tiles.filter((spec) => !COMPACT_HUES[spec.key]);
  const compact = UI.tiles.filter((spec) => COMPACT_HUES[spec.key]);
  if (root.select(".tile").empty()) {
    root.selectAll("div.tile-wide").data(wide).join((enter) => {
      const tile = enter.append("div").attr("class", "tile tile-wide");
      tile.append("p").attr("class", "tile-label").text((spec) => spec.label);
      tile.append("p").attr("class", "tile-value");
      tile.append("p").attr("class", "tile-caption").text((spec) => spec.caption);
      return tile;
    });
    const tiles = root.append("div").attr("class", "tile-group").selectAll("div").data(compact).join("div").attr("class", "tile tile-compact");
    tiles.append("p").attr("class", "tile-label").append("span").attr("class", (spec) => `badge hue-${COMPACT_HUES[spec.key]}`).text((spec) => spec.label);
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
