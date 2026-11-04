import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const LEVEL_ORDER = window.LEVEL_ORDER;
const LEVELS_DATA = window.LEVELS_DATA;
const VELOCITY = window.VELOCITY_DATA; // { days: ["25","26",...], velocity: { ALL: {label:qty}, "25": {...}, ... } }
const ITEM_INFO = window.ITEM_INFO || {}; // { ALL: {bin: {item, desc, qty, lines, otherItems}}, "25": {...}, ... }
const TREND = window.TREND_DATA || { days: [], itemTrend: {}, binTrend: {} };

// Day keys look like "10-21" (month-day). Pretty labels for buttons, legend and charts.
const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function longDay(k) {
  if (k === "ALL") return "All days";
  const [m, d] = k.split("-").map(Number);
  return `${MONTH_ABBR[m - 1]} ${d}`;
}
function shortDay(k) {
  if (k === "ALL") return "All";
  const [m, d] = k.split("-").map(Number);
  return `${m}/${d}`;
}

// ---- draggable + collapsible panels ----
let topPanelZ = 25;
function makeDraggable(panel) {
  const handle = panel.querySelector(".panel-header");
  if (!handle) return;
  let dragging = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".collapse-btn, .trend-close")) return;
    const rect = panel.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    startX = e.clientX;
    startY = e.clientY;
    panel.style.left = startLeft + "px";
    panel.style.top = startTop + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.transform = "none";
    panel.style.zIndex = ++topPanelZ;
    dragging = true;
    panel.classList.add("dragging");
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    let newLeft = startLeft + (e.clientX - startX);
    let newTop = startTop + (e.clientY - startY);
    newLeft = Math.max(-panel.offsetWidth + 60, Math.min(newLeft, window.innerWidth - 60));
    newTop = Math.max(0, Math.min(newTop, window.innerHeight - 40));
    panel.style.left = newLeft + "px";
    panel.style.top = newTop + "px";
  });
  const endDrag = () => {
    dragging = false;
    panel.classList.remove("dragging");
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
}

function makeCollapsible(panel) {
  const btn = panel.querySelector(".collapse-btn");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const collapsed = panel.classList.toggle("collapsed");
    btn.textContent = collapsed ? "▸" : "▾";
  });
}

["title-panel", "day-panel", "levels-panel", "search-panel", "legend-panel", "top-items-panel", "trend-panel"].forEach((id) => {
  const panel = document.getElementById(id);
  if (!panel) return;
  makeDraggable(panel);
  makeCollapsible(panel);
});

const HEAT_COLORS = {
  none: 0x39434d,
  low: 0x2ecc71,
  belowAvg: 0xa8e6a3,
  avg: 0xf7dc6f,
  aboveAvg: 0xf5923e,
  high: 0xe63946,
};
const LANDMARK_COLOR = 0x8e6bff;
const SELECT_COLOR = 0x00e5ff;

const SPACING = 1.0;
const LEVEL_HEIGHT = 5.5;
const BIN_SIZE = 0.62;
const LANDMARK_SIZE = 0.4;

// ---- compute bounds for centering ----
let maxRow = 0, maxCol = 0;
for (const lvl of LEVEL_ORDER) {
  const d = LEVELS_DATA[lvl];
  for (const [r, c] of d.bins.concat(d.landmarks)) {
    if (r > maxRow) maxRow = r;
    if (c > maxCol) maxCol = c;
  }
}
const offsetX = (maxCol * SPACING) / 2;
const offsetZ = (maxRow * SPACING) / 2;

// real max stack height, from actual per-bin yCenter + half-height (used for camera framing)
let maxStackHeight = 0;
for (const lvl of LEVEL_ORDER) {
  for (const b of LEVELS_DATA[lvl].bins) {
    const top = b[3] + b[4] / 2; // yCenter + heightUnits/2
    if (top > maxStackHeight) maxStackHeight = top;
  }
}
if (maxStackHeight === 0) maxStackHeight = LEVEL_ORDER.length * LEVEL_HEIGHT;

// ---- renderer / scene / camera ----
const canvasHost = document.getElementById("app");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
canvasHost.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
scene.fog = new THREE.FogExp2(0x0b0f14, 0.0022);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 4000);
const diag = Math.sqrt(maxRow * maxRow + maxCol * maxCol) * SPACING;
camera.position.set(diag * 0.55, maxStackHeight * 1.4, diag * 0.75);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, maxStackHeight / 2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 5;
controls.maxDistance = diag * 2.2;
controls.update();

// ---- lighting ----
scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
dirLight.position.set(diag * 0.4, maxStackHeight * 2, diag * 0.2);
scene.add(dirLight);
const dirLight2 = new THREE.DirectionalLight(0x88aaff, 0.25);
dirLight2.position.set(-diag * 0.3, maxStackHeight, -diag * 0.4);
scene.add(dirLight2);

// ---- floor grid ----
const grid = new THREE.GridHelper(Math.max(maxRow, maxCol) * SPACING * 1.2, 40, 0x223040, 0x1a2530);
grid.position.set(0, -0.2, 0);
scene.add(grid);

