import * as d3 from "d3";
import { UI } from "./labels.js";

// counts: countTiles() output; each tile says in one line what it counts.
export function renderTiles(container, counts) {
  const tiles = d3.select(container).selectAll("div.tile").data(UI.tiles).join((enter) => {
    const tile = enter.append("div").attr("class", "tile");
    tile.append("p").attr("class", "tile-label").text((spec) => spec.label);
    tile.append("p").attr("class", "tile-value");
    tile.append("p").attr("class", "tile-caption").text((spec) => spec.caption);
    return tile;
  });
  tiles.select(".tile-value").text((spec) => d3.format(",")(counts[spec.key]));
}
