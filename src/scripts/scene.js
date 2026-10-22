import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Medidas del teléfono en unidades de mundo. La pantalla HTML mide 400 × 844 px.
const SCREEN_W = 3.6;
const SCREEN_H = 7.6;
const EL_W = 400;
const EL_H = 844;
const PX = SCREEN_W / EL_W; // unidades de mundo por píxel CSS
const BODY_W = 4.0;
const BODY_H = 8.1;
const BEVEL = 0.06;
const FACE_Z = 0.15 + BEVEL; // cara frontal del cuerpo
const FOV = 35;

// Línea de tiempo de la entrada (segundos).
const INTRO = { fly: [0.2, 1.7], power: [1.6, 0.7], dolly: [2.2, 1.6], reveal: 3.0 };

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const phase = (t, [start, duration]) => clamp01((t - start) / duration);
const outCubic = (t) => 1 - (1 - t) ** 3;
const inOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const damp = (current, target, lambda, dt) => THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
const rand = THREE.MathUtils.randFloatSpread;

export function createScene({ container, screenEl, bus, loader }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch {
    return false;
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  const cssRenderer = new CSS3DRenderer();
  cssRenderer.setSize(window.innerWidth, window.innerHeight);
  cssRenderer.domElement.id = 'css3d';
  document.body.appendChild(cssRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07070b);
  scene.fog = new THREE.Fog(0x07070b, 20, 60);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.1, 200);

  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(4, 6, 8);
  const rim = new THREE.PointLight(0xa78bfa, 60, 30);
  rim.position.set(-6, 3, -2);
  const front = new THREE.PointLight(0xffffff, 6, 14);
  front.position.set(0, 2, 6);
  scene.add(key, rim, front);

  const dotTexture = makeDotTexture();

  // ---------- Teléfono ----------
  const phone = new THREE.Group();
  scene.add(phone);

  const frameMat = new THREE.MeshPhysicalMaterial({
    color: 0x1b1c22,
    metalness: 0.9,
    roughness: 0.3,
    clearcoat: 0.7,
    clearcoatRoughness: 0.25,
  });
  const bodyGeo = new THREE.ExtrudeGeometry(roundedRect(BODY_W, BODY_H, 0.58), {
    depth: 0.3,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 5,
    curveSegments: 24,
  });
  bodyGeo.center();
  phone.add(new THREE.Mesh(bodyGeo, frameMat));

  const glass = new THREE.Mesh(
    new THREE.ShapeGeometry(roundedRect(BODY_W - 0.03, BODY_H - 0.03, 0.56), 24),
    new THREE.MeshPhysicalMaterial({ color: 0x020205, roughness: 0.06, metalness: 0.1, clearcoat: 1 }),
  );
  glass.position.z = FACE_Z + 0.001;
  phone.add(glass);

  const screenMat = new THREE.MeshBasicMaterial({ map: makeWallpaper(), toneMapped: false });
  screenMat.color.setScalar(0); // arranca apagada; se enciende en la intro
  const screenMesh = new THREE.Mesh(planeFromShape(roundedRect(SCREEN_W, SCREEN_H, 0.44), SCREEN_W, SCREEN_H), screenMat);
  screenMesh.position.z = FACE_Z + 0.003;
  phone.add(screenMesh);

  const island = new THREE.Mesh(
    new THREE.ShapeGeometry(roundedRect(0.95, 0.27, 0.135), 12),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  );
  island.position.set(0, SCREEN_H / 2 - 0.26, FACE_Z + 0.005);
  phone.add(island);

  // Botones laterales y cámara trasera (se ven durante el giro de entrada).
  const sideX = BODY_W / 2 + BEVEL;
  for (const [x, y, h] of [
    [sideX, 1.6, 1.0],
    [-sideX, 2.3, 0.65],
    [-sideX, 1.45, 0.65],
  ]) {
    const button = new THREE.Mesh(new RoundedBoxGeometry(0.08, h, 0.16, 2, 0.03), frameMat);
    button.position.set(x, y, 0);
    phone.add(button);
  }
  const bump = new THREE.Mesh(new RoundedBoxGeometry(1.5, 1.5, 0.1, 4, 0.045), frameMat);
  bump.position.set(1.0, 2.95, -FACE_Z - 0.04);
  phone.add(bump);
  const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x050508, roughness: 0.05, metalness: 0.5, clearcoat: 1 });
  for (const [x, y] of [
    [0.62, 3.33],
    [0.62, 2.57],
    [1.36, 2.95],
  ]) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.12, 32), lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(x, y, -FACE_Z - 0.12);
    phone.add(lens);
  }

  // La pantalla HTML real, pegada sobre el cristal.
  const cssScreen = new CSS3DObject(screenEl);
  cssScreen.scale.setScalar(PX);
  cssScreen.position.z = FACE_Z + 0.01;
  phone.add(cssScreen);

  // ---------- Estrellas (tenues, de fondo) ----------
  const starCount = 500;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(THREE.MathUtils.randFloat(16, 46));
    starPos.set([v.x, v.y, v.z], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ size: 0.13, map: dotTexture, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  scene.add(stars);

  // ---------- Confeti (solo al terminar) ----------
  const MAX_P = 320;
  const pPos = new Float32Array(MAX_P * 3);
  const pCol = new Float32Array(MAX_P * 3);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  const particles = new THREE.Points(
    pGeo,
    new THREE.PointsMaterial({
      size: 0.14,
      map: dotTexture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  particles.frustumCulled = false;
  phone.add(particles);
  const pData = Array.from({ length: MAX_P }, () => ({ life: 0, max: 1, vel: new THREE.Vector3(), color: new THREE.Color() }));
  const palette = [0xa78bfa, 0x34d399, 0x22d3ee, 0xf472b6, 0xffffff].map((c) => new THREE.Color(c));
  const tmp = new THREE.Vector3();

  const burst = () => {
    for (let i = 0; i < MAX_P; i++) {
      const p = pData[i];
      pPos.set([rand(0.6), 1.2, FACE_Z + 0.3], i * 3);
      tmp.randomDirection().multiplyScalar(2 + Math.random() * 4);
      tmp.z = Math.abs(tmp.z) * 0.6;
      p.vel.copy(tmp);
      p.vel.y += 2;
      p.color.copy(palette[i % palette.length]);
      p.life = p.max = 1.3 + Math.random();
    }
  };

  const updateParticles = (dt) => {
    for (let i = 0; i < MAX_P; i++) {
      const p = pData[i];
      const i3 = i * 3;
      if (p.life <= 0) {
        pCol[i3] = pCol[i3 + 1] = pCol[i3 + 2] = 0;
        continue;
      }
      p.life -= dt;
      p.vel.y -= 4 * dt;
      p.vel.multiplyScalar(Math.exp(-1 * dt));
      tmp.fromArray(pPos, i3).addScaledVector(p.vel, dt).toArray(pPos, i3);
      const fade = Math.max(0, p.life / p.max);
      pCol[i3] = p.color.r * fade;
      pCol[i3 + 1] = p.color.g * fade;
      pCol[i3 + 2] = p.color.b * fade;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  };

  // ---------- Estado y eventos del juego ----------
  let fitDist = fitDistance();
  let introStart = reducedMotion ? -INTRO.reveal - 1 : 0;
  let ready = false;
  let shake = 0;
  let bob = 0; // rebote positivo al acertar
  let spinT = 1; // giro de celebración (0 -> 1)
  const tilt = { x: 0, y: 0 };
  const pointer = { x: 0, y: 0, mouse: false };

  bus.addEventListener('wrong', () => {
    if (!reducedMotion) shake = 1;
  });
  bus.addEventListener('right', () => {
    if (!reducedMotion) bob = 1;
  });
  bus.addEventListener('win', () => {
    burst();
    if (!reducedMotion) spinT = 0;
  });

  // ---------- Puntero: inclinar en escritorio, tocar para saltar la intro ----------
  const timer = new THREE.Timer();
  timer.connect(document);

  window.addEventListener('pointermove', (e) => {
    pointer.mouse = e.pointerType === 'mouse';
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  });
  window.addEventListener('pointerdown', (e) => {
    const onControl = e.target instanceof Element && e.target.closest('input, button, label, a');
    if (!ready && !onControl) introStart = Math.min(introStart, timer.getElapsed() - INTRO.reveal);
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    cssRenderer.setSize(window.innerWidth, window.innerHeight);
    fitDist = fitDistance();
  });

  // Reloj de la barra de estado.
  const clock = screenEl.querySelector('#clock');
  const tick = () => {
    clock.textContent = new Date().toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' });
  };
  tick();
  setInterval(tick, 15000);

  // ---------- Bucle ----------
  let firstFrame = true;

  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 1 / 20);
    const time = timer.getElapsed();
    const t = time - introStart;
    const mobile = isMobile();

    if (firstFrame) {
      firstFrame = false;
      loader.classList.add('hide');
      setTimeout(() => loader.remove(), 900);
    }

    // Entrada: el teléfono llega girando, la pantalla se enciende, la cámara entra en él.
    const fly = outCubic(phase(t, INTRO.fly));
    const dolly = inOutCubic(phase(t, INTRO.dolly));
    const power = phase(t, INTRO.power);
    screenMat.color.setScalar(power < 0.3 ? (power / 0.3) * 1.6 : THREE.MathUtils.lerp(1.6, 1, (power - 0.3) / 0.7));

    if (!ready && t >= INTRO.reveal) {
      ready = true;
      screenEl.classList.add('on');
    }

    const allowTilt = ready && pointer.mouse && !mobile && !reducedMotion;
    tilt.x = damp(tilt.x, allowTilt ? pointer.y * 0.12 : 0, 4, dt);
    tilt.y = damp(tilt.y, allowTilt ? pointer.x * 0.16 : 0, 4, dt);

    spinT = Math.min(1, spinT + dt / 1.2);
    const spin = spinT < 1 ? inOutCubic(spinT) * Math.PI * 2 : 0;
    shake = Math.max(0, shake - dt * 1.8);
    bob = Math.max(0, bob - dt * 2.4);
    const idle = mobile || reducedMotion ? 0 : 1;

    phone.position.set(
      Math.sin(time * 55) * shake * shake * 0.22,
      Math.sin(time * 0.9) * 0.05 * idle + bob * bob * 0.12,
      THREE.MathUtils.lerp(-32, 0, fly),
    );
    phone.rotation.set(
      THREE.MathUtils.lerp(0.6, 0, fly) + tilt.x + Math.sin(time * 0.7) * 0.015 * idle,
      THREE.MathUtils.lerp(-Math.PI * 2.5, 0, fly) + tilt.y + spin,
      THREE.MathUtils.lerp(-0.25, 0, fly),
    );

    const camZ = THREE.MathUtils.lerp(fitDist + 10, fitDist, dolly);
    camera.position.z = ready ? damp(camera.position.z, fitDist, 6, dt) : camZ;
    camera.position.y = THREE.MathUtils.lerp(1.0, 0, dolly);
    camera.lookAt(0, 0, 0);

    stars.rotation.y += dt * 0.008;
    updateParticles(dt);

    renderer.render(scene, camera);
    cssRenderer.render(scene, camera);
  });

  return true;
}

function isMobile() {
  return window.innerWidth / window.innerHeight < 0.75 && window.innerWidth < 820;
}

/** Distancia de cámara para que el teléfono quepa; en móvil la pantalla ocupa toda la real. */
function fitDistance() {
  const aspect = window.innerWidth / window.innerHeight;
  const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  if (isMobile()) {
    return Math.max(SCREEN_H / 2 / t, SCREEN_W / 2 / (t * aspect)) + FACE_Z + 0.01;
  }
  const w = BODY_W + BEVEL * 2;
  const h = BODY_H + BEVEL * 2;
  return Math.max(h / 2 / t, w / 2 / (t * aspect)) * 1.14;
}

function roundedRect(w, h, r) {
  const x = -w / 2;
  const y = -h / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

/** ShapeGeometry con UV normalizadas a 0–1 para poder ponerle una textura. */
function planeFromShape(shape, w, h) {
  const geometry = new THREE.ShapeGeometry(shape, 24);
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  return geometry;
}

function makeWallpaper() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1080;
  const g = canvas.getContext('2d');
  g.fillStyle = '#07070b';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const radial = g.createRadialGradient(150, 200, 0, 150, 200, 440);
  radial.addColorStop(0, 'rgba(167,139,250,0.22)');
  radial.addColorStop(1, 'rgba(7,7,11,0)');
  g.fillStyle = radial;
  g.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeDotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  const radial = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  radial.addColorStop(0, 'rgba(255,255,255,1)');
  radial.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  radial.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = radial;
  g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