// ---- build instanced meshes per level ----
// Each bin position now has THREE parts:
//   1. rackFrame  - a wireframe cage sized to the bay's true height/depth (from D365) -
//                   this is the "racking" itself, structural, always neutral-colored.
//   2. rackShelf  - a thin solid plane at the bottom of the bay (the shelf a pallet rests on).
//   3. invBox     - the original small fixed-size cube, sitting on the shelf, heat-colored by
//                   pick velocity. This is the "inventory" placeholder for now.
const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);
const landmarkGeo = new THREE.BoxGeometry(LANDMARK_SIZE, LANDMARK_SIZE * 0.3, LANDMARK_SIZE);
const invMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 });
const landmarkMat = new THREE.MeshStandardMaterial({ color: LANDMARK_COLOR, roughness: 0.6, metalness: 0.05 });
const rackPostMat = new THREE.MeshBasicMaterial({ color: 0x8a97a3, transparent: true, opacity: 0.7 });
const rackShelfMat = new THREE.MeshStandardMaterial({ color: 0x4a5561, roughness: 0.5, metalness: 0.4 });

const SHELF_THICKNESS = 0.05; // scene units
const FRAME_PADDING = 1.1; // frame drawn slightly larger than the shelf footprint
const POST_THICKNESS = 0.035; // scene units - thin corner posts instead of a full wireframe cage
const POST_OFFSETS = [
  [1, 1], [1, -1], [-1, 1], [-1, -1],
]; // corner directions (x, z) as multipliers of half the bay footprint

const dummy = new THREE.Object3D();
const levelGroups = {}; // level -> { invMesh, rackPostMesh, rackShelfMesh, landmarkMesh, binMeta:[], landmarkMeta:[] }
const pickables = []; // { mesh, meta, kind, level }
const binIndex = {}; // label(upper) -> {level, position}

let totalBins = 0, totalLandmarks = 0;

LEVEL_ORDER.forEach((lvl, levelIdx) => {
  const d = LEVELS_DATA[lvl];
  const count = Math.max(d.bins.length, 1);

  const invMesh = new THREE.InstancedMesh(unitBoxGeo, invMat.clone(), count);
  invMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const rackPostMesh = new THREE.InstancedMesh(unitBoxGeo, rackPostMat.clone(), count * 4); // 4 corner posts per bin
  const rackShelfMesh = new THREE.InstancedMesh(unitBoxGeo, rackShelfMat.clone(), count);

  const binMeta = [];
  const binColors = [];
  d.bins.forEach(([r, c, label, yCenter, heightUnits, footprintScale, category, pick, deep, heightIn, noRack], i) => {
    const x = c * SPACING - offsetX;
    const z = r * SPACING - offsetZ;
    const bayXZ = BIN_SIZE * footprintScale;
    const yBottom = yCenter - heightUnits / 2;

    // rack posts: 4 thin vertical corner posts spanning the bay's full height
    // (skipped - scaled to zero - for bulk floor spots that have no real racking: aisles 11/12, odd side of 13)
    const halfXZ = (bayXZ * FRAME_PADDING) / 2;
    POST_OFFSETS.forEach(([dx, dz], k) => {
      dummy.position.set(x + dx * halfXZ, yCenter, z + dz * halfXZ);
      dummy.scale.set(noRack ? 0 : POST_THICKNESS, noRack ? 0 : heightUnits, noRack ? 0 : POST_THICKNESS);
      dummy.updateMatrix();
      rackPostMesh.setMatrixAt(i * 4 + k, dummy.matrix);
    });

    // rack shelf: thin plane at the bottom of the bay (also skipped for bulk floor spots)
    dummy.position.set(x, yBottom + SHELF_THICKNESS / 2, z);
    dummy.scale.set(noRack ? 0 : bayXZ * FRAME_PADDING, noRack ? 0 : SHELF_THICKNESS, noRack ? 0 : bayXZ * FRAME_PADDING);
    dummy.updateMatrix();
    rackShelfMesh.setMatrixAt(i, dummy.matrix);

    // inventory box: fixed small size, sitting on the shelf
    const invY = yBottom + SHELF_THICKNESS + BIN_SIZE / 2;
    dummy.position.set(x, invY, z);
    dummy.scale.set(BIN_SIZE, BIN_SIZE, BIN_SIZE);
    dummy.updateMatrix();
    invMesh.setMatrixAt(i, dummy.matrix);
    const initColor = new THREE.Color(HEAT_COLORS.none);
    invMesh.setColorAt(i, initColor);
    binColors.push(initColor);

    binMeta.push({ label, level: lvl, aisle: label.split(".")[0], x, y: invY, z, category, pick, deep, heightIn, noRack });
    binIndex[label.toUpperCase()] = { level: lvl, x, y: invY, z, index: i, mesh: invMesh };
  });

  [invMesh, rackShelfMesh].forEach((m) => {
    m.count = d.bins.length;
    m.instanceMatrix.needsUpdate = true;
    m.visible = d.bins.length > 0;
    scene.add(m);
  });
  rackPostMesh.count = d.bins.length * 4;
  rackPostMesh.instanceMatrix.needsUpdate = true;
  rackPostMesh.visible = d.bins.length > 0;
  scene.add(rackPostMesh);
  if (invMesh.instanceColor) invMesh.instanceColor.needsUpdate = true;
  totalBins += d.bins.length;

  // Landmarks only ever shown on the A (floor) level, rendered flat on the ground
  const landmarksForThisLevel = lvl === "A" ? d.landmarks : [];
  const landmarkMesh = new THREE.InstancedMesh(landmarkGeo, landmarkMat.clone(), Math.max(landmarksForThisLevel.length, 1));
  const landmarkMeta = [];
  landmarksForThisLevel.forEach(([r, c, label], i) => {
    const x = c * SPACING - offsetX;
    const z = r * SPACING - offsetZ;
    dummy.position.set(x, 0.05, z); // floor level regardless of which level sheet the note came from
    dummy.updateMatrix();
    landmarkMesh.setMatrixAt(i, dummy.matrix);
    landmarkMeta.push({ label, level: "A", x, y: 0.05, z });
  });
  landmarkMesh.count = landmarksForThisLevel.length;
  landmarkMesh.instanceMatrix.needsUpdate = true;
  landmarkMesh.visible = landmarksForThisLevel.length > 0;
  scene.add(landmarkMesh);
  totalLandmarks += landmarksForThisLevel.length;

  levelGroups[lvl] = { invMesh, rackPostMesh, rackShelfMesh, landmarkMesh, binMeta, landmarkMeta, binColors, binBuckets: new Array(d.bins.length).fill("none"), invBase: new Float32Array(invMesh.instanceMatrix.array), postBase: new Float32Array(rackPostMesh.instanceMatrix.array), shelfBase: new Float32Array(rackShelfMesh.instanceMatrix.array), visible: true };
  pickables.push({ mesh: invMesh, meta: binMeta, kind: "bin", level: lvl, metaDivisor: 1 });
  pickables.push({ mesh: rackPostMesh, meta: binMeta, kind: "bin", level: lvl, metaDivisor: 4 });
  pickables.push({ mesh: landmarkMesh, meta: landmarkMeta, kind: "landmark", level: lvl, metaDivisor: 1 });
});

