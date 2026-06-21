// Verify that reversing corners AND uvCorners in lockstep keeps the
// (physical-position -> texture-corner) pairing identical for each
// vertex. This is what guarantees the texture orientation is unchanged
// after the winding fix.

type V3 = [number, number, number];
type UVLabel = "BL" | "BR" | "TR" | "TL";

interface FaceVertex {
  pos: V3;
  uv: UVLabel;
}

interface FaceDef {
  name: string;
  corners: V3[];
  uvCorners: [UVLabel, UVLabel, UVLabel, UVLabel];
}

// Build a set of (pos -> uvLabel) pairs for comparison.
function pairingSet(f: FaceDef): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < 4; i++) {
    s.add(`${f.corners[i].join(",")} -> ${f.uvCorners[i]}`);
  }
  return s;
}

function reverse<T>(arr: [T, T, T, T]): [T, T, T, T] {
  return [arr[3], arr[2], arr[1], arr[0]];
}

const SIDE_FACES: FaceDef[] = [
  {
    name: "+X",
    corners: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]],
    uvCorners: ["BR", "BL", "TL", "TR"],
  },
  {
    name: "-X",
    corners: [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]],
    uvCorners: ["BR", "BL", "TL", "TR"],
  },
  {
    name: "+Z",
    corners: [[1, 0, 1], [0, 0, 1], [0, 1, 1], [1, 1, 1]],
    uvCorners: ["BR", "BL", "TL", "TR"],
  },
  {
    name: "-Z",
    corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
    uvCorners: ["BR", "BL", "TL", "TR"],
  },
];

console.log("=== UV-PAIRING INVARIANCE CHECK ===");
console.log("Reversing corners + uvCorners in lockstep must preserve (pos -> UV label) pairing.\n");

let allInvariant = true;
for (const f of SIDE_FACES) {
  const before = pairingSet(f);
  const after: FaceDef = {
    name: f.name,
    corners: reverse(f.corners),
    uvCorners: reverse(f.uvCorners),
  };
  const afterSet = pairingSet(after);
  // Compare sets
  let same = before.size === afterSet.size;
  if (same) {
    for (const item of before) {
      if (!afterSet.has(item)) {
        same = false;
        break;
      }
    }
  }
  if (!same) allInvariant = false;
  console.log(`${f.name}: ${same ? "INVARIANT (pairing preserved)" : "CHANGED (BUG)"}`);
  if (!same) {
    console.log("  Before:", [...before]);
    console.log("  After:", [...afterSet]);
  }
}
console.log(allInvariant ? "\nALL SIDE FACES: UV pairing preserved after reversal." : "\nBUG: UV pairing changed!");
