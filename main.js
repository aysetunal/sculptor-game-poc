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
const BLOCK_SIZE = 16.75;
const halfBlock  = BLOCK_SIZE / 2; // 8.375
const FADE_MS    = 300;            // freed-piece fade duration; set to 0 for instant removal

const blockMaterial = new THREE.MeshStandardMaterial({
  color: 0x4fc3f7, roughness: 0.55, metalness: 0.15,
});

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

// ─── Straight-line laser trail (2D canvas overlay) ───────────────────────────
const trailCanvas = document.createElement('canvas');
trailCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
document.body.appendChild(trailCanvas);
const trailCtx = trailCanvas.getContext('2d');

function resizeTrailCanvas() {
  trailCanvas.width  = window.innerWidth;
  trailCanvas.height = window.innerHeight;
}
resizeTrailCanvas();

let lineStartScreen   = null; // { x, y } screen coords, set on pointerdown
let lineCurrentScreen = null; // { x, y } screen coords, updated on pointermove

function renderTrail() {
  trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
  if (!lineStartScreen || !lineCurrentScreen) return;

  const { x: x0, y: y0 } = lineStartScreen;
  const { x: x1, y: y1 } = lineCurrentScreen;

  trailCtx.save();
  trailCtx.shadowColor = 'rgba(79,195,247,0.7)';
  trailCtx.shadowBlur  = 10;
  trailCtx.strokeStyle = 'rgba(79,195,247,0.9)';
  trailCtx.lineWidth   = 2;
  trailCtx.lineCap     = 'round';
  trailCtx.beginPath();
  trailCtx.moveTo(x0, y0);
  trailCtx.lineTo(x1, y1);
  trailCtx.stroke();
  // endpoint dots
  for (const [x, y] of [[x0, y0], [x1, y1]]) {
    trailCtx.beginPath();
    trailCtx.arc(x, y, 3, 0, Math.PI * 2);
    trailCtx.fillStyle = 'rgba(79,195,247,1)';
    trailCtx.shadowBlur = 6;
    trailCtx.fill();
  }
  trailCtx.restore();
}

// ─── Freed-piece connectivity & fading ───────────────────────────────────────
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

