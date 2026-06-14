import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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

// ─── Voxel grid ──────────────────────────────────────────────────────────────
const GRID = 16;
const VOXEL_SIZE = 1;
const GAP = 0.05;
const step = VOXEL_SIZE + GAP;
const offset = ((GRID - 1) * step) / 2;
const halfBlock = offset + VOXEL_SIZE * 0.5;

const geometry = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
const material = new THREE.MeshStandardMaterial({ color: 0x4fc3f7, roughness: 0.55, metalness: 0.15 });

const count = GRID * GRID * GRID;
const mesh = new THREE.InstancedMesh(geometry, material, count);
mesh.castShadow = true;
mesh.receiveShadow = true;

const defaultMatrices = new Float32Array(count * 16);
const alive = new Uint8Array(count).fill(1);
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

const dummy = new THREE.Object3D();
let bi = 0;
for (let x = 0; x < GRID; x++) {
  for (let y = 0; y < GRID; y++) {
    for (let z = 0; z < GRID; z++) {
      dummy.position.set(x * step - offset, y * step - offset, z * step - offset);
      dummy.updateMatrix();
      mesh.setMatrixAt(bi, dummy.matrix);
      dummy.matrix.toArray(defaultMatrices, bi * 16);
      const t = y / (GRID - 1);
      mesh.setColorAt(bi, new THREE.Color().lerpColors(new THREE.Color(0x1565c0), new THREE.Color(0x80deea), t));
      bi++;
    }
  }
}
mesh.instanceMatrix.needsUpdate = true;
mesh.instanceColor.needsUpdate = true;
scene.add(mesh);

// ─── View & cut state ────────────────────────────────────────────────────────
let currentView = 'free';    // 'free' | 'front' | 'side'
let atPresetView = false;    // for status display only
let cutModeEnabled = false;  // user toggle; owns controls.enabled

// Cutting is live when cut mode is on and we're at an axis-aligned view
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
let trailPoints = []; // { x, y, t }

function addTrailPoint(x, y) {
  trailPoints.push({ x, y, t: performance.now() });
}

function renderTrail() {
  trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
  if (!trailPoints.length) return;
  const now = performance.now();
  trailPoints = trailPoints.filter(p => now - p.t < TRAIL_FADE_MS);
  for (const p of trailPoints) {
    const age = (now - p.t) / TRAIL_FADE_MS;       // 0 = fresh, 1 = expired
    const alpha = Math.pow(1 - age, 1.8);           // accelerated fade
    const r = 22 * (1 - age * 0.35);                // slight shrink as it ages
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

// ─── Actions ─────────────────────────────────────────────────────────────────
function resetBlock() {
  const mat = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    mat.fromArray(defaultMatrices, i * 16);
    mesh.setMatrixAt(i, mat);
    alive[i] = 1;
  }
  mesh.instanceMatrix.needsUpdate = true;
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
  // Cut mode owns the orbit lock: ON → freeze camera, OFF → restore orbit
  controls.enabled = !cutModeEnabled;
  if (!cutModeEnabled) trailPoints = []; // clear any lingering trail on exit
  updateCutButton();
  updateStatus();
}

// ─── Voxel helpers ───────────────────────────────────────────────────────────
function voxelIdx(x, y, z) { return x * GRID * GRID + y * GRID + z; }

function killColumn(ga, gy) {
  if (currentView === 'front') {
    for (let z = 0; z < GRID; z++) {
      const i = voxelIdx(ga, gy, z);
      if (alive[i]) { alive[i] = 0; mesh.setMatrixAt(i, ZERO_MATRIX); }
    }
  } else {
    for (let x = 0; x < GRID; x++) {
      const i = voxelIdx(x, gy, ga);
      if (alive[i]) { alive[i] = 0; mesh.setMatrixAt(i, ZERO_MATRIX); }
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// ─── Raycasting ──────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const hitPoint = new THREE.Vector3();
const planeFront = new THREE.Plane(new THREE.Vector3(0, 0, 1), -halfBlock);
const planeSide  = new THREE.Plane(new THREE.Vector3(1, 0, 0), -halfBlock);

function screenToGridCell(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -(((clientY - rect.top) / rect.height) * 2 - 1),
  ), camera);

  const plane = currentView === 'front' ? planeFront : planeSide;
  if (!raycaster.ray.intersectPlane(plane, hitPoint)) return null;

  const gy = Math.floor((hitPoint.y + halfBlock) / step);
  if (gy < 0 || gy >= GRID) return null;

  if (currentView === 'front') {
    const gx = Math.floor((hitPoint.x + halfBlock) / step);
    if (gx < 0 || gx >= GRID) return null;
    return { ga: gx, gy };
  } else {
    const gz = Math.floor((hitPoint.z + halfBlock) / step);
    if (gz < 0 || gz >= GRID) return null;
    return { ga: gz, gy };
  }
}

// ─── Bresenham ───────────────────────────────────────────────────────────────
function* bresenham(x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    yield { ga: x0, gy: y0 };
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 <  dx) { err += dx; y0 += sy; }
  }
}

// ─── Swipe / cut ─────────────────────────────────────────────────────────────
let cutting = false;
let lastCell = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!cutModeEnabled) return;
  // In cut mode the camera is locked, so always consume the event — never let
  // a missed swipe fall through to orbit controls or re-enable orbit.
  e.stopPropagation();
  if (currentView === 'free') return; // no axis defined, swallow silently
  addTrailPoint(e.clientX, e.clientY);
  const cell = screenToGridCell(e.clientX, e.clientY);
  if (!cell) return; // miss: trail still shows, but no column removed
  cutting = true;
  lastCell = cell;
  killColumn(cell.ga, cell.gy);
}, { capture: true });

window.addEventListener('pointermove', (e) => {
  if (!cutting) return;
  addTrailPoint(e.clientX, e.clientY);
  const cell = screenToGridCell(e.clientX, e.clientY);
  if (!cell) return;
  for (const c of bresenham(lastCell.ga, lastCell.gy, cell.ga, cell.gy)) {
    killColumn(c.ga, c.gy);
  }
  lastCell = cell;
});

window.addEventListener('pointerup', () => {
  if (!cutting) return;
  cutting = false;
  lastCell = null;
  // controls.enabled is owned by cutModeEnabled — do NOT touch it here
});

// Track when user manually orbits (only fires when controls.enabled = true)
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
    // controls.update() is a no-op when controls.enabled = false, but call it
    // anyway so damping state stays in sync for when controls re-enable later
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
  renderer.render(scene, camera);
}
animate();