document.getElementById("stats-footer").textContent =
  `${totalBins.toLocaleString()} bin positions · ${totalLandmarks.toLocaleString()} landmarks · ${LEVEL_ORDER.length} levels`;

// ---- level toggle panel ----
const levelListEl = document.getElementById("level-list");
LEVEL_ORDER.forEach((lvl) => {
  const g = levelGroups[lvl];
  const row = document.createElement("div");
  row.className = "level-row";
  row.innerHTML = `
    <label>
      <input type="checkbox" checked data-level="${lvl}" />
      Level ${lvl}
    </label>
    <span class="count">${g.binMeta.length}</span>
  `;
  levelListEl.appendChild(row);
});
let racksVisible = true;

levelListEl.addEventListener("change", (e) => {
  const t = e.target;
  if (t.matches("input[data-level]")) {
    const lvl = t.getAttribute("data-level");
    const g = levelGroups[lvl];
    g.visible = t.checked;
    const hasBins = g.binMeta.length > 0;
    g.invMesh.visible = t.checked && hasBins;
    g.rackPostMesh.visible = t.checked && hasBins && racksVisible;
    g.rackShelfMesh.visible = t.checked && hasBins && racksVisible;
    g.landmarkMesh.visible = t.checked && g.landmarkMeta.length > 0;
  }
});
document.getElementById("show-all").addEventListener("click", () => {
  levelListEl.querySelectorAll("input[data-level]").forEach((cb) => {
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
  });
});
document.getElementById("hide-all").addEventListener("click", () => {
  levelListEl.querySelectorAll("input[data-level]").forEach((cb) => {
    cb.checked = false;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
  });
});
document.getElementById("rack-toggle").addEventListener("change", (e) => {
  racksVisible = e.target.checked;
  LEVEL_ORDER.forEach((lvl) => {
    const g = levelGroups[lvl];
    const hasBins = g.binMeta.length > 0;
    g.rackPostMesh.visible = g.visible && hasBins && racksVisible;
    g.rackShelfMesh.visible = g.visible && hasBins && racksVisible;
  });
});

