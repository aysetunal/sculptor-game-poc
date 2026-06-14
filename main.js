import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';

// ─── Scene ───────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
scene.fog = new THREE.Fog(0x1a1a2e, 40, 120);

// ─── Orthographic camera ─────────────────────────────────────────────────────
const ORTHO_SIZE = 12;
let aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(
  -ORTHO_SIZE * aspect, ORTHO_SIZE * aspect, ORTHO_SIZE, -ORTHO_SIZE, 0.1, 1000
);
camera.position.set(28, 22, 28);
camera.lookAt(0, 0, 0);

// ─── Renderer ────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ─── Orbit controls ──────────────────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 10;
controls.maxDistance = 80;
controls.minZoom = 0.3;
controls.maxZoom = 5;
controls.target.set(0, 0, 0);

// ─── Lighting ────────────────────────────────────────────────────────────────
const ambient = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambient);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(20, 40, 20);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 200;
dirLight.shadow.camera.left = -30;
dirLight.shadow.camera.right = 30;
dirLight.shadow.camera.top = 30;
dirLight.shadow.camera.bottom = -30;
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
fillLight.position.set(-10, 5, -10);
scene.add(fillLight);

// ─── Solid block ─────────────────────────────────────────────────────────────
// 16.75 = overall span of the old 16³ voxel grid (16 × 1.05 - 0.05 gap rounding)
const BLOCK_SIZE = 16.75;
const halfBlock = BLOCK_SIZE / 2; // 8.375
const FADE_MS   = 300;            // freed-piece fade duration; set to 0 for instant removal

const blockMaterial = new THREE.MeshStandardMaterial({
  color: 0x4fc3f7, roughness: 0.55, metalness: 0.15,
});

// Brush = Mesh subclass from three-bvh-csg; prepareGeometry() builds the BVH
// on first evaluate() call so no extra setup needed.
function makeBlockBrush() {
  const b = new Brush(new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE), blockMaterial);
  b.castShadow = true;
  b.receiveShadow = true;
  b.updateMatrixWorld(true);
  return b;
}

let blockBrush = makeBlockBrush();
scene.add(blockBrush);

// ─── CSG evaluator ───────────────────────────────────────────────────────────
const evaluator = new Evaluator();
evaluator.useGroups = false; // single-material output

// Invisible material for the cutter shape — only its geometry matters for CSG
const cutterMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

// ─── Raycasting planes ───────────────────────────────────────────────────────
// Planes sit at the outer faces of the block, normals pointing outward.
// Ortho camera rays are parallel → intersection is exact, no edge distortion.
const raycaster = new THREE.Raycaster();
const planeFront = new THREE.Plane(new THREE.Vector3(0, 0, 1), -halfBlock); // z = +halfBlock
const planeSide  = new THREE.Plane(new THREE.Vector3(1, 0, 0), -halfBlock); // x = +halfBlock

function screenToFacePlane(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -(((clientY - rect.top) / rect.height) * 2 - 1),
  ), camera);
  const plane = currentView === 'front' ? planeFront : planeSide;
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
}

// ─── View & cut state ────────────────────────────────────────────────────────
let currentView = 'free';   // 'free' | 'front' | 'side'
let atPresetView = false;   // for status display only
let cutModeEnabled = false;

function isCuttingActive() { return cutModeEnabled && currentView !== 'free'; }

const VIEWS = {
  front: new THREE.Vector3(0, 0, 30),
  side:  new THREE.Vector3(30, 0, 0),
};

// ─── Camera tween ────────────────────────────────────────────────────────────
const tween = { active: false, t: 0, duration: 400, from: new THREE.Vector3(), to: new THREE.Vector3() };
function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

// ─── Swipe trail (2D canvas overlay) ─────────────────────────────────────────
const trailCanvas = document.createElement('canvas');
trailCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
document.body.appendChild(trailCanvas);
const trailCtx = trailCanvas.getContext('2d');

function resizeTrailCanvas() {
  trailCanvas.width = window.innerWidth;
  trailCanvas.height = window.innerHeight;
}
resizeTrailCanvas();

const TRAIL_FADE_MS = 420;
let trailPoints = [];

function addTrailPoint(x, y) { trailPoints.push({ x, y, t: performance.now() }); }

