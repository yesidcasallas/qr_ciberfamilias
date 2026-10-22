import * as THREE from 'three';

/**
 * Portal de energía neón (aro + disco con remolino + partículas de succión).
 *
 * API:  const api = createPortal({ scene })
 *   - api.group              : THREE.Group ya añadido a la escena (arranca invisible).
 *   - api.show(x, y, z)      : coloca el portal en el mundo, lo abre (escala 0→1 + brillo, ~0.5 s).
 *   - api.hide()             : cierre (fade ~0.4 s); al terminar deja group.visible = false.
 *   - api.update(dt, elapsed): cada frame; anima remolino, partículas y la apertura/cierre.
 *   - api.isActive           : getter booleano (true mientras está visible/activo).
 *
 * El portal mira hacia +Z; quien lo use puede girar group.rotation.y para orientarlo.
 *
 * Ejemplo de uso (3 líneas):
 *   const portal = createPortal({ scene });
 *   portal.show(0, 2.5, -17);                       // abre el portal en el mundo
 *   function frame(dt, t) { portal.update(dt, t); } // anímalo cada frame del bucle
 */

// Paleta del proyecto (Amalfi).
const BRISA = 0x86c5ff; // Sea Breeze
const AMALFI = 0x2e5aa7; // Amalfi Tile

// Geometría y tiempos.
const RADIO_ARO = 1.3; // radio del toro
const TUBO_ARO = 0.12; // grosor del tubo
const RADIO_DISCO = RADIO_ARO - TUBO_ARO; // el disco cabe dentro del aro
const N_PART = 200; // partículas (≤ 300)
const R_MAX = RADIO_ARO; // radio exterior donde (re)aparecen
const R_MIN = 0.12; // radio donde son "absorbidas" y reaparecen
const DUR_ABRIR = 0.5; // s
const DUR_CERRAR = 0.4; // s

// Easings.
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const outBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
const inQuad = (t) => t * t;

