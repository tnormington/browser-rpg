// What the placer (sim/edges.ts) needs of each kind, read off the artist's recipes (edges.ts) so the numbers live in one place and the sim imports no drawing.
import { EDGE_KINDS, edgeRecipe } from './edges';
import type { EdgeStyles } from './sim/edges';

let styles: EdgeStyles | undefined;
export function edgeStyles(): EdgeStyles {
  return styles ??= Object.fromEntries(EDGE_KINDS.map(kind => {
    const r = edgeRecipe(kind);
    return [kind, { spacing: r.spacing, ranks: r.ranks, depth: r.depth, scale: r.scale, variants: r.pieces.length, gap: r.gap, sink: r.sink, along: r.yaw === 'along' }];
  })) as EdgeStyles;
}
