// Numerically verify face winding: for each face in FACES, compute the
// geometric normal from triangle (0,1,2) as cross(v1-v0, v2-v0) and
// compare to the declared `dir`. They should match (positive dot
// product) for CCW-front winding.

type V3 = [number, number, number];

interface Face {
  name: string;
  dir: V3;
  corners: V3[];
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: V3, b: V3): V3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm(a: V3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function verify(faces: Face[], label: string) {
  console.log(`\n=== ${label} ===`);
  console.log("Face        | Declared dir | Geometric normal (from tri 0,1,2) | Dot  | Status");
  console.log("------------|--------------|-----------------------------------|------|-------");
  let allOk = true;
  for (const f of faces) {
    const v0 = f.corners[0];
    const v1 = f.corners[1];
    const v2 = f.corners[2];
    const e1 = sub(v1, v0);
    const e2 = sub(v2, v0);
    const n = cross(e1, e2);
    const nLen = norm(n);
    const nUnit: V3 = [n[0] / nLen, n[1] / nLen, n[2] / nLen];
    const d = dot(nUnit, f.dir);
    const status = d > 0.5 ? "OK" : d < -0.5 ? "REVERSED" : "MISMATCH";
    if (status !== "OK") allOk = false;
    console.log(
      `${f.name.padEnd(11)} | (${f.dir.join(",")})  | (${nUnit.map((x) => x.toFixed(2)).join(", ")})              | ${d.toFixed(2)} | ${status}`
    );
  }
  console.log(allOk ? "ALL OK" : "BUG FOUND");
}

// Current FACES array from chunk.ts
const FACES_BEFORE: Face[] = [
  {
    name: "+X",
    dir: [1, 0, 0],
    corners: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]],
  },
  {
    name: "-X",
    dir: [-1, 0, 0],
    corners: [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]],
  },
  {
    name: "+Y (top)",
    dir: [0, 1, 0],
    corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  },
  {
    name: "-Y (bot)",
    dir: [0, -1, 0],
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  },
  {
    name: "+Z",
    dir: [0, 0, 1],
    corners: [[1, 0, 1], [0, 0, 1], [0, 1, 1], [1, 1, 1]],
  },
  {
    name: "-Z",
    dir: [0, 0, -1],
    corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
  },
];

verify(FACES_BEFORE, "BEFORE FIX (current chunk.ts)");

// After reversing each side face's corner order (and matching uvCorners
// labels), the geometric normal should match the declared dir.
const FACES_AFTER: Face[] = [
  {
    name: "+X",
    dir: [1, 0, 0],
    // reversed: original was [[1,0,0],[1,0,1],[1,1,1],[1,1,0]]
    corners: [[1, 1, 0], [1, 1, 1], [1, 0, 1], [1, 0, 0]],
  },
  {
    name: "-X",
    dir: [-1, 0, 0],
    // reversed: original was [[0,0,1],[0,0,0],[0,1,0],[0,1,1]]
    corners: [[0, 1, 1], [0, 1, 0], [0, 0, 0], [0, 0, 1]],
  },
  {
    name: "+Y (top)",
    dir: [0, 1, 0],
    corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], // unchanged
  },
  {
    name: "-Y (bot)",
    dir: [0, -1, 0],
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], // unchanged
  },
  {
    name: "+Z",
    dir: [0, 0, 1],
    // reversed: original was [[1,0,1],[0,0,1],[0,1,1],[1,1,1]]
    corners: [[1, 1, 1], [0, 1, 1], [0, 0, 1], [1, 0, 1]],
  },
  {
    name: "-Z",
    dir: [0, 0, -1],
    // reversed: original was [[0,0,0],[1,0,0],[1,1,0],[0,1,0]]
    corners: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]],
  },
];

// Re-verify against the actual in-source FACES array (post-fix).
// This reads chunk.ts source, extracts the FACES array literal, and
// recomputes geometric normals — so we're checking the live source,
// not a hand-copied mirror.

import { readFileSync } from "fs";

const src = readFileSync(
  "/home/z/my-project/src/lib/minecraft/chunk.ts",
  "utf8"
);

// Extract the FACES array body (between "const FACES: Face[] = [" and the matching "];")
const startIdx = src.indexOf("const FACES: Face[] = [");
if (startIdx === -1) {
  console.error("Could not find FACES array in chunk.ts");
  process.exit(1);
}
const endIdx = src.indexOf("\n];", startIdx);
const facesLiteral = src.slice(startIdx, endIdx + 3);

// For each face entry, extract dir and corners. Match the actual
// object-literal entries that begin with `    dir:` (4-space indent
// inside the array) and end before the next `    dir:` or `  },`.
const faceRegex = /\{\s*dir:\s*\[(-?\d),\s*(-?\d),\s*(-?\d)\][\s\S]*?corners:\s*\[((?:\s*\[-?\d,\s*-?\d,\s*-?\d\],?)+)\s*\]/g;
const faces: Face[] = [];
let m: RegExpExecArray | null;
let faceIdx = 0;
const names = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"];
while ((m = faceRegex.exec(facesLiteral)) !== null) {
  const dir: V3 = [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
  const cornersStr = m[4];
  // Extract all [n,n,n] triples
  const cornerRegex = /\[(-?\d),\s*(-?\d),\s*(-?\d)\]/g;
  const corners: V3[] = [];
  let c: RegExpExecArray | null;
  while ((c = cornerRegex.exec(cornersStr)) !== null) {
    corners.push([parseInt(c[1], 10), parseInt(c[2], 10), parseInt(c[3], 10)]);
  }
  if (corners.length !== 4) {
    console.error(`Face ${faceIdx}: expected 4 corners, got ${corners.length}`);
    continue;
  }
  faces.push({ name: names[faceIdx++] || `Face${faceIdx}`, dir, corners });
}

console.log(`\n=== LIVE SOURCE CHECK (chunk.ts as written) ===`);
console.log(`Extracted ${faces.length} faces from chunk.ts source.\n`);
verify(faces, "LIVE chunk.ts FACES array");
