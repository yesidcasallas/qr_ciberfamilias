import * as THREE from 'three';
import { roundRect, wrapText } from './world.js';

/**
 * Final del recorrido, dentro de la escena (sin modales): el teléfono flota en el vacío y
 * su pantalla muestra los créditos del Proyecto CiberFamilias con una entrada escalonada.
 *
 *   const ending = createEnding({ scene, camera, audio });
 *   ending.play({ screen, data }, onRestart); // screen: malla de la pantalla del teléfono (opcional)
 *   ending.update(dt);                       // cada frame
 */
const W = 720;
const H = 1520;
const TEAM = ['Laura Tatiana', 'Daniel Casallas', 'Yasmin Becerra'];
const C = {
  text: '#eef0f7',
  muted: 'rgba(238,240,247,0.6)',
  accent: '#a78bfa',
  accentSoft: '#c4b5fd',
  ok: '#34d399',
};

export function createEnding({ scene, camera, audio }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  let active = false;
  let t = 0;
  let info = null;
  let screen = null;
  let lastDraw = -1;
  const center = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const camFrom = new THREE.Vector3();
  const camTo = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  let fitDist = 10;

  // Partículas violeta que flotan alrededor del teléfono.
  const N = 140;
  const pos = new Float32Array(N * 3);
  const seeds = Array.from({ length: N }, () => ({
    r: THREE.MathUtils.randFloat(4.5, 8),
    a: Math.random() * Math.PI * 2,
    y: THREE.MathUtils.randFloatSpread(9),
    s: THREE.MathUtils.randFloat(0.05, 0.16) * (Math.random() < 0.5 ? -1 : 1),
  }));
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const particles = new THREE.Points(
    pGeo,
    new THREE.PointsMaterial({
      size: 0.09,
      color: 0xc4b5fd,
      map: dotTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  particles.frustumCulled = false;
  particles.visible = false;
  scene.add(particles);

  // Panel de respaldo con forma de teléfono (si no llega la malla de la pantalla).
  function fallbackScreen() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(4, 8.1, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x1b1c22, metalness: 0.6, roughness: 0.35, fog: false }),
    );
    const face = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 7.6), new THREE.MeshBasicMaterial({ fog: false }));
    face.position.z = 0.21;
    group.add(body, face);
    group.position.set(0, 1.6, 55);
    scene.add(group);
    return face;
  }

  function onKey(e) {
    if (e.key === 'Enter' || e.key === ' ') restart();
  }
  let restartCb = null;
  function restart() {
    if (!active || t < 3.2) return; // deja terminar la entrada de los créditos
    restartCb?.();
  }

  return {
    get isActive() {
      return active;
    },

    play({ screen: targetScreen, data }, onRestart) {
      info = data;
      restartCb = onRestart;
      const usingFallback = !targetScreen;
      screen = targetScreen || fallbackScreen();
      screen.material = new THREE.MeshBasicMaterial({ map: texture, fog: false });
      screen.visible = true;
      draw(0);

      // Encuadre: de frente a la pantalla, a la distancia en la que su alto llena la vista.
      screen.getWorldPosition(center);
      screen.getWorldDirection(normal);
      if (!screen.geometry.boundingBox) screen.geometry.computeBoundingBox();
      const box = screen.geometry.boundingBox;
      const scale = new THREE.Vector3();
      screen.getWorldScale(scale);
      const h = (box.max.y - box.min.y) * scale.y;
      const w = (box.max.x - box.min.x) * scale.x;
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      fitDist = Math.max(h / 2 / tan, w / 2 / (tan * camera.aspect)) * 1.32; // con aire alrededor
      // sin la salida del teléfono, arranca cerca del panel (no cruza el pasillo volando)
      if (usingFallback) camera.position.copy(normal).multiplyScalar(fitDist * 1.6).add(center);
      camFrom.copy(camera.position);

      particles.position.copy(center);
      particles.visible = true;
      active = true;
      t = 0;
      audio?.success();
      document.addEventListener('pointerdown', restart);
      window.addEventListener('keydown', onKey);
    },

    update(dt) {
      if (!active) return;
      t += dt;

      // Cámara: llega al encuadre y luego orbita suave alrededor del teléfono.
      const orbit = Math.sin(t * 0.25) * 0.22;
      camTo.copy(normal).applyAxisAngle(THREE.Object3D.DEFAULT_UP, orbit).multiplyScalar(fitDist).add(center);
      camTo.y += Math.sin(t * 0.4) * 0.15;
      const k = Math.min(1, t / 1.6);
      const ease = 1 - (1 - k) ** 3;
      camera.position.lerpVectors(camFrom, camTo, ease);
      lookAt.copy(center);
      camera.lookAt(lookAt);

      // Partículas en órbita lenta
      for (let i = 0; i < N; i++) {
        const s = seeds[i];
        const a = s.a + t * s.s;
        pos[i * 3] = Math.cos(a) * s.r;
        pos[i * 3 + 1] = s.y + Math.sin(t * 0.5 + i) * 0.2;
        pos[i * 3 + 2] = Math.sin(a) * s.r;
      }
      pGeo.attributes.position.needsUpdate = true;
      particles.material.opacity = Math.min(0.7, t * 0.4);

      // Créditos: se redibujan durante la entrada; después, solo el aviso que pulsa (bajo costo).
      const step = t < 3.6 ? 0 : 0.5;
      if (t - lastDraw >= step) draw(t);
    },
  };

  function draw(time) {
    lastDraw = time;
    const a = (start) => Math.max(0, Math.min(1, (time - start) / 0.55)); // aparición escalonada

    // fondo
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0f0c1f');
    bg.addColorStop(1, '#06060b');
    g.globalAlpha = 1;
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W / 2, 300, 0, W / 2, 300, 520);
    glow.addColorStop(0, `rgba(167,139,250,${0.22 * a(0)})`);
    glow.addColorStop(1, 'rgba(167,139,250,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);

    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';

    // escudo con una familia: el sello de CiberFamilias
    g.globalAlpha = a(0.2);
    drawShield(g, W / 2, 260, 1.5, C.accent);

    g.globalAlpha = a(0.45);
    g.fillStyle = C.ok;
    g.font = '600 26px system-ui, sans-serif';
    spaced(g, 'FORMULARIO COMPLETADO', W / 2, 470, 4);

    g.globalAlpha = a(0.65);
    g.fillStyle = C.muted;
    g.font = '500 38px system-ui, sans-serif';
    g.fillText('Proyecto', W / 2, 560);

    // "CiberFamilias": Ciber en blanco, Familias en violeta
    g.globalAlpha = a(0.85);
    g.font = '700 86px system-ui, sans-serif';
    const w1 = g.measureText('Ciber').width;
    const w2 = g.measureText('Familias').width;
    const x0 = (W - (w1 + w2)) / 2;
    g.textAlign = 'left';
    g.fillStyle = C.text;
    g.fillText('Ciber', x0, 650);
    g.fillStyle = C.accentSoft;
    g.fillText('Familias', x0 + w1, 650);
    g.textAlign = 'center';

    g.globalAlpha = a(1.3);
    g.fillStyle = C.text;
    g.font = '500 34px system-ui, sans-serif';
    wrapText(g, 'Gracias por completar el formulario', W / 2, 770, W - 100, 46);

    g.globalAlpha = a(1.6);
    g.fillStyle = C.muted;
    g.font = '500 26px system-ui, sans-serif';
    const fell = info.fell === 0 ? '' : `${info.fell} ${info.fell === 1 ? 'señuelo' : 'señuelos'}`;
    let outcome;
    if (info.resisted) outcome = fell ? `Resististe al estafador · caíste en ${fell}` : 'Resististe al estafador y no caíste en nada';
    else outcome = fell ? `Caíste en ${fell} por el camino` : 'Cruzaste sin caer en ningún engaño';
    g.fillText(outcome, W / 2, 860);

    // resumen de lo registrado
    g.globalAlpha = a(1.9);
    roundRect(g, 70, 900, W - 140, 170, 22);
    g.strokeStyle = 'rgba(238,240,247,0.14)';
    g.lineWidth = 2;
    g.stroke();
    g.textAlign = 'left';
    g.font = '500 26px system-ui, sans-serif';
    g.fillStyle = C.muted;
    g.fillText('Correo', 100, 955);
    g.fillText('Universidad', 100, 1035);
    g.textAlign = 'right';
    g.fillStyle = C.text;
    g.font = '500 28px system-ui, sans-serif';
    g.fillText(fit(g, info.email, W - 380), W - 100, 955);
    g.fillText(fit(g, info.university, W - 380), W - 100, 1035);
    g.textAlign = 'center';

    // integrantes
    g.globalAlpha = a(2.3);
    g.fillStyle = C.accent;
    g.font = '600 26px system-ui, sans-serif';
    spaced(g, 'INTEGRANTES', W / 2, 1150, 4);
    g.fillStyle = C.text;
    g.font = '500 42px system-ui, sans-serif';
    TEAM.forEach((name, i) => {
      g.globalAlpha = a(2.5 + i * 0.18);
      g.fillText(name, W / 2, 1220 + i * 62);
    });

    // aviso para reiniciar, con un pulso suave
    const pulse = 0.55 + 0.45 * Math.sin(time * 3);
    g.globalAlpha = a(3.2) * pulse;
    g.fillStyle = C.accentSoft;
    g.font = '500 30px system-ui, sans-serif';
    g.fillText('Toca para volver a entrar', W / 2, 1450);

    g.globalAlpha = 1;
    texture.needsUpdate = true;
  }
}