// ---- aisle toggle panel (shares the Levels box) ----
// An aisle is the number before the first dot in a bin label (e.g. 14.027.B.L02 -> aisle 14).
// A bin shows only when BOTH its level and its aisle are checked.
const hiddenAisles = new Set();
const aisleListEl = document.getElementById("aisle-list");
const aisleCounts = {};
LEVEL_ORDER.forEach((lvl) => levelGroups[lvl].binMeta.forEach((m) => { aisleCounts[m.aisle] = (aisleCounts[m.aisle] || 0) + 1; }));
const aisleKeys = Object.keys(aisleCounts).sort((a, b) => {
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  if (isNaN(na) && isNaN(nb)) return a.localeCompare(b);
  if (isNaN(na)) return 1;
  if (isNaN(nb)) return -1;
  return na - nb || a.localeCompare(b);
});
aisleKeys.forEach((a) => {
  const row = document.createElement("div");
  row.className = "level-row";
  row.innerHTML = `
    <label>
      <input type="checkbox" checked data-aisle="${a}" />
      ${a}
    </label>
    <span class="count">${aisleCounts[a]}</span>
  `;
  aisleListEl.appendChild(row);
});
aisleListEl.style.gridTemplateRows = `repeat(${Math.ceil(aisleKeys.length / 2)}, auto)`;
aisleListEl.addEventListener("change", (e) => {
  const t = e.target;
  if (!t.matches("input[data-aisle]")) return;
  const a = t.getAttribute("data-aisle");
  if (t.checked) hiddenAisles.delete(a); else hiddenAisles.add(a);
  applyBinVisibility();
});
document.getElementById("aisle-show-all").addEventListener("click", () => {
  aisleListEl.querySelectorAll("input[data-aisle]").forEach((cb) => (cb.checked = true));
  hiddenAisles.clear();
  applyBinVisibility();
});
document.getElementById("aisle-hide-all").addEventListener("click", () => {
  aisleListEl.querySelectorAll("input[data-aisle]").forEach((cb) => {
    cb.checked = false;
    hiddenAisles.add(cb.getAttribute("data-aisle"));
  });
  applyBinVisibility();
});
// used by search: make sure a found bin's aisle is switched back on
function enableAisle(a) {
  const cb = aisleListEl.querySelector(`input[data-aisle="${a}"]`);
  if (cb && !cb.checked) cb.checked = true;
  hiddenAisles.delete(a);
}

// ---- velocity view (day toggle + heat coloring) ----
const dayButtonsEl = document.getElementById("day-buttons");
const legendEl = document.getElementById("legend-body");
let currentViewKey = "ALL";
let currentBreakpoints = null;
let unmatchedCount = 0;

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor(p * (sortedArr.length - 1))));
  return sortedArr[idx];
}

function bucketFor(qty, bp) {
  if (qty === undefined || qty === null) return "none";
  if (qty <= bp.p20) return "low";
  if (qty <= bp.p40) return "belowAvg";
  if (qty <= bp.p60) return "avg";
  if (qty <= bp.p80) return "aboveAvg";
  return "high";
}

function fmtQty(n) {
  return Math.round(n * 10) / 10;
}

function hex(n) {
  return n.toString(16).padStart(6, "0");
}

function applyVelocityView(viewKey) {
  currentViewKey = viewKey;
  const map = (VELOCITY && VELOCITY.velocity[viewKey]) || {};
  const upperMap = {};
  Object.keys(map).forEach((k) => (upperMap[k.toUpperCase()] = map[k]));

  const values = Object.values(upperMap).filter((v) => v > 0).sort((a, b) => a - b);
  const bp = {
    p20: percentile(values, 0.2),
    p40: percentile(values, 0.4),
    p60: percentile(values, 0.6),
    p80: percentile(values, 0.8),
  };
  currentBreakpoints = bp;

  unmatchedCount = 0;
  let matchedCount = 0;

  LEVEL_ORDER.forEach((lvl) => {
    const g = levelGroups[lvl];
    g.binMeta.forEach((meta, i) => {
      const qty = upperMap[meta.label.toUpperCase()];
      const bucket = bucketFor(qty, bp);
      const color = new THREE.Color(HEAT_COLORS[bucket]);
      g.binColors[i] = color;
      g.binBuckets[i] = bucket;
      // don't overwrite the currently-selected instance's visible color
      if (!(selected && selected.mesh === g.invMesh && selected.index === i)) {
        g.invMesh.setColorAt(i, color);
      }
      if (bucket !== "none") matchedCount++;
    });
    g.invMesh.instanceColor.needsUpdate = true;
  });

  const totalMapEntries = Object.keys(upperMap).length;
  unmatchedCount = Math.max(0, totalMapEntries - matchedCount);
  applyBinVisibility();
  renderLegend(bp, viewKey, matchedCount, totalMapEntries);
  renderTopItems(viewKey);
}

// ---- velocity color toggles (show/hide inventory boxes by heat bucket) ----
const hiddenBuckets = new Set();
const HIDE_SCALE = 1e-4;
const SCALE_IDX = [0, 1, 2, 4, 5, 6, 8, 9, 10];
function applyBinVisibility() {
  const keep = new Set();
  if (selected) keep.add(selected.level + ":" + selected.index);
  multiSelected.forEach((m) => keep.add(m.level + ":" + m.index));
  const anyAisleHidden = hiddenAisles.size > 0;
  const anyBucketHidden = hiddenBuckets.size > 0;
  LEVEL_ORDER.forEach((lvl) => {
    const g = levelGroups[lvl];
    const invArr = g.invMesh.instanceMatrix.array;
    const postArr = g.rackPostMesh.instanceMatrix.array;
    const shelfArr = g.rackShelfMesh.instanceMatrix.array;
    for (let i = 0; i < g.binMeta.length; i++) {
      const aisleHidden = anyAisleHidden && hiddenAisles.has(g.binMeta[i].aisle);
      const bucketHidden = anyBucketHidden && hiddenBuckets.has(g.binBuckets[i]) && !keep.has(lvl + ":" + i);
      const o = i * 16;
      for (let k = 0; k < 16; k++) {
        invArr[o + k] = g.invBase[o + k];
        shelfArr[o + k] = g.shelfBase[o + k];
      }
      if (aisleHidden || bucketHidden) {
        for (const idx of SCALE_IDX) invArr[o + idx] *= HIDE_SCALE;
      }
      if (aisleHidden) for (const idx of SCALE_IDX) shelfArr[o + idx] *= HIDE_SCALE;
      const po = i * 64; // 4 corner posts per bin
      for (let k = 0; k < 64; k++) postArr[po + k] = g.postBase[po + k];
      if (aisleHidden) {
        for (let p = 0; p < 4; p++) for (const idx of SCALE_IDX) postArr[po + p * 16 + idx] *= HIDE_SCALE;
      }
    }
    g.invMesh.instanceMatrix.needsUpdate = true;
    g.rackPostMesh.instanceMatrix.needsUpdate = true;
    g.rackShelfMesh.instanceMatrix.needsUpdate = true;
  });
}