function renderTrail() {
  trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
  if (!trailPoints.length) return;
  const now = performance.now();
  trailPoints = trailPoints.filter(p => now - p.t < TRAIL_FADE_MS);
  for (const p of trailPoints) {
    const age = (now - p.t) / TRAIL_FADE_MS;
    const alpha = Math.pow(1 - age, 1.8);
    const r = 22 * (1 - age * 0.35);
    const grad = trailCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    grad.addColorStop(0,   `rgba(79,195,247,${(alpha * 0.7).toFixed(3)})`);
    grad.addColorStop(0.4, `rgba(79,195,247,${(alpha * 0.3).toFixed(3)})`);
    grad.addColorStop(1,   'rgba(79,195,247,0)');
    trailCtx.beginPath();
    trailCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
    trailCtx.fillStyle = grad;
    trailCtx.fill();
  }
}

// ─── Freed-piece connectivity & fading ───────────────────────────────────────
// After each CSG cut we walk the result geometry, flood-fill triangle adjacency
// to find disconnected components, classify by ground-touch, and fade out any
// piece that is no longer connected to the base face (y = -halfBlock).

const fadingPieces = []; // { mesh, t0 }

// Returns { comp[], numComps, triCount, getIdx } for a BufferGeometry.
// Vertices are merged by position quantised to 1e-3 so shared cut boundaries
// are treated as connected.
function findComponents(geo) {
  const idx = geo.index;
  const pos = geo.attributes.position;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  function getIdx(t, c) { return idx ? idx.getX(t * 3 + c) : t * 3 + c; }

  const QUANT = 1e-3;
  const keyMap = new Map();
  const canon  = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i)/QUANT)},${Math.round(pos.getY(i)/QUANT)},${Math.round(pos.getZ(i)/QUANT)}`;
    if (!keyMap.has(k)) keyMap.set(k, i);
    canon[i] = keyMap.get(k);
  }

  const v2t = new Map();
  for (let t = 0; t < triCount; t++) {
    for (let c = 0; c < 3; c++) {
      const v = canon[getIdx(t, c)];
      if (!v2t.has(v)) v2t.set(v, []);
      v2t.get(v).push(t);
    }
  }

  const comp = new Int32Array(triCount).fill(-1);
  let numComps = 0;
  for (let seed = 0; seed < triCount; seed++) {
    if (comp[seed] !== -1) continue;
    const id = numComps++;
    const stack = [seed];
    comp[seed] = id;
    while (stack.length) {
      const t = stack.pop();
      for (let c = 0; c < 3; c++) {
        for (const nb of v2t.get(canon[getIdx(t, c)])) {
          if (comp[nb] === -1) { comp[nb] = id; stack.push(nb); }
        }
      }
    }
  }
  return { comp, numComps, triCount, getIdx };
}

// True if any vertex of component `id` has y ≤ -halfBlock + epsilon.
function touchesBase(geo, comp, triCount, getIdx, id, eps = 0.15) {
  const pos = geo.attributes.position;
  for (let t = 0; t < triCount; t++) {
    if (comp[t] !== id) continue;
    for (let c = 0; c < 3; c++) {
      if (pos.getY(getIdx(t, c)) <= -halfBlock + eps) return true;
    }
  }
  return false;
}

// Extract triangles for all component IDs in `ids` into a new BufferGeometry.
// Copies every attribute generically (position, normal, uv, …).
function extractComponents(geo, comp, triCount, getIdx, ids) {
  const tris = [];
  for (let t = 0; t < triCount; t++) {
    if (ids.has(comp[t])) tris.push(t);
  }
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const sz  = attr.itemSize;
    const arr = new Float32Array(tris.length * 3 * sz);
    tris.forEach((t, i) => {
      for (let c = 0; c < 3; c++) {
        const src = getIdx(t, c) * sz;
        const dst = (i * 3 + c) * sz;
        for (let k = 0; k < sz; k++) arr[dst + k] = attr.array[src + k];
      }
    });
    g.setAttribute(name, new THREE.BufferAttribute(arr, sz));
  }
  return g;
}

// Advance all fading pieces; dispose and remove once opacity hits 0.
function updateFadingPieces(now) {
  let i = fadingPieces.length;
  while (i--) {
    const fp = fadingPieces[i];
    const elapsed = now - fp.t0;
    if (FADE_MS === 0 || elapsed >= FADE_MS) {
      scene.remove(fp.mesh);
      fp.mesh.geometry.dispose();
      fp.mesh.material.dispose();
      fadingPieces.splice(i, 1);
    } else {
      fp.mesh.material.opacity = 1 - elapsed / FADE_MS;
    }
  }
}

// ─── Swept-path stroke shape builder ─────────────────────────────────────────
// Builds a CCW THREE.Shape representing an offset polyline (thick stroke) in 2D.
// pts: [{a,b}] face-plane coordinates;  R: stroke half-width
function buildStrokeShape2D(pts, R) {
  const ARC_SEGS = 8;

  if (pts.length === 1) {
    const sh = new THREE.Shape();
    sh.absarc(pts[0].a, pts[0].b, R, 0, Math.PI * 2, false);
    return sh;
  }

  // Per-segment tangent (ux,uy) and left normal (nx,ny)
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].a - pts[i].a, dy = pts[i + 1].b - pts[i].b;
    const len = Math.sqrt(dx * dx + dy * dy) || 1e-9;
    segs.push({ ux: dx / len, uy: dy / len, nx: -dy / len, ny: dx / len });
  }

  // Miter offset for an interior vertex; s = +1 left, -1 right; length clamped to 2.5R
  function miterOffset(pt, n0, n1, s) {
    const mx = s * (n0.nx + n1.nx), my = s * (n0.ny + n1.ny);
    const mlen = Math.sqrt(mx * mx + my * my) || 1e-9;
    const scale = Math.min(R / mlen, R * 2.5);
    return { a: pt.a + mx / mlen * scale, b: pt.b + my / mlen * scale };
  }

  // Right (s=-1) and left (s=+1) offset polylines
  const right = [], left = [];
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    if (i === 0) {
      right.push({ a: pt.a - segs[0].nx * R, b: pt.b - segs[0].ny * R });
      left.push({  a: pt.a + segs[0].nx * R, b: pt.b + segs[0].ny * R });
    } else if (i === pts.length - 1) {
      const s = segs[segs.length - 1];
      right.push({ a: pt.a - s.nx * R, b: pt.b - s.ny * R });
      left.push({  a: pt.a + s.nx * R, b: pt.b + s.ny * R });
    } else {
      right.push(miterOffset(pt, segs[i - 1], segs[i], -1));
      left.push( miterOffset(pt, segs[i - 1], segs[i], +1));
    }
  }

  // Arc helper: ARC_SEGS+1 points along an arc of radius R
  function arcPts(cx, cy, a0, a1, ccw) {
    let diff = a1 - a0;
    if (ccw) { while (diff < 0) diff += Math.PI * 2; }
    else      { while (diff > 0) diff -= Math.PI * 2; }
    const res = [];
    for (let i = 0; i <= ARC_SEGS; i++) {
      const a = a0 + diff * (i / ARC_SEGS);
      res.push({ a: cx + Math.cos(a) * R, b: cy + Math.sin(a) * R });
    }
    return res;
  }

  // Assemble CCW outline: right forward → end cap → left backward → start cap
  const verts = [];
  right.forEach(p => verts.push(p));
  {
    const s = segs[segs.length - 1];
    const fw = Math.atan2(s.uy, s.ux);
    // End cap: sweep CCW from right side (fw-π/2) through forward to left side (fw+π/2)
    arcPts(pts[pts.length - 1].a, pts[pts.length - 1].b, fw - Math.PI / 2, fw + Math.PI / 2, true)
      .forEach(p => verts.push(p));
  }
  for (let i = left.length - 1; i >= 0; i--) verts.push(left[i]);
  {
    const s = segs[0];
    const fw = Math.atan2(s.uy, s.ux);
    // Start cap: sweep CCW from left side (fw+π/2) through backward to right side (fw-π/2)
    arcPts(pts[0].a, pts[0].b, fw + Math.PI / 2, fw - Math.PI / 2, true)
      .forEach(p => verts.push(p));
  }

  const shape = new THREE.Shape();
  shape.moveTo(verts[0].a, verts[0].b);
  for (let i = 1; i < verts.length; i++) shape.lineTo(verts[i].a, verts[i].b);
  shape.closePath();
  return shape;
}

// ─── CSG cut (applied on pointerup — one BVH rebuild per stroke) ─────────────
const CUT_RADIUS = 1.1;
let swipeHits = [];

function applyCSGCut() {
  if (!swipeHits.length) return;

  // Map world-space hits to face-plane 2D coords and deduplicate
  const raw = currentView === 'front'
    ? swipeHits.map(p => ({ a: p.x, b: p.y }))
    : swipeHits.map(p => ({ a: p.z, b: p.y }));

  const pts = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const prev = pts[pts.length - 1];
    const dx = raw[i].a - prev.a, dy = raw[i].b - prev.b;
    if (Math.sqrt(dx * dx + dy * dy) > 0.05) pts.push(raw[i]);
  }

  const shape = buildStrokeShape2D(pts, CUT_RADIUS);
  const depth = BLOCK_SIZE + 2; // slightly larger than block to guarantee full punch-through
  let geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });

  if (currentView === 'front') {
    // Shape in XY; ExtrudeGeometry extrudes along +localZ; center it along world Z
    geo.translate(0, 0, -depth / 2);
  } else {
    // Shape in ZY (a=worldZ, b=worldY); need extrusion along world X.
    // R_y(-π/2) maps localX→worldZ, localY→worldY, localZ→world-X.
    // After rotation the extrusion spans worldX from 0 to -depth; shift by +depth/2 to center.
    geo.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
    geo.translate(depth / 2, 0, 0);
  }

  const cutterBrush = new Brush(geo, cutterMaterial);
  cutterBrush.updateMatrixWorld(true);
  blockBrush.updateMatrixWorld(true);

  try {
    const result = evaluator.evaluate(blockBrush, cutterBrush, SUBTRACTION);
    scene.remove(blockBrush);
    blockBrush.geometry.dispose();

    const { comp, numComps, triCount, getIdx } = findComponents(result.geometry);

    if (numComps <= 1) {
      // No separation — use the result as-is
      result.material = blockMaterial;
      result.castShadow = true;
      result.receiveShadow = true;
      blockBrush = result;
      scene.add(blockBrush);
    } else {
      const grounded = new Set(), freed = new Set();
      for (let c = 0; c < numComps; c++) {
        (touchesBase(result.geometry, comp, triCount, getIdx, c) ? grounded : freed).add(c);
      }

      if (grounded.size === 0) {
        // Degenerate: nothing touches the base; keep everything to avoid empty block
        result.material = blockMaterial;
        result.castShadow = true;
        result.receiveShadow = true;
        blockBrush = result;
        scene.add(blockBrush);
      } else {
        // Extract freed piece geometries before disposing result
        for (const c of freed) {
          const g   = extractComponents(result.geometry, comp, triCount, getIdx, new Set([c]));
          const mat = blockMaterial.clone();
          mat.transparent = true;
          mat.opacity = 1;
          const mesh = new THREE.Mesh(g, mat);
          scene.add(mesh);
          fadingPieces.push({ mesh, t0: performance.now() });
        }

        // Build new blockBrush from all grounded components
        const groundedGeo = extractComponents(result.geometry, comp, triCount, getIdx, grounded);
        result.geometry.dispose();

        blockBrush = new Brush(groundedGeo, blockMaterial);
        blockBrush.castShadow = true;
        blockBrush.receiveShadow = true;
        scene.add(blockBrush);
      }
    }
  } catch (err) {
    console.warn('CSG subtraction failed:', err);
  }

  geo.dispose();
  swipeHits = [];
}

// ─── Actions ─────────────────────────────────────────────────────────────────
function resetBlock() {
  for (const fp of fadingPieces) {
    scene.remove(fp.mesh);
    fp.mesh.geometry.dispose();
    fp.mesh.material.dispose();
  }
  fadingPieces.length = 0;
  scene.remove(blockBrush);
  blockBrush.geometry.dispose();
  blockBrush = makeBlockBrush();
  scene.add(blockBrush);
}

function setView(view) {
  currentView = view;
  atPresetView = false;
  controls.target.set(0, 0, 0);
  tween.from.copy(camera.position);
  tween.to.copy(VIEWS[view]);
  tween.t = 0;
  tween.active = true;
  updateStatus();
}

function toggleCutMode() {
  cutModeEnabled = !cutModeEnabled;
  controls.enabled = !cutModeEnabled; // lock camera while carving
  if (!cutModeEnabled) trailPoints = [];
  updateCutButton();
  updateStatus();
}

// ─── Pointer events ──────────────────────────────────────────────────────────
let cutting = false;

// Capture phase: consume the event before OrbitControls can orbit
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!cutModeEnabled) return;
  e.stopPropagation();
  if (currentView === 'free') return;
  cutting = true;
  swipeHits = [];
  addTrailPoint(e.clientX, e.clientY);
  const hit = screenToFacePlane(e.clientX, e.clientY);
  if (hit) swipeHits.push(hit);
}, { capture: true });

window.addEventListener('pointermove', (e) => {
  if (!cutting) return;
  addTrailPoint(e.clientX, e.clientY);
  const hit = screenToFacePlane(e.clientX, e.clientY);
  if (hit) swipeHits.push(hit);
});

window.addEventListener('pointerup', () => {
  if (!cutting) return;
  cutting = false;
  applyCSGCut(); // one CSG op per stroke
});

controls.addEventListener('start', () => {
  atPresetView = false;
  updateStatus();
});

// ─── Status indicator ────────────────────────────────────────────────────────
const statusEl = document.createElement('div');
statusEl.style.cssText = `
  position: fixed; bottom: 12px; left: 12px;
  color: rgba(255,255,255,0.45); font-family: monospace; font-size: 12px;
  pointer-events: none; user-select: none; z-index: 10;