// ---------------- dibujo ----------------

/** Escudo (seguridad) con tres figuras (familia): sello minimalista de CiberFamilias. */
function drawShield(g, cx, cy, s, color) {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.beginPath();
  g.moveTo(0, -62);
  g.bezierCurveTo(26, -50, 48, -48, 60, -46);
  g.lineTo(60, 2);
  g.bezierCurveTo(60, 42, 32, 64, 0, 78);
  g.bezierCurveTo(-32, 64, -60, 42, -60, 2);
  g.lineTo(-60, -46);
  g.bezierCurveTo(-48, -48, -26, -50, 0, -62);
  g.closePath();
  g.strokeStyle = color;
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = color;
  // cabezas
  for (const [x, y, r] of [
    [-24, -12, 8],
    [0, -20, 10],
    [24, -12, 8],
  ]) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // hombros
  g.lineWidth = 4;
  for (const [x, w, top] of [
    [-24, 13, 2],
    [0, 16, -4],
    [24, 13, 2],
  ]) {
    g.beginPath();
    g.moveTo(x - w, 34);
    g.quadraticCurveTo(x - w, top, x, top);
    g.quadraticCurveTo(x + w, top, x + w, 34);
    g.stroke();
  }
  g.restore();
}

/** Texto con espaciado entre letras (para rótulos en mayúsculas). */
function spaced(g, text, cx, y, spacing) {
  const chars = [...text];
  const widths = chars.map((ch) => g.measureText(ch).width);
  const total = widths.reduce((s, w) => s + w, 0) + spacing * (chars.length - 1);
  let x = cx - total / 2;
  const align = g.textAlign;
  g.textAlign = 'left';
  chars.forEach((ch, i) => {
    g.fillText(ch, x, y);
    x += widths[i] + spacing;
  });
  g.textAlign = align;
}

function fit(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
