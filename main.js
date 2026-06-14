import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
scene.fog = new THREE.Fog(0x1a1a2e, 40, 120);

// Camera
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(28, 22, 28);
camera.lookAt(0, 0, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Orbit controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 10;
controls.maxDistance = 80;
controls.target.set(0, 0, 0);

// Lighting
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

// 16×16×16 voxel grid
const GRID = 16;
const VOXEL_SIZE = 1;
const GAP = 0.05;
const step = VOXEL_SIZE + GAP;
const offset = ((GRID - 1) * step) / 2;

const geometry = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
const material = new THREE.MeshStandardMaterial({
  color: 0x4fc3f7,
  roughness: 0.55,
  metalness: 0.15,
});

const count = GRID * GRID * GRID;
const mesh = new THREE.InstancedMesh(geometry, material, count);
mesh.castShadow = true;
mesh.receiveShadow = true;

// Store each voxel's default matrix so Reset can restore it
const defaultMatrices = new Float32Array(count * 16);

const dummy = new THREE.Object3D();
let idx = 0;
for (let x = 0; x < GRID; x++) {
  for (let y = 0; y < GRID; y++) {
    for (let z = 0; z < GRID; z++) {
      dummy.position.set(x * step - offset, y * step - offset, z * step - offset);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);
      dummy.matrix.toArray(defaultMatrices, idx * 16);

      const t = y / (GRID - 1);
      const color = new THREE.Color().lerpColors(
        new THREE.Color(0x1565c0),
        new THREE.Color(0x80deea),
        t
      );
      mesh.setColorAt(idx, color);
      idx++;
    }
  }
}
mesh.instanceMatrix.needsUpdate = true;
mesh.instanceColor.needsUpdate = true;
scene.add(mesh);

// View state
let currentView = 'front';
const VIEWS = {
  front: new THREE.Vector3(0, 0, 30),
  side:  new THREE.Vector3(30, 0, 0),
};

// Camera tween state
const tween = { active: false, t: 0, duration: 400, from: new THREE.Vector3(), to: new THREE.Vector3() };

function startTween(toPos) {
  tween.from.copy(camera.position);
  tween.to.copy(toPos);
  tween.t = 0;
  tween.active = true;
}

// Ease in-out quad
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

// Reset: restore all voxels
function resetBlock() {
  const mat = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    mat.fromArray(defaultMatrices, i * 16);
    mesh.setMatrixAt(i, mat);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.count = count;
}

// Switch view
function switchView() {
  currentView = currentView === 'front' ? 'side' : 'front';
  controls.target.set(0, 0, 0);
  startTween(VIEWS[currentView]);
}

// HTML overlay
const ui = document.createElement('div');
ui.style.cssText = 'position:fixed;top:16px;left:16px;display:flex;gap:8px;z-index:10;';

function makeButton(label, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = `
    padding: 8px 16px;
    background: rgba(255,255,255,0.1);
    color: #e0e0e0;
    border: 1px solid rgba(255,255,255,0.25);
    border-radius: 4px;
    font-size: 14px;
    cursor: pointer;
    backdrop-filter: blur(4px);
  `;
  btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(255,255,255,0.2)');
  btn.addEventListener('mouseleave', () => btn.style.background = 'rgba(255,255,255,0.1)');
  btn.addEventListener('click', onClick);
  return btn;
}

ui.appendChild(makeButton('Reset', resetBlock));
ui.appendChild(makeButton('Switch View', switchView));
document.body.appendChild(ui);

// Resize handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Animate
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const delta = now - lastTime;
  lastTime = now;

  if (tween.active) {
    tween.t = Math.min(tween.t + delta / tween.duration, 1);
    const e = easeInOut(tween.t);
    camera.position.lerpVectors(tween.from, tween.to, e);
    camera.lookAt(0, 0, 0);
    controls.update();
    if (tween.t >= 1) tween.active = false;
  } else {
    controls.update();
  }

  renderer.render(scene, camera);
}
animate();