// ---- top items by quantity (updates with the day toggle) ----
const topItemsListEl = document.getElementById("top-items-list");
function renderTopItems(viewKey) {
  const rows = Object.entries(TREND.itemTrend)
    .map(([item, t]) => {
      const q = viewKey === "ALL" ? t.total.qty : (t.byDay[viewKey] ? t.byDay[viewKey].qty : 0);
      return { item, desc: t.desc, qty: q };
    })
    .filter((r) => r.qty > 0)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 12);

  topItemsListEl.innerHTML = "";
  rows.forEach((r) => {
    const row = document.createElement("div");
    row.className = "top-item-row";
    row.innerHTML = `<span class="ti-name" title="${r.item} — ${r.desc || "No description"}">${r.item}</span><span class="ti-qty">${fmtQty(r.qty)}</span>`;
    row.addEventListener("click", () => {
      selectItemBins(r.item);
      showTrendForItem(r.item);
    });
    topItemsListEl.appendChild(row);
  });
  if (rows.length === 0) {
    topItemsListEl.innerHTML = `<div style="color:var(--text-dim); font-size:12px;">No picks in this view</div>`;
  }
}

function renderLegend(bp, viewKey, matchedCount, totalMapEntries) {
  const viewLabel = viewKey === "ALL" ? `all ${VELOCITY.days.length} days combined` : longDay(viewKey);
  const chip = (bucket, label) =>
    `<button type="button" class="legend-chip${hiddenBuckets.has(bucket) ? " off" : ""}" data-bucket="${bucket}"><span class="swatch" style="background:#${hex(HEAT_COLORS[bucket])}"></span>${label}</button>`;
  legendEl.innerHTML = `
    ${chip("none", `No picks (${viewLabel})`)}
    ${chip("low", `Low (≤${fmtQty(bp.p20)})`)}
    ${chip("belowAvg", "Below avg")}
    ${chip("avg", "Average")}
    ${chip("aboveAvg", "Above avg")}
    ${chip("high", `High (>${fmtQty(bp.p80)})`)}
    <button type="button" class="legend-reset" data-reset="1">Show all</button>
    <div class="legend-item"><span class="swatch" style="background:#${hex(LANDMARK_COLOR)}"></span>Landmark</div>
    <div class="legend-item"><span class="swatch" style="background:#${hex(SELECT_COLOR)}"></span>Selected</div>
    <div class="legend-item" style="color:var(--text-dim)">${matchedCount.toLocaleString()} / ${totalMapEntries.toLocaleString()} picked bins matched to map</div>
  `;
}

legendEl.addEventListener("click", (e) => {
  const chipEl = e.target.closest("[data-bucket]");
  const resetEl = e.target.closest("[data-reset]");
  if (chipEl) {
    const b = chipEl.dataset.bucket;
    if (hiddenBuckets.has(b)) hiddenBuckets.delete(b);
    else hiddenBuckets.add(b);
    chipEl.classList.toggle("off", hiddenBuckets.has(b));
    applyBinVisibility();
  } else if (resetEl) {
    hiddenBuckets.clear();
    legendEl.querySelectorAll(".legend-chip").forEach((c) => c.classList.remove("off"));
    applyBinVisibility();
  }
});