export function createPortal({ scene }) {
  // ---------- Grupo raíz ----------
  const group = new THREE.Group();
  group.name = 'portal';
  group.visible = false;
  group.scale.setScalar(0.0001);
  scene.add(group);

  // ---------- Aro emisivo (glow con bloom) ----------
  const brisa = new THREE.Color(BRISA);
  const amalfi = new THREE.Color(AMALFI);
  const colorAro = new THREE.Color(); // reutilizable, sin asignar por frame

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(RADIO_ARO, TUBO_ARO, 18, 72),
    // Color muy brillante + toneMapped:false => cruza el umbral de bloom (~0.62) y brilla.
    new THREE.MeshBasicMaterial({ color: BRISA, toneMapped: false }),
  );
  ring.frustumCulled = false;
  group.add(ring);

  // ---------- Disco de energía con remolino (ShaderMaterial) ----------
  const diskMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uColorA: { value: new THREE.Color(BRISA) },
      uColorB: { value: new THREE.Color(AMALFI) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpacity;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying vec2 vUv;

      void main() {
        vec2 p = vUv * 2.0 - 1.0;      // -1..1, centro del disco en (0,0)
        float r = length(p);
        float ang = atan(p.y, p.x);

        // Remolino: el ángulo se mezcla con el radio y el tiempo (espiral que gira).
        float spiral = sin(ang * 3.0 + r * 12.0 - uTime * 2.6);
        float spiral2 = sin(ang * 2.0 - r * 7.0 + uTime * 1.7);
        float swirl = 0.5 + 0.5 * spiral * spiral2;

        // Color Sea Breeze→Amalfi según radio y remolino.
        vec3 col = mix(uColorB, uColorA, clamp(r * 0.6 + swirl * 0.5, 0.0, 1.0));

        // Núcleo brillante y borde que se desvanece antes de tocar el aro.
        float core = smoothstep(0.55, 0.0, r);
        float edge = smoothstep(1.0, 0.72, r);
        float energy = (swirl * 0.7 + core * 0.45) * edge;

        // Intensidad contenida: con el bloom activo, más brillo quema el centro a blanco.
        float alpha = clamp(energy, 0.0, 1.0) * uOpacity * 0.85;
        gl_FragColor = vec4(col * (0.3 + energy * 0.6), alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const disk = new THREE.Mesh(new THREE.CircleGeometry(RADIO_DISCO, 48), diskMat);
  disk.frustumCulled = false;
  disk.renderOrder = 1; // tras el aro opaco (aditivo, sin escribir profundidad)
  group.add(disk);

  // ---------- Partículas en espiral (succión) ----------
  const positions = new Float32Array(N_PART * 3);
  const colors = new Float32Array(N_PART * 3);
  const ang = new Float32Array(N_PART); // ángulo actual
  const rad = new Float32Array(N_PART); // radio actual
  const velAng = new Float32Array(N_PART); // velocidad angular (rad/s)
  const velIn = new Float32Array(N_PART); // velocidad hacia el centro (u/s)
  const zBase = new Float32Array(N_PART); // desfase en z (profundidad)

  // Siembra una partícula; `desdeFuera` = reaparece en el borde exterior.
  const sembrarUna = (i, desdeFuera) => {
    ang[i] = Math.random() * Math.PI * 2;
    rad[i] = desdeFuera
      ? R_MAX + Math.random() * 0.2
      : R_MIN + Math.random() * (R_MAX - R_MIN);
    velAng[i] = 0.6 + Math.random() * 0.9; // mismo sentido => remolino coherente
    velIn[i] = 0.25 + Math.random() * 0.5;
    zBase[i] = (Math.random() - 0.5) * 0.25;
  };

  // (Re)siembra todas y escribe sus posiciones iniciales.
  const sembrarTodas = () => {
    const c = new THREE.Color();
    for (let i = 0; i < N_PART; i++) {
      sembrarUna(i, false);
      const i3 = i * 3;
      const r = rad[i];
      positions[i3] = Math.cos(ang[i]) * r;
      positions[i3 + 1] = Math.sin(ang[i]) * r;
      positions[i3 + 2] = zBase[i] * (r / R_MAX);
      // Color alterno Sea Breeze/Amalfi, un poco sobreexpuesto para que brille.
      c.copy(i % 2 === 0 ? brisa : amalfi).multiplyScalar(1.25);
      colors[i3] = c.r;
      colors[i3 + 1] = c.g;
      colors[i3 + 2] = c.b;
    }
  };
  sembrarTodas();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.09,
      map: makeDotTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  points.frustumCulled = false;
  points.renderOrder = 2;
  group.add(points);

  // ---------- Estado interno (encapsulado en el closure) ----------
  let estado = 'idle'; // 'idle' | 'opening' | 'open' | 'closing'
  let animT = 0; // cronómetro de la animación actual
  let escala = 0; // escala aplicada al grupo este frame
  let brillo = 0; // 0..1 intensidad de brillo/opacidad
  let cierreEscala = 0; // escala desde la que arranca el cierre
  let cierreBrillo = 0; // brillo desde el que arranca el cierre

  // ---------- API ----------
  function show(x, y, z) {
    group.position.set(x, y, z);
    group.visible = true;
    estado = 'opening';
    animT = 0;
    escala = 0;
    brillo = 0;
    group.scale.setScalar(0.0001);
    sembrarTodas(); // re-sembrar para dar sensación de formación
  }

  function hide() {
    if (estado === 'idle' || estado === 'closing') return;
    cierreEscala = escala; // cierra suavemente desde el estado actual
    cierreBrillo = brillo;
    estado = 'closing';
    animT = 0;
  }

  function update(dt, elapsed) {
    if (estado === 'idle') return;

    // 1) Avanzar apertura/cierre.
    if (estado === 'opening') {
      animT += dt;
      const p = clamp01(animT / DUR_ABRIR);
      escala = outBack(p);
      brillo = p;
      if (p >= 1) {
        estado = 'open';
        escala = 1;
        brillo = 1;
      }
    } else if (estado === 'closing') {
      animT += dt;
      const p = clamp01(animT / DUR_CERRAR);
      escala = cierreEscala * (1 - inQuad(p));
      brillo = cierreBrillo * (1 - p);
      if (p >= 1) {
        estado = 'idle';
        group.visible = false;
        group.scale.setScalar(0.0001);
        return;
      }
    } else {
      escala = 1;
      brillo = 1;
    }

    group.scale.setScalar(Math.max(0.0001, escala));

    // 2) Aro: Sea Breeze con un pulso suave; sube de brillo con la apertura.
    const osc = 0.5 + 0.5 * Math.sin(elapsed * 0.8);
    // Con bloom de umbral 1.0 solo el aro (HDR) brilla; el remolino interior queda nítido.
    // Aro solo Sea Breeze: brillo suave y constante, sin quemarse a blanco. Es más luminoso que el
    // violeta de antes, por eso los factores van ×0.64.
    colorAro.copy(brisa).multiplyScalar(0.19 + brillo * 2.05 + osc * 0.1);
    ring.material.color.copy(colorAro);
    ring.rotation.z += dt * 0.25;
    ring.scale.setScalar(1 + Math.sin(elapsed * 3.0) * 0.015 * brillo); // pulso sutil

    // 3) Disco: remolino animado por uTime + opacidad por brillo.
    diskMat.uniforms.uTime.value = elapsed;
    diskMat.uniforms.uOpacity.value = brillo;
    disk.rotation.z -= dt * 0.35;

    // 4) Partículas: espiral hacia el centro; al llegar reaparecen fuera (bucle).
    for (let i = 0; i < N_PART; i++) {
      ang[i] += velAng[i] * dt;
      rad[i] -= velIn[i] * dt;
      if (rad[i] < R_MIN) sembrarUna(i, true);
      const r = rad[i];
      const i3 = i * 3;
      positions[i3] = Math.cos(ang[i]) * r;
      positions[i3 + 1] = Math.sin(ang[i]) * r;
      positions[i3 + 2] = zBase[i] * (r / R_MAX); // convergen al plano central
    }
    geometry.attributes.position.needsUpdate = true;
    points.material.opacity = brillo * 0.7;
  }

  return {
    group,
    show,
    hide,
    update,
    get isActive() {
      return estado !== 'idle';
    },
  };
}

/** Textura de punto suave hecha con canvas (para las partículas aditivas). */
function makeDotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  const radial = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  radial.addColorStop(0, 'rgba(255,255,255,1)');
  radial.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  radial.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = radial;
  g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