`;
document.body.appendChild(statusEl);

function updateStatus() {
  statusEl.textContent =
    `view: ${currentView}  |  preset: ${atPresetView}  |  cut mode: ${cutModeEnabled ? 'ON' : 'off'}  |  cutting: ${isCuttingActive() ? 'ACTIVE' : 'off'}`;
}
updateStatus();

// ─── UI buttons ──────────────────────────────────────────────────────────────
const ui = document.createElement('div');
ui.style.cssText = 'position:fixed;top:16px;left:16px;display:flex;gap:8px;z-index:10;';

function makeButton(label, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = `
    padding: 8px 16px; background: rgba(255,255,255,0.1); color: #e0e0e0;
    border: 1px solid rgba(255,255,255,0.25); border-radius: 4px;
    font-size: 14px; cursor: pointer; backdrop-filter: blur(4px);
  `;
  btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(255,255,255,0.2)');
  btn.addEventListener('mouseleave', () => btn.style.background = 'rgba(255,255,255,0.1)');
  btn.addEventListener('click', onClick);
  return btn;
}

ui.appendChild(makeButton('Reset', resetBlock));
ui.appendChild(makeButton('Front', () => setView('front')));
ui.appendChild(makeButton('Side',  () => setView('side')));
const cutBtn = makeButton('Cut: OFF', toggleCutMode);
ui.appendChild(cutBtn);
document.body.appendChild(ui);

function updateCutButton() {
  cutBtn.textContent = cutModeEnabled ? 'Cut: ON' : 'Cut: OFF';
  cutBtn.style.border = cutModeEnabled
    ? '1px solid rgba(79,195,247,0.7)'
    : '1px solid rgba(255,255,255,0.25)';
}

// ─── Resize ──────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  aspect = window.innerWidth / window.innerHeight;
  camera.left   = -ORTHO_SIZE * aspect;
  camera.right  =  ORTHO_SIZE * aspect;
  camera.top    =  ORTHO_SIZE;
  camera.bottom = -ORTHO_SIZE;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizeTrailCanvas();
});

// ─── Animate ─────────────────────────────────────────────────────────────────
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const delta = now - lastTime;
  lastTime = now;

  if (tween.active) {
    tween.t = Math.min(tween.t + delta / tween.duration, 1);
    camera.position.lerpVectors(tween.from, tween.to, easeInOut(tween.t));
    camera.lookAt(0, 0, 0);
    controls.update();
    if (tween.t >= 1) {
      tween.active = false;
      atPresetView = true;
      updateStatus();
    }
  } else {
    controls.update();
  }

  renderTrail();
  updateFadingPieces(now);
  renderer.render(scene, camera);
}
animate();