// day buttons
const dayLabels = { ALL: "All days" };
(VELOCITY ? VELOCITY.days : []).forEach((d) => (dayLabels[d] = longDay(d)));
const dayKeys = ["ALL"].concat(VELOCITY ? VELOCITY.days : []);
dayKeys.forEach((key) => {
  const btn = document.createElement("button");
  btn.className = "btn" + (key === "ALL" ? " active" : "");
  btn.textContent = dayLabels[key];
  btn.dataset.key = key;
  btn.addEventListener("click", () => {
    dayButtonsEl.querySelectorAll(".btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    applyVelocityView(key);
  });
  dayButtonsEl.appendChild(btn);
});

// ---- raycasting / tooltip ----
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tooltip = document.getElementById("tooltip");
let hovered = null;

function onPointerMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const visibleMeshes = pickables.filter((p) => p.mesh.visible).map((p) => p.mesh);
  const hits = raycaster.intersectObjects(visibleMeshes, false);

  let pickedHit = null, pickedEntry = null, pickedIndex = 0;
  for (const h of hits) {
    const en = pickables.find((p) => p.mesh === h.object);
    const mi = Math.floor(h.instanceId / (en.metaDivisor || 1));
    if (en.kind === "bin") {
      if (hiddenAisles.has(en.meta[mi].aisle)) continue;
      if (hiddenBuckets.size > 0 && hiddenBuckets.has(levelGroups[en.level].binBuckets[mi])) continue;
    }
    pickedHit = h; pickedEntry = en; pickedIndex = mi;
    break;
  }

  if (pickedHit) {
    const hit = pickedHit;
    const entry = pickedEntry;
    const metaIndex = pickedIndex;
    const meta = entry.meta[metaIndex];
    hovered = { entry, instanceId: hit.instanceId, meta };
    tooltip.style.display = "block";
    tooltip.style.left = event.clientX + 14 + "px";
    tooltip.style.top = event.clientY + 14 + "px";
    let extraLines = "";
    if (entry.kind === "bin") {
      const map = VELOCITY.velocity[currentViewKey] || {};
      const qty = map[meta.label.toUpperCase()] ?? null;
      const info = (ITEM_INFO[currentViewKey] || {})[meta.label.toUpperCase()];
      if (qty != null && info) {
        const descText = info.desc ? info.desc : "No description on file";
        const otherText = info.otherItems > 0 ? ` (+${info.otherItems} other item${info.otherItems > 1 ? "s" : ""})` : "";
        extraLines = `
          <div class="t-sub">Item: ${info.item}${otherText}</div>
          <div class="t-sub">${descText}</div>
          <div class="t-sub">Picked qty: ${fmtQty(qty)} · Times picked: ${info.lines}</div>`;
      } else {
        extraLines = `<div class="t-sub">No picks in this view</div>`;
      }
    }
    const rackLine = entry.kind === "bin"
      ? `<div class="t-sub">${meta.category} · ${meta.deep}-deep · ${Math.round(meta.heightIn)}" tall · ${meta.pick ? "Pick" : "Backup"}${meta.noRack ? " · Bulk floor (no rack)" : ""}</div>`
      : "";
    tooltip.innerHTML = `<div class="t-label">${meta.label}</div><div class="t-sub">Level ${meta.level} · ${entry.kind}</div>${rackLine}${extraLines}`;
    renderer.domElement.style.cursor = "pointer";
  } else {
    hovered = null;
    tooltip.style.display = "none";
    renderer.domElement.style.cursor = "grab";
  }
}
renderer.domElement.addEventListener("pointermove", onPointerMove);
renderer.domElement.addEventListener("pointerleave", () => {
  tooltip.style.display = "none";
});

// ---- selection highlight ----
let selected = null;
let multiSelected = []; // [{mesh, index, level}] - used for item-number search (highlights every bin holding that item)

function clearMultiSelection() {
  multiSelected.forEach(({ mesh, index, level }) => {
    const g = levelGroups[level];
    const origColor = g.binColors[index] || new THREE.Color(HEAT_COLORS.none);
    mesh.setColorAt(index, origColor);
    mesh.instanceColor.needsUpdate = true;
  });
  multiSelected = [];
  if (hiddenBuckets.size > 0) applyBinVisibility();
}

function clearSelection() {
  if (selected) {
    const g = levelGroups[selected.level];
    const origColor = g.binColors[selected.index] || new THREE.Color(HEAT_COLORS.none);
    selected.mesh.setColorAt(selected.index, origColor);
    selected.mesh.instanceColor.needsUpdate = true;
    selected = null;
    if (hiddenBuckets.size > 0) applyBinVisibility();
  }
}
function selectBinByLabel(label) {
  const found = binIndex[label.toUpperCase()];
  if (!found) return false;
  clearSelection();
  clearMultiSelection();
  found.mesh.setColorAt(found.index, new THREE.Color(SELECT_COLOR));
  found.mesh.instanceColor.needsUpdate = true;
  selected = { mesh: found.mesh, index: found.index, level: found.level };

  // ensure its level is visible
  const cb = levelListEl.querySelector(`input[data-level="${found.level}"]`);
  if (cb && !cb.checked) {
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
  }
  enableAisle(label.split(".")[0]);

  applyBinVisibility();
  flyTo(found.x, found.y, found.z);
  return true;
}

