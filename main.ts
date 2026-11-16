// ai-excited-01 entry "Sunleap": a whale made of night sky breaching over a colossal setting sun.
//
// The judged artifact is entry.png, committed beside this file (drawn offline, pixel by pixel, by
// tools/render.mjs). This entrypoint delivers it to the grader: it reads the committed bytes and writes
// them, unchanged, to <output>/entry.png. No network, no clock, no randomness: both runs write the same bytes.
//
// Outside the grader: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const image = readFileSync(new URL('./entry.png', import.meta.url));
const target = join(process.env.MAKEFUN_OUTPUT_DIR ?? '/output', 'entry.png');

// Hold the image to the gate's limits before handing it over, so a bad render fails here, loudly,
// instead of reaching the judge as an invalid entry: a PNG of at most 1 MiB and 1024 by 1024 pixels.
const isPng = image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
const width = image.readUInt32BE(16);
const height = image.readUInt32BE(20);
if (!isPng || image.length > 1048576 || width > 1024 || height > 1024) {
  throw new Error(`entry.png breaks the gate's limits: png=${isPng} bytes=${image.length} ${width}x${height}`);
}

writeFileSync(target, image);