// Signed mesh volume via the divergence theorem (tetrahedron formula).
// Works directly on the result geometry without extracting triangles first.
function componentVolume(geo, comp, triCount, getIdx, id) {
  const pos = geo.attributes.position;
  let vol = 0;
  for (let t = 0; t < triCount; t++) {
    if (comp[t] !== id) continue;
    const ai = getIdx(t, 0), bi = getIdx(t, 1), ci = getIdx(t, 2);
    const ax = pos.getX(ai), ay = pos.getY(ai), az = pos.getZ(ai);
    const bx = pos.getX(bi), by = pos.getY(bi), bz = pos.getZ(bi);
    const cx = pos.getX(ci), cy = pos.getY(ci), cz = pos.getZ(ci);
    // scalar triple product: a · (b × c)
    vol += ax * (by * cz - bz * cy)
         + ay * (bz * cx - bx * cz)
         + az * (bx * cy - by * cx);
  }
  return Math.abs(vol / 6);
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

// ─── CSG cut (applied on pointerup — one BVH rebuild per stroke) ─────────────
const CUT_KERF  = 0.15; // blade thickness in world units
let cutStartHit = null; // face-plane world hit recorded on pointerdown

function applyCSGCut(endHit) {
  if (!cutStartHit || !endHit) return;

  // Map world hits to face-plane 2D coords (a = horizontal axis, b = vertical)
  const p0 = currentView === 'front'
    ? { a: cutStartHit.x, b: cutStartHit.y }
    : { a: cutStartHit.z, b: cutStartHit.y };
  const p1 = currentView === 'front'
    ? { a: endHit.x, b: endHit.y }
    : { a: endHit.z, b: endHit.y };

  const da = p1.a - p0.a, db = p1.b - p0.b;
  const segLen = Math.sqrt(da * da + db * db);
  if (segLen < 0.01) return; // tap with no drag → no-op

  // Perpendicular unit normal for the kerf half-width
  const nx = -db / segLen, ny = da / segLen;
  const h  = CUT_KERF / 2;

  // Thin rectangle blade along the cut segment
  const shape = new THREE.Shape();
  shape.moveTo(p0.a - nx * h, p0.b - ny * h);
  shape.lineTo(p1.a - nx * h, p1.b - ny * h);
  shape.lineTo(p1.a + nx * h, p1.b + ny * h);
  shape.lineTo(p0.a + nx * h, p0.b + ny * h);
  shape.closePath();

  const depth = BLOCK_SIZE + 2; // slightly larger than block to guarantee full punch-through
  const geo   = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });

  if (currentView === 'front') {
    // Shape in XY; extrude along +localZ; centre along world Z
    geo.translate(0, 0, -depth / 2);
  } else {
    // Shape in ZY (a=worldZ, b=worldY); extrusion must go along world X.
    // R_y(-π/2): localX→worldZ, localY→worldY, localZ→world-X.
    geo.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
    geo.translate(depth / 2, 0, 0);
  }

  const cutterBrush = new Brush(geo, cutterMaterial);
  cutterBrush.updateMatrixWorld(true);
  blockBrush.updateMatrixWorld(true);

  try {
    const result = evaluator.evaluate(blockBrush, cutterBrush, SUBTRACTION);
    const { comp, numComps, triCount, getIdx } = findComponents(result.geometry);

    if (numComps <= 1) {
      // Non-severing cut — discard result, block is visually unchanged
      result.geometry.dispose();
    } else {
      // Find the largest-volume component — that piece stays as the new block
      let largestId = 0, largestVol = 0;
      for (let c = 0; c < numComps; c++) {
        const v = componentVolume(result.geometry, comp, triCount, getIdx, c);
        if (v > largestVol) { largestVol = v; largestId = c; }
      }

      // All other components fade out
      for (let c = 0; c < numComps; c++) {
        if (c === largestId) continue;
        const g   = extractComponents(result.geometry, comp, triCount, getIdx, new Set([c]));
        const mat = blockMaterial.clone();
        mat.transparent = true;
        mat.opacity = 1;
        const mesh = new THREE.Mesh(g, mat);
        scene.add(mesh);
        fadingPieces.push({ mesh, t0: performance.now() });
      }

      // Commit: swap old block for the largest component
      scene.remove(blockBrush);
      blockBrush.geometry.dispose();

      const largestGeo = extractComponents(result.geometry, comp, triCount, getIdx, new Set([largestId]));
      result.geometry.dispose();

      blockBrush = new Brush(largestGeo, blockMaterial);
      blockBrush.castShadow    = true;
      blockBrush.receiveShadow = true;
      scene.add(blockBrush);
    }
  } catch (err) {
    console.warn('CSG subtraction failed:', err);
  }

  geo.dispose();
  cutStartHit = null;
}

// ─── Actions ─────────────────────────────────────────────────────────────────
function resetBlock() {
  cutting           = false;
  cutStartHit       = null;
  lineStartScreen   = null;
  lineCurrentScreen = null;
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
  if (!cutModeEnabled) {
    cutStartHit       = null;
    lineStartScreen   = null;
    lineCurrentScreen = null;
  }
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
  cutting           = true;
  cutStartHit       = null;
  lineStartScreen   = { x: e.clientX, y: e.clientY };
  lineCurrentScreen = { x: e.clientX, y: e.clientY };
  const hit = screenToFacePlane(e.clientX, e.clientY);
  if (hit) cutStartHit = hit.clone();
}, { capture: true });

window.addEventListener('pointermove', (e) => {
  if (!cutting) return;
  lineCurrentScreen = { x: e.clientX, y: e.clientY };
});

window.addEventListener('pointerup', (e) => {
  if (!cutting) return;
  cutting = false;
  const endHit = screenToFacePlane(e.clientX, e.clientY);
  applyCSGCut(endHit);
  lineStartScreen   = null;
  lineCurrentScreen = null;
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