function flyTo(x, y, z) {
  const startTarget = controls.target.clone();
  const startPos = camera.position.clone();
  const endTarget = new THREE.Vector3(x, y, z);
  const dirVec = startPos.clone().sub(startTarget).normalize();
  const endPos = endTarget.clone().add(dirVec.multiplyScalar(12));
  const duration = 700;
  const t0 = performance.now();
  function step(now) {
    const t = Math.min(1, (now - t0) / duration);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    controls.target.lerpVectors(startTarget, endTarget, ease);
    camera.position.lerpVectors(startPos, endPos, ease);
    controls.update();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

renderer.domElement.addEventListener("click", () => {
  if (hovered && hovered.entry.kind === "bin") {
    selectBinByLabel(hovered.meta.label);
  }
});

// ---- search: bin location ----
const searchInput = document.getElementById("bin-search");
const searchResults = document.getElementById("search-results");
const allBinLabels = Object.keys(binIndex);

searchInput.addEventListener("input", () => {
  // mutually exclusive with item search
  itemSearchInput.value = "";
  itemSearchResults.innerHTML = "";
  clearMultiSelection();

  const q = searchInput.value.trim().toUpperCase();
  searchResults.innerHTML = "";
  if (!q) return;
  const matches = allBinLabels.filter((l) => l.includes(q)).slice(0, 25);
  matches.forEach((label) => {
    const row = document.createElement("div");
    row.className = "result-row";
    row.innerHTML = `<span>${label}</span><span class="lvl-badge">${binIndex[label].level}</span>`;
    row.addEventListener("click", () => {
      selectBinByLabel(label);
      showTrendForBin(label);
    });
    searchResults.appendChild(row);
  });
});

// ---- search: item number ----
// Built from the "ALL" view's dominant-item-per-bin data, so an item that shares a bulk
// bin with other items but isn't the top item there may not surface here.
const itemSearchInput = document.getElementById("item-search");
const itemSearchResults = document.getElementById("item-search-results");
const itemDirectory = {}; // itemNumber -> { desc, bins: [label,...] }
Object.entries(ITEM_INFO.ALL || {}).forEach(([binLabel, info]) => {
  if (!info || !info.item) return;
  if (!itemDirectory[info.item]) itemDirectory[info.item] = { desc: info.desc, bins: [] };
  itemDirectory[info.item].bins.push(binLabel);
});
const itemDirectoryKeys = Object.keys(itemDirectory);

function selectItemBins(itemNumber) {
  const entry = itemDirectory[itemNumber];
  if (!entry) return;
  clearSelection();
  clearMultiSelection();
  const levelsNeeded = new Set();
  const aislesNeeded = new Set();
  const positions = [];
  entry.bins.forEach((label) => {
    const found = binIndex[label.toUpperCase()];
    if (!found) return;
    found.mesh.setColorAt(found.index, new THREE.Color(SELECT_COLOR));
    found.mesh.instanceColor.needsUpdate = true;
    multiSelected.push({ mesh: found.mesh, index: found.index, level: found.level });
    levelsNeeded.add(found.level);
    aislesNeeded.add(label.split(".")[0]);
    positions.push(found);
  });
  levelsNeeded.forEach((lvl) => {
    const cb = levelListEl.querySelector(`input[data-level="${lvl}"]`);
    if (cb && !cb.checked) {
      cb.checked = true;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  aislesNeeded.forEach(enableAisle);
  applyBinVisibility();
  if (positions.length > 0) {
    const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
    const cy = positions.reduce((s, p) => s + p.y, 0) / positions.length;
    const cz = positions.reduce((s, p) => s + p.z, 0) / positions.length;
    flyTo(cx, cy, cz);
  }
}

itemSearchInput.addEventListener("input", () => {
  // mutually exclusive with bin search
  searchInput.value = "";
  searchResults.innerHTML = "";
  clearSelection();

  const q = itemSearchInput.value.trim().toUpperCase();
  itemSearchResults.innerHTML = "";
  if (!q) {
    clearMultiSelection();
    return;
  }
  const matches = itemDirectoryKeys
    .filter((item) => item.toUpperCase().includes(q) || (itemDirectory[item].desc || "").toUpperCase().includes(q))
    .slice(0, 25);
  matches.forEach((item) => {
    const entry = itemDirectory[item];
    const row = document.createElement("div");
    row.className = "result-row";
    row.innerHTML = `<span>${item} — ${entry.desc || "No description"}</span><span class="lvl-badge">${entry.bins.length} bin${entry.bins.length > 1 ? "s" : ""}</span>`;
    row.addEventListener("click", () => {
      selectItemBins(item);
      showTrendForItem(item);
    });
    itemSearchResults.appendChild(row);
  });
});

// ---- trend popup (sparkline of qty & times-picked per day) ----
const trendPanel = document.getElementById("trend-panel");
const trendContent = document.getElementById("trend-content");
document.getElementById("trend-close").addEventListener("click", () => {
  trendPanel.style.display = "none";
});

function buildSparkline(values, color, days, fmt) {
  const W = Math.max(280, values.length * 38), H = 92, PADL = 18, PADR = 18, TOP = 22, BOTTOM = 24;
  const plotH = H - TOP - BOTTOM;
  const max = Math.max(1, ...values);
  const stepX = (W - PADL - PADR) / Math.max(1, values.length - 1);
  const points = values.map((v, i) => {
    const px = PADL + i * stepX;
    const py = TOP + plotH - (v / max) * plotH;
    return [px, py];
  });
  const linePath = points.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const dots = points
    .map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="${color}" />`)
    .join("");
  const valueLabels = points
    .map((p, i) => `<text x="${p[0].toFixed(1)}" y="${(p[1] - 8).toFixed(1)}" text-anchor="middle" font-size="${values.length > 8 ? 10 : 11}" font-weight="600" fill="#e6edf3">${fmt(values[i])}</text>`)
    .join("");
  const dayLabels = points
    .map((p, i) => `<text x="${p[0].toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="${values.length > 8 ? 9 : 10}" fill="#8b98a5">${dayLabel(days[i])}</text>`)
    .join("");
  const baselineY = TOP + plotH;
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-family:inherit">
    <line x1="${PADL}" y1="${baselineY}" x2="${W - PADR}" y2="${baselineY}" stroke="#26313d" stroke-width="1" />
    <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2" />
    ${dots}
    ${valueLabels}
    ${dayLabels}
  </svg>`;
}

function dayLabel(d) {
  return shortDay(d);
}

function renderTrendPanel(title, sub, qtyValues, linesValues) {
  const qtySpark = buildSparkline(qtyValues, "#3fa9f5", TREND.days, (v) => fmtQty(v));
  const linesSpark = buildSparkline(linesValues, "#f5923e", TREND.days, (v) => Math.round(v));
  document.getElementById("trend-title").textContent = title;
  trendContent.innerHTML = `
    <div class="trend-sub">${sub}</div>
    <div class="trend-row">
      <div class="trend-row-label"><span>Quantity picked / day</span></div>
      <div class="trend-svg-wrap">${qtySpark}</div>
    </div>
    <div class="trend-row">
      <div class="trend-row-label"><span>Times picked (work lines) / day</span></div>
      <div class="trend-svg-wrap">${linesSpark}</div>
    </div>
  `;
  trendPanel.style.display = "block";
}

function showTrendForItem(itemNumber) {
  const t = TREND.itemTrend[itemNumber];
  if (!t) return;
  const qtyValues = TREND.days.map((d) => (t.byDay[d] ? t.byDay[d].qty : 0));
  const linesValues = TREND.days.map((d) => (t.byDay[d] ? t.byDay[d].lines : 0));
  renderTrendPanel(
    `Item ${itemNumber}`,
    `${t.desc || "No description"} · Total: ${fmtQty(t.total.qty)} qty across ${t.total.lines} picks`,
    qtyValues,
    linesValues
  );
}

function showTrendForBin(label) {
  const t = TREND.binTrend[label.toUpperCase()];
  if (!t) return;
  const qtyValues = TREND.days.map((d) => (t.byDay[d] ? t.byDay[d].qty : 0));
  const linesValues = TREND.days.map((d) => (t.byDay[d] ? t.byDay[d].lines : 0));
  renderTrendPanel(
    `Bin ${label.toUpperCase()}`,
    `Total: ${fmtQty(t.total.qty)} qty across ${t.total.lines} visits`,
    qtyValues,
    linesValues
  );
}

// ---- resize ----
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- render loop ----
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
applyVelocityView("ALL");
document.getElementById("loading").style.display = "none";
animate();

// ---- export list (CSV of whatever is currently shown) ----
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function buildExportCsv() {
  const P = window.PICK_ROWS;
  const ci = {};
  P.cols.forEach((c, i) => (ci[c] = i));
  const byLoc = {};
  P.rows.forEach((r) => { (byLoc[r[ci.WMSLOCATIONID]] = byLoc[r[ci.WMSLOCATIONID]] || []).push(r); });
  const rawCols = P.cols.filter((c) => c !== "dkey");
  const header = ["Level", "Aisle", "Bin type", "Rack depth", ...rawCols];
  const lines = [header.map(csvCell).join(",")];
  let binCount = 0, zeroBins = 0, rowCount = 0;
  LEVEL_ORDER.forEach((lvl) => {
    const g = levelGroups[lvl];
    if (!g || !g.visible) return;
    g.binMeta.forEach((meta, i) => {
      if (hiddenAisles.has(meta.aisle)) return;
      if (hiddenBuckets.has(g.binBuckets[i])) return;
      binCount++;
      const label = meta.label.toUpperCase();
      let picks = byLoc[label] || [];
      if (currentViewKey !== "ALL") picks = picks.filter((r) => r[ci.dkey] === currentViewKey);
      const pre = [lvl, meta.aisle, meta.category, meta.deep];
      if (picks.length === 0) {
        zeroBins++;
        const row = rawCols.map((c) => (c === "WMSLOCATIONID" ? label : c === "Sum of QTYWORK" ? 0 : ""));
        lines.push([...pre, ...row].map(csvCell).join(","));
        rowCount++;
      } else {
        picks.forEach((r) => { lines.push([...pre, ...rawCols.map((c) => r[ci[c]])].map(csvCell).join(",")); rowCount++; });
      }
    });
  });
  return { csv: "\ufeff" + lines.join("\r\n"), binCount, zeroBins, rowCount };
}
const exportBtn = document.getElementById("export-btn");
const exportStatus = document.getElementById("export-status");
exportBtn.addEventListener("click", async () => {
  const { csv, binCount, zeroBins, rowCount } = buildExportCsv();
  const view = currentViewKey === "ALL" ? "all-days" : currentViewKey;
  const filename = `bin_export_${view}_${binCount}bins.csv`;
  exportStatus.textContent = `${binCount} bins, ${zeroBins} with no picks, ${rowCount} rows`;
  let saved = false;
  try {
    const dl = window.claude && window.claude.use ? await window.claude.use("downloads") : null;
    if (dl) { await dl.save({ filename, data: csv }); saved = true; }
  } catch (e) { if (e && e.code === "declined") return; }
  if (!saved) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }
});
window.__buildExportCsv = buildExportCsv;
