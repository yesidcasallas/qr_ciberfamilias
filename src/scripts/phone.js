import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Teléfono 3D que te lleva a otro mundo: su pantalla muestra EN VIVO el pasillo (render-to-texture),
 * la cámara entra en la pantalla y apareces dentro. El outro hace lo inverso: sales del teléfono.
 *
 * API:  const phone = createPhone({ scene, renderer })
 *   - phone.group                 : THREE.Group con el teléfono, ya añadido a `scene`, visible=false de inicio.
 *   - phone.playIntro(camera, cb) : toma `camera` y ejecuta la entrada (~3.8 s). El cruce no lleva destello: el
 *                                   último cuadro de la pantalla es lo mismo que se ve adentro. Deja la cámara
 *                                   EXACTAMENTE en la pose de inicio (0, 1.6, 2) mirando a -Z y oculta el teléfono;
 *                                   si la vista es más ancha que la pantalla (horizontal), el fov se abre desde lo
 *                                   que ella mostraba hasta 70 (apertura, ≤ 1 s). Al final llama a cb() con fov 70.
 *   - phone.playOutro(camera, cb) : la cámara arranca pegada a la pantalla (llena la vista con el mundo) y
 *                                   retrocede hasta encuadrar el teléfono; la pantalla se apaga y llama a cb()
 *                                   (~3 s). El teléfono queda visible y la cámara quieta en el último encuadre.
 *   - phone.update(dt)            : cada frame, en segundos reales, ANTES de composer.render(). Inactivo: retorna.
 *   - phone.isActive              : getter; true durante intro, apertura y outro (mientras controla la cámara).
 *   - phone.skip()                : salta al final de la animación en curso (también llama a su cb).
 *
 * Ejemplo de uso (4 líneas):
 *   const phone = createPhone({ scene, renderer });
 *   phone.playIntro(camera, () => player.setEnabled(true));
 *   canvas.addEventListener('pointerdown', () => phone.isActive && phone.skip());
 *   function frame(dt) { phone.update(dt); composer.render(); }
 *
 * Integración:
 *   - El teléfono vive aislado del pasillo, en (0, 1.6, 55), pantalla hacia +Z: desde ahí la niebla oculta el
 *     mundo. Sus materiales llevan fog:false y un envMap de estudio propio (PMREM generado una vez): no toca
 *     scene.environment ni añade luces (una luz nueva recompilaría todos los materiales de la escena).
 *   - Render de la pantalla (solo mientras está encendida): oculta el grupo, renderiza `scene` con su cámara
 *     propia (pose de inicio) en un WebGLRenderTarget y restaura el render target previo (cara y mipmap
 *     incluidos) y renderer.autoClear. Las luces hijas de la cámara principal (la luz del jugador) acompañan a
 *     esa cámara durante ese render. El RT se libera (dispose) al terminar cada secuencia y se recrea solo.
 *   - Velo: <div> position:fixed, inset:0, pointer-events:none, z-index:45. Claro (#fff6de) al empezar el outro,
 *     donde continúa el destello de salida del juego; casi negro cuando la entrada se salta o corre sin apertura,
 *     para que el cambio de vista no sea brusco. Avanza con update(dt) (también después de cb, con isActive ya en
 *     false) y se elimina al apagarse.
 *   - prefers-reduced-motion: la animación corre 3x más rápido, el giro de llegada es corto y no hay apertura.
 */

// Paleta Amalfi: el teléfono en grafito azulado y el acento Sea Breeze.
const BRISA = 0x86c5ff; // Sea Breeze
const GRAFITO = 0x1a2338; // grafito azulado

// ---------- Teléfono (unidades de mundo, escala "héroe") ----------
const CUERPO_W = 4.0;
const CUERPO_H = 8.1;
const CUERPO_D = 0.42;
const CUERPO_R = 0.62; // radio de las esquinas de la silueta
const BISEL = 0.09; // canto redondeado del marco
const FRENTE_Z = CUERPO_D / 2; // plano de la tapa frontal del cuerpo
const CARA_W = CUERPO_W - 2 * BISEL; // tapa plana (frente y trasera) que deja el bisel
const CARA_H = CUERPO_H - 2 * BISEL;
const CARA_R = CUERPO_R - BISEL;
const PANTALLA_W = 3.6;
const PANTALLA_H = 7.6;
const PANTALLA_R = 0.42;
const PANTALLA_ASPECTO = PANTALLA_W / PANTALLA_H;
// Capas del frente: separadas lo justo para no pelear en el depth buffer ni a 50 u de distancia.
const Z_VIDRIO = FRENTE_Z + 0.004;
const Z_PANTALLA = FRENTE_Z + 0.008;
const Z_ISLA = FRENTE_Z + 0.012;
const HALO_MAX = 0.22; // opacidad del halo Sea Breeze trasero (aditivo, muy tenue)

// ---------- Escenario aislado del pasillo (x∈[-6.6, 6.6], z∈[-58, 6]) ----------
const CENTRO = new THREE.Vector3(0, 1.6, 55); // centro del teléfono en reposo (no se muta)
const Z_CARA = CENTRO.z + Z_PANTALLA; // z de la pantalla en reposo
const CAM_Z_INICIO = 80; // la cámara de la intro arranca aquí, mirando a -Z
const LLEGADA_DZ = -26; // el teléfono llega desde el fondo…
const LLEGADA_DY = -0.7; // …y un poco desde abajo
const GIRO_LLEGADA = -2.5 * Math.PI; // rotation.y inicial (termina en 0)
const GIRO_LLEGADA_REDUCIDO = -0.5 * Math.PI;

// ---------- Pose de inicio del jugador (donde deja la cámara la intro) ----------
const POSE_POS = new THREE.Vector3(0, 1.6, 2);
const POSE_QUAT = new THREE.Quaternion(); // identidad: mira hacia -Z (yaw 0, pitch 0)
const POSE_FOV = 70;

// ---------- Pantalla en vivo (render-to-texture) ----------
// En el cuadro más cercano la pantalla desborda la vista: así sus bordes y la isla quedan fuera de cuadro.
const SOBREPASO = 0.86;
// fov de la cámara de la pantalla (≈78°): con el sobrepaso, lo visible en el cuadro más cercano coincide con lo
// que ve la cámara principal (fov 70) tras el cruce cuando la vista es vertical (móvil); el corte no "salta".
const RT_FOV = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(POSE_FOV) / 2) / SOBREPASO));
const TAN_RT = Math.tan(THREE.MathUtils.degToRad(RT_FOV) / 2);
const RT_ALTO_MIN = 1140; // 540×1140 de base…
const RT_ALTO_MAX = 2048; // …y más en pantallas grandes, donde el cuadro final amplía la textura (ver ajustarRT)

// ---------- Encuadres: márgenes alrededor del cuerpo ----------
const MARGEN_INTRO = { w: 1.3, h: 1.22 };
const MARGEN_OUTRO = { w: 1.55, h: 1.4 };

// ---------- Líneas de tiempo (s). Con prefers-reduced-motion corren VELOCIDAD_REDUCIDA veces más rápido ----------
const INTRO = {
  llegada: 1.4, // 0 → 1.4: llega desde el fondo girando
  encendidoIni: 1.2, // 1.2 → 2.0: la pantalla se enciende (0 → 1.2 → 1)
  encendidoPico: 1.55,
  encendidoFin: 2.0,
  avanceIni: 2.0, // 2.0 → 3.8: la cámara avanza hasta que la pantalla llena la vista
  avanceFin: 3.8, // el cruce: el cuadro siguiente ya es adentro
};
const APERTURA = 1.0; // s, como máximo: tras el cruce en vistas horizontales, el fov se abre hasta 70
const OUTRO = {
  retrocesoIni: 0.1, // 0.1 → 2.7: la cámara sale de la pantalla y retrocede
  retrocesoFin: 2.7,
  apagadoIni: 1.4, // 1.4 → 2.8: la pantalla se apaga
  apagadoFin: 2.8,
  fin: 3.0, // llama a onDone
};
// El velo corre en tiempo real (no se acelera 3x: un parpadeo más corto sería más agresivo).
const DESTELLO = {
  outroPausa: 0.2, // el outro sostiene el blanco: tapa el retiro del destello de salida del juego (~150 ms)
  outroBaja: 0.5,
  saltoBaja: 0.2,
  entradaBaja: 0.35, // entrada saltada o sin apertura: fundido desde casi negro
  claro: '#fff6de',
  oscuro: '#071126', // el fondo del simulador
  z: 45,
};
const VELOCIDAD_REDUCIDA = 3;
const DESTELLO_REDUCIDO = 0.75;

// ---------- Utilidades de animación ----------
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = THREE.MathUtils.lerp;
const tramo = (t, a, b) => clamp01((t - a) / (b - a)); // progreso 0..1 de t dentro de [a, b]
const easeOutCubic = (k) => 1 - (1 - k) ** 3;
const easeOutQuad = (k) => 1 - (1 - k) * (1 - k);
const easeInOutCubic = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const easeInOutSine = (k) => -(Math.cos(Math.PI * k) - 1) / 2;
// Distancias en escala logarítmica: el tamaño aparente va como 1/d, así el zoom se percibe uniforme.
const lerpLog = (a, b, k) => a * (b / a) ** k;

/** Tangente del medio fov vertical efectivo de una PerspectiveCamera. */
function tanMedio(cam) {
  return Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / (cam.zoom || 1);
}

/** Distancia (desde el plano del rectángulo) a la que un rectángulo w×h entra COMPLETO en cuadro. */
function distanciaEncuadre(cam, w, h) {
  const tv = tanMedio(cam);
  const aspecto = cam.aspect > 0 ? cam.aspect : 1;
  return Math.max(h / 2 / tv, w / 2 / (tv * aspecto));
}

/** Distancia a la que un rectángulo w×h CUBRE toda la vista (alto y ancho: sirve en vertical y en horizontal). */
function distanciaCubrir(cam, w, h) {
  const tv = tanMedio(cam);
  const aspecto = cam.aspect > 0 ? cam.aspect : 1;
  return Math.min(h / 2 / tv, w / 2 / (tv * aspecto));
}

/**
 * Lo que muestra la pantalla en el encuadre más cercano de la intro, como fov vertical de la cámara de adentro.
 * En vistas verticales da 70 (el cruce no se nota); en horizontales, solo una franja de la pantalla llena la vista.
 */
function fovCruce(cam) {
  const dCerca = distanciaCubrir(cam, PANTALLA_W, PANTALLA_H) * SOBREPASO;
  const fraccion = Math.min(1, (2 * dCerca * tanMedio(cam)) / PANTALLA_H); // alto visible de la pantalla
  return THREE.MathUtils.radToDeg(2 * Math.atan(fraccion * TAN_RT));
}

/** Brillo de la pantalla durante el encendido: 0 → 1.2 (destello leve) → 1. */
function brilloEncendido(t) {
  if (t <= INTRO.encendidoIni) return 0;
  if (t < INTRO.encendidoPico) return 1.2 * easeOutQuad(tramo(t, INTRO.encendidoIni, INTRO.encendidoPico));
  return lerp(1.2, 1, easeInOutSine(tramo(t, INTRO.encendidoPico, INTRO.encendidoFin)));
}

const movimientoReducido = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createPhone({ scene, renderer }) {
  // ---------- Grupo raíz: posición (llegada). El pivote lleva el giro y la flotación; el halo no gira ----------
  const group = new THREE.Group();
  group.name = 'phone';
  group.visible = false;
  group.position.copy(CENTRO);
  scene.add(group);

  const pivote = new THREE.Group();
  pivote.name = 'phone-pivote';
  group.add(pivote);

  // ---------- Pantalla en vivo: render target vertical + cámara propia en la pose de inicio ----------
  const esTactil = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const rt = new THREE.WebGLRenderTarget(Math.round(RT_ALTO_MIN * PANTALLA_ASPECTO), RT_ALTO_MIN, {
    type: THREE.HalfFloatType, // lineal en media precisión: sin bandas en los tonos casi negros del pasillo
    generateMipmaps: true, // de lejos la pantalla se ve chica: los mipmaps evitan el parpadeo (y suavizan bordes)
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    anisotropy: Math.max(1, Math.min(8, renderer.capabilities.getMaxAnisotropy())),
    samples: esTactil ? 0 : 2,
  });
  rt.texture.name = 'phone-pantalla';

  const rtCam = new THREE.PerspectiveCamera(RT_FOV, PANTALLA_ASPECTO, 0.1, 200);
  rtCam.position.copy(POSE_POS);
  rtCam.quaternion.copy(POSE_QUAT);
  rtCam.updateMatrixWorld();

  // ---------- Materiales (fog:false: el teléfono se ve nítido aunque la escena tenga niebla) ----------
  const envMap = crearEstudio(renderer);
  const estandar = (params) => new THREE.MeshStandardMaterial({ envMap, fog: false, ...params });
  const matCuerpo = estandar({ color: GRAFITO, metalness: 0.6, roughness: 0.35 }); // grafito satinado
  const matVidrio = estandar({ color: 0x050507, metalness: 0, roughness: 0.1, envMapIntensity: 1.1 });
  const matTrasera = estandar({ color: 0x17181d, metalness: 0.25, roughness: 0.55, envMapIntensity: 0.9 }); // esmerilado
  const matModulo = estandar({ color: 0x1d1e24, metalness: 0.35, roughness: 0.3 });
  const matAro = estandar({ color: 0x2a2b33, metalness: 0.9, roughness: 0.25 });
  const matLente = estandar({ color: 0x030305, metalness: 0.1, roughness: 0.05, envMapIntensity: 1.4 });
  const matFlash = estandar({ color: 0xd9d5c9, metalness: 0, roughness: 0.4, envMapIntensity: 0.6 });
  const matNegro = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
  // La pantalla muestra el render target tal cual; material.color hace de "brillo" (0 = apagada).
  const matPantalla = new THREE.MeshBasicMaterial({ map: rt.texture, color: 0x000000, fog: false });

  // ---------- Cuerpo: losa de esquinas redondeadas con bisel ----------
  const prof = CUERPO_D - 2 * BISEL;
  const geoCuerpo = new THREE.ExtrudeGeometry(rectRedondeado(CARA_W, CARA_H, CARA_R), {
    depth: prof,
    bevelEnabled: true,
    bevelThickness: BISEL,
    bevelSize: BISEL, // el bisel crece hacia afuera: la silueta final mide CUERPO_W × CUERPO_H
    bevelSegments: 6,
    curveSegments: 20,
  });
  geoCuerpo.translate(0, 0, -prof / 2); // z ∈ [-CUERPO_D/2, CUERPO_D/2]
  suavizarNormales(geoCuerpo);
  pivote.add(new THREE.Mesh(geoCuerpo, matCuerpo));

  // ---------- Frente: vidrio negro, pantalla embutida e isla dinámica ----------
  const vidrio = new THREE.Mesh(new THREE.ShapeGeometry(rectRedondeado(CARA_W, CARA_H, CARA_R), 20), matVidrio);
  vidrio.position.z = Z_VIDRIO;
  pivote.add(vidrio);

  const pantalla = new THREE.Mesh(geometriaPantalla(PANTALLA_W, PANTALLA_H, PANTALLA_R), matPantalla);
  pantalla.name = 'phone-pantalla';
  pantalla.position.z = Z_PANTALLA;
  pivote.add(pantalla);

  const isla = new THREE.Mesh(new THREE.ShapeGeometry(rectRedondeado(0.98, 0.29, 0.145), 12), matNegro);
  isla.position.set(0, PANTALLA_H / 2 - 0.27, Z_ISLA);
  pivote.add(isla);

  // ---------- Botones laterales finos: encendido a la derecha; acción y volumen a la izquierda ----------
  const xLado = CUERPO_W / 2 + 0.004;
  for (const [lado, y, alto] of [
    [1, 1.75, 1.15],
    [-1, 2.6, 0.42],
    [-1, 1.75, 0.78],
    [-1, 0.82, 0.78],
  ]) {
    const boton = new THREE.Mesh(new RoundedBoxGeometry(0.07, alto, 0.15, 2, 0.03), matCuerpo);
    boton.position.set(lado * xLado, y, 0);
    pivote.add(boton);
  }

  // ---------- Trasera: vidrio esmerilado y módulo de cámaras con lentes ----------
  const trasera = new THREE.Mesh(new THREE.ShapeGeometry(rectRedondeado(CARA_W, CARA_H, CARA_R), 20), matTrasera);
  trasera.position.z = -Z_VIDRIO;
  trasera.rotation.y = Math.PI; // mira hacia -Z
  pivote.add(trasera);

  // Vista desde atrás, +X queda a la izquierda: el módulo aparece arriba a la izquierda, como en un teléfono real.
  const modX = CUERPO_W / 2 - 1.1;
  const modY = CUERPO_H / 2 - 1.1;
  const geoModulo = new THREE.ExtrudeGeometry(rectRedondeado(1.62, 1.62, 0.4), {
    depth: 0.04,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 3,
    curveSegments: 12,
  });
  suavizarNormales(geoModulo);
  const modulo = new THREE.Mesh(geoModulo, matModulo);
  modulo.rotation.y = Math.PI; // sobresale hacia -Z: z ∈ [-FRENTE_Z - 0.07, -FRENTE_Z + 0.03]
  modulo.position.set(modX, modY, -FRENTE_Z);
  pivote.add(modulo);

  const zModulo = -FRENTE_Z - 0.07; // cara trasera del módulo
  const geoAro = new THREE.CylinderGeometry(0.31, 0.31, 0.06, 40);
  const geoLente = new THREE.CylinderGeometry(0.24, 0.24, 0.07, 40);
  for (const [dx, dy] of [
    [-0.36, 0.36],
    [-0.36, -0.36],
    [0.38, 0],
  ]) {
    const aro = new THREE.Mesh(geoAro, matAro);
    aro.rotation.x = Math.PI / 2;
    aro.position.set(modX + dx, modY + dy, zModulo - 0.02);
    const lente = new THREE.Mesh(geoLente, matLente);
    lente.rotation.x = Math.PI / 2;
    lente.position.copy(aro.position); // sobresale 5 mm del aro: el vidrio negro queda dentro del anillo
    pivote.add(aro, lente);
  }
  const flashLed = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 24), matFlash);
  flashLed.rotation.x = Math.PI / 2;
  flashLed.position.set(modX + 0.4, modY + 0.52, zModulo - 0.01);
  const micro = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12), matNegro);
  micro.rotation.x = Math.PI / 2;
  micro.position.set(modX + 0.4, modY - 0.5, zModulo - 0.005);
  pivote.add(flashLed, micro);

  // ---------- Halo Sea Breeze muy tenue detrás: separa el teléfono oscuro del fondo oscuro ----------
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: crearTexturaHalo(),
      color: BRISA,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  halo.name = 'phone-halo';
  halo.scale.set(CUERPO_W * 3.4, CUERPO_H * 2, 1);
  halo.position.z = -1.6;
  group.add(halo);

  // Compila ya los shaders del teléfono (aunque esté oculto), con las luces actuales de la escena:
  // evita el tirón de compilación en el primer cuadro de la intro.
  renderer.compile(group, rtCam, scene);

  // ---------- Estado (encapsulado en el closure) ----------
  const destello = crearDestello();
  let estado = 'inactivo'; // 'inactivo' | 'intro' | 'apertura' | 'outro'
  let t = 0; // reloj de la línea de tiempo en curso (s); avanza solo con update(dt)
  let reducido = false; // prefers-reduced-motion
  let velocidad = 1; // VELOCIDAD_REDUCIDA con prefers-reduced-motion
  let escalaDestello = 1;
  let giroIni = GIRO_LLEGADA;
  let camara = null;
  let alTerminar = null;
  let cruceListo = false; // ya se mostró el encuadre más cercano: el próximo cuadro cruza
  let fovIni = POSE_FOV; // fov al empezar la apertura
  let duracionApertura = APERTURA;
  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpTam = new THREE.Vector2();

  // ---------- Render target a la medida de la vista ----------
  // En el cuadro más cercano solo se ve una parte de la pantalla, ampliada: en vistas horizontales (escritorio)
  // es una franja de ~1/4 del alto. Se elige el alto del RT para tolerar ~1.25x de ampliación, entre 1140 y 2048.
  function ajustarRT(cam) {
    const dCerca = distanciaCubrir(cam, PANTALLA_W, PANTALLA_H) * SOBREPASO;
    const fraccionVisible = Math.min(1, (2 * dCerca * tanMedio(cam)) / PANTALLA_H);
    const buffer = renderer.getDrawingBufferSize(tmpTam);
    const maxTex = renderer.capabilities.maxTextureSize || RT_ALTO_MAX;
    let alto = Math.ceil(((buffer.y / fraccionVisible) * 0.8) / 64) * 64;
    alto = Math.max(RT_ALTO_MIN, Math.min(alto, RT_ALTO_MAX, maxTex));
    rt.setSize(Math.round(alto * PANTALLA_ASPECTO), alto); // no hace nada si el tamaño no cambió
  }

  // ---------- Pantalla = el mundo en vivo ----------
  function renderizarPantalla(cam) {
    if (matPantalla.color.r <= 0.002) return; // apagada: no hace falta renderizar el mundo
    const destinoPrevio = renderer.getRenderTarget();
    const caraPrevia = renderer.getActiveCubeFace();
    const mipmapPrevio = renderer.getActiveMipmapLevel();
    const autoClearPrevio = renderer.autoClear;
    // Las luces hijas de la cámara principal (p. ej. la que acompaña al jugador) siguen a rtCam durante este
    // render: la pantalla se ilumina igual que el mundo tras el cruce. La pose se restaura enseguida.
    const conHijos = cam.children.some((o) => o.isLight);
    if (conHijos) {
      tmpPos.copy(cam.position);
      tmpQuat.copy(cam.quaternion);
      cam.position.copy(rtCam.position);
      cam.quaternion.copy(rtCam.quaternion);
    }
    group.visible = false; // fuera del render: la pantalla no puede muestrear el RT en el que se dibuja
    try {
      renderer.autoClear = true;
      renderer.setRenderTarget(rt);
      renderer.render(scene, rtCam);
    } finally {
      renderer.setRenderTarget(destinoPrevio, caraPrevia, mipmapPrevio);
      renderer.autoClear = autoClearPrevio;
      group.visible = true;
      if (conHijos) {
        cam.position.copy(tmpPos);
        cam.quaternion.copy(tmpQuat);
        cam.updateMatrixWorld(true);
      }
    }
  }

  // ---------- Poses (funciones puras del tiempo t: un tirón de frames no las rompe) ----------
  function poseIntro(cam, t) {
    // 1) Llega desde el fondo y desde abajo, girando (rotation.y: giroIni → 0) y enderezándose.
    const kLlegada = easeOutCubic(tramo(t, 0, INTRO.llegada));
    const resto = 1 - kLlegada;
    group.position.set(CENTRO.x, CENTRO.y + LLEGADA_DY * resto, CENTRO.z + LLEGADA_DZ * resto);
    pivote.rotation.set(0.22 * resto, giroIni * resto, 0.16 * resto);
    // Flotación suave que se apaga al empezar el avance: el encuadre cercano queda exacto y centrado.
    const amortigua = 1 - tramo(t, INTRO.avanceIni - 0.2, INTRO.avanceIni + 0.9);
    pivote.position.set(0, Math.sin(t * 2.6) * 0.035 * amortigua, 0);

    // 2) Encendido de la pantalla.
    const brillo = brilloEncendido(t);
    matPantalla.color.setScalar(brillo);
    halo.material.opacity = HALO_MAX * (0.55 * kLlegada + 0.45 * Math.min(1, brillo));

    // 3) Cámara: se acerca hasta encuadrar el teléfono y luego avanza hasta que la pantalla llena la vista.
    const dEncuadre = distanciaEncuadre(cam, CUERPO_W * MARGEN_INTRO.w, CUERPO_H * MARGEN_INTRO.h);
    const dCerca = distanciaCubrir(cam, PANTALLA_W, PANTALLA_H) * SOBREPASO;
    const d =
      t < INTRO.avanceIni
        ? lerpLog(CAM_Z_INICIO - Z_CARA, dEncuadre, easeInOutSine(t / INTRO.avanceIni))
        : lerpLog(dEncuadre, dCerca, easeInOutCubic(tramo(t, INTRO.avanceIni, INTRO.avanceFin)));
    cam.position.set(CENTRO.x, CENTRO.y, Z_CARA + d);
    cam.lookAt(group.position); // lo sigue mientras llega; en el avance mira derecho a -Z
  }

  function poseOutro(cam, t) {
    const k = easeOutCubic(tramo(t, OUTRO.retrocesoIni, OUTRO.retrocesoFin));
    group.position.copy(CENTRO);
    pivote.position.set(0, 0, 0);
    pivote.rotation.set(-0.05 * k, 0.3 * k, 0); // leve giro: se asoma el canto
    const dCerca = distanciaCubrir(cam, PANTALLA_W, PANTALLA_H) * SOBREPASO;
    const dLejos = distanciaEncuadre(cam, CUERPO_W * MARGEN_OUTRO.w, CUERPO_H * MARGEN_OUTRO.h);
    cam.position.set(CENTRO.x, CENTRO.y + 0.4 * k, Z_CARA + lerpLog(dCerca, dLejos, k));
    cam.lookAt(CENTRO);
    const apagado = easeInOutSine(tramo(t, OUTRO.apagadoIni, OUTRO.apagadoFin));
    matPantalla.color.setScalar(1 - apagado);
    halo.material.opacity = HALO_MAX * (1 - 0.3 * apagado);
  }

  /** Pose de inicio exacta: (0, 1.6, 2), cuaternión identidad (mira a -Z), fov 70. */
  function poseInicio(cam) {
    cam.position.copy(POSE_POS);
    cam.quaternion.copy(POSE_QUAT);
    cam.fov = POSE_FOV;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  // ---------- Inicio / fin de cada secuencia ----------
  function iniciar(tipo, cam, onDone) {
    if (estado !== 'inactivo') skip(); // cierra la secuencia anterior (su callback se llama igual)
    reducido = movimientoReducido();
    velocidad = reducido ? VELOCIDAD_REDUCIDA : 1;
    escalaDestello = reducido ? DESTELLO_REDUCIDO : 1;
    giroIni = reducido ? GIRO_LLEGADA_REDUCIDO : GIRO_LLEGADA;
    estado = tipo;
    t = 0;
    camara = cam;
    alTerminar = typeof onDone === 'function' ? onDone : null;
    cruceListo = false;
    // La pantalla recorta y filtra capas igual que la cámara principal.
    rtCam.near = cam.near;
    rtCam.far = cam.far;
    rtCam.layers.mask = cam.layers.mask;
    rtCam.updateProjectionMatrix();
    group.visible = true;
  }

  function playIntro(cam, onDone) {
    iniciar('intro', cam, onDone);
    cam.fov = POSE_FOV; // encuadra con fov 70 y no lo cambia: al terminar sigue en 70
    cam.updateProjectionMatrix();
    ajustarRT(cam);
    poseIntro(cam, 0);
  }

  function playOutro(cam, onDone) {
    iniciar('outro', cam, onDone);
    ajustarRT(cam); // el outro no toca el fov de la cámara
    poseOutro(cam, 0); // pantalla encendida y llenando la vista
    destello.fijar(1, DESTELLO.claro); // arranca en blanco: continúa el destello de salida del juego
    destello.bajar(DESTELLO.outroBaja * escalaDestello, DESTELLO.outroPausa);
    renderizarPantalla(cam); // el primer cuadro ya muestra el mundo
  }

  // El cruce: la cámara queda dentro del mundo. Sin destello: el cuadro anterior mostraba lo mismo.
  function corteIntro(saltado) {
    if (estado !== 'intro') return;
    const cam = camara;
    const fovPantalla = fovCruce(cam); // con el fov de la intro (70), antes de mover la cámara
    poseInicio(cam);
    group.visible = false;
    group.position.copy(CENTRO);
    pivote.position.set(0, 0, 0);
    pivote.rotation.set(0, 0, 0);
    matPantalla.color.setScalar(0);
    halo.material.opacity = 0;
    rt.dispose(); // libera la memoria de video durante el juego; el outro lo vuelve a crear solo
    const abre = POSE_FOV - fovPantalla > 0.5; // la vista es más ancha que lo que mostraba la pantalla
    if (abre && !saltado && !reducido) {
      // Apertura: el primer cuadro adentro repite el último de la pantalla y luego el fov se abre hasta 70.
      // Dura según cuánto se abre (en horizontal ~3.7x, el máximo): en vistas casi verticales es un instante.
      estado = 'apertura';
      t = 0;
      fovIni = fovPantalla;
      const razon = Math.tan(THREE.MathUtils.degToRad(POSE_FOV) / 2) / Math.tan(THREE.MathUtils.degToRad(fovIni) / 2);
      duracionApertura = APERTURA * Math.min(1, Math.max(0.25, Math.log(razon) / Math.log(3)));
      cam.fov = fovIni;
      cam.updateProjectionMatrix();
      return;
    }
    // Saltada o sin apertura (movimiento reducido), la vista cambia de golpe: entra con un fundido casi negro.
    if (saltado || abre) {
      destello.fijar(1, DESTELLO.oscuro);
      destello.bajar(DESTELLO.entradaBaja);
    }
    terminarIntro();
  }

  /** Apertura: el fov pasa de lo que mostraba la pantalla a 70, en escala logarítmica como las distancias. */
  function poseApertura(cam, t) {
    const k = easeInOutSine(tramo(t, 0, duracionApertura));
    const tanIni = Math.tan(THREE.MathUtils.degToRad(fovIni) / 2);
    const tanFin = Math.tan(THREE.MathUtils.degToRad(POSE_FOV) / 2);
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(lerpLog(tanIni, tanFin, k)));
    cam.updateProjectionMatrix();
  }

  function terminarIntro() {
    const cam = camara;
    const cb = alTerminar;
    estado = 'inactivo';
    camara = null;
    alTerminar = null;
    cam.fov = POSE_FOV;
    cam.updateProjectionMatrix();
    cb?.();
  }

  function finOutro(saltado) {
    if (estado !== 'outro') return;
    const cam = camara;
    const cb = alTerminar;
    poseOutro(cam, OUTRO.fin); // pose final exacta (también al saltar)
    matPantalla.color.setScalar(0);
    if (saltado) destello.bajar(DESTELLO.saltoBaja);
    estado = 'inactivo';
    camara = null;
    alTerminar = null;
    rt.dispose(); // la pantalla ya está apagada
    cb?.();
  }

  function skip() {
    if (estado === 'intro') corteIntro(true);
    else if (estado === 'apertura') terminarIntro();
    else if (estado === 'outro') finOutro(true);
  }

  // ---------- Cada frame ----------
  function update(dt) {
    dt = dt > 0 ? dt : 0; // también descarta NaN
    destello.update(dt); // el velo vive en tiempo real
    if (estado === 'inactivo') return;
    t += dt * velocidad;

    if (estado === 'intro') {
      if (cruceListo) {
        corteIntro(false);
        return;
      }
      poseIntro(camara, Math.min(t, INTRO.avanceFin));
      cruceListo = t >= INTRO.avanceFin; // este cuadro muestra el encuadre más cercano exacto
    } else if (estado === 'apertura') {
      poseApertura(camara, t);
      if (t >= duracionApertura) terminarIntro();
      return; // el teléfono ya no se ve: no hay pantalla que renderizar
    } else {
      poseOutro(camara, Math.min(t, OUTRO.fin));
      if (t >= OUTRO.fin) {
        finOutro(false);
        return;
      }
    }
    renderizarPantalla(camara);
  }

  return {
    group,
    playIntro,
    playOutro,
    update,
    skip,
    get isActive() {
      return estado !== 'inactivo';
    },
  };
}

// ---------------- Velo (DOM) ----------------

/**
 * Velo a pantalla completa, claro u oscuro. Avanza solo con update(dt) y se elimina del DOM al apagarse.
 * La opacidad mostrada es nivel²: baja rápido con una cola suave.
 */
function crearDestello() {
  let el = null;
  let nivel = 0; // 0..1, lineal en el tiempo
  let bajando = false;
  let ritmo = 1; // nivel por segundo
  let espera = 0; // segundos en su nivel antes de empezar a bajar

  const pintar = () => {
    if (el) el.style.opacity = String(nivel * nivel);
  };
  const quitar = () => {
    el?.remove();
    el = null;
    nivel = 0;
    bajando = false;
  };

  return {
    /** Fija el nivel al instante, con ese color (lo crea si hace falta), y lo deja quieto. */
    fijar(v, color) {
      if (!el) {
        el = document.createElement('div');
        el.setAttribute('aria-hidden', 'true');
        el.style.cssText =
          `position:fixed;inset:0;pointer-events:none;z-index:${DESTELLO.z};opacity:0;will-change:opacity`;
        document.body.appendChild(el);
      }
      el.style.background = color;
      nivel = clamp01(v);
      bajando = false;
      pintar();
    },
    /** Baja a 0 en `dur` s (tras `pausa` s en su nivel actual) y se elimina. */
    bajar(dur, pausa = 0) {
      if (!el) return;
      bajando = true;
      ritmo = 1 / Math.max(dur, 1e-3);
      espera = pausa;
    },
    update(dt) {
      if (!el || !bajando) return;
      if (espera > 0) {
        espera -= dt;
        return;
      }
      nivel = Math.max(0, nivel - dt * ritmo);
      if (nivel <= 0) quitar();
      else pintar();
    },
  };
}

// ---------------- Geometría ----------------

/** Rectángulo de esquinas redondeadas centrado en el origen (antihorario). */
function rectRedondeado(w, h, r) {
  const x = -w / 2;
  const y = -h / 2;
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** Pantalla plana de esquinas redondeadas con UV normalizadas 0..1 (muestra el render target completo). */
function geometriaPantalla(w, h, r) {
  const geo = new THREE.ShapeGeometry(rectRedondeado(w, h, r), 16);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv; // ShapeGeometry pone uv = (x, y) en unidades de mundo: se normalizan
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  uv.needsUpdate = true;
  return geo;
}

/**
 * Normales suaves para geometrías no indexadas (ExtrudeGeometry trae normales planas por cara y el bisel se
 * vería facetado): promedia por posición, ponderando por área. El perfil del bisel es tangente a la tapa y a
 * los costados, así que todo puede suavizarse sin ángulo de quiebre.
 */
function suavizarNormales(geo) {
  const pos = geo.attributes.position;
  const n = pos.count;
  const claves = new Array(n);
  for (let i = 0; i < n; i++) {
    claves[i] = `${Math.round(pos.getX(i) * 1e4)}|${Math.round(pos.getY(i) * 1e4)}|${Math.round(pos.getZ(i) * 1e4)}`;
  }
  const suma = new Map();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  for (let i = 0; i + 2 < n; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    c.sub(b).cross(ab.subVectors(a, b)); // normal de la cara × 2·área (mismo orden que computeVertexNormals)
    for (let k = i; k < i + 3; k++) {
      const acumulada = suma.get(claves[k]);
      if (acumulada) acumulada.add(c);
      else suma.set(claves[k], c.clone());
    }
  }
  const normales = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.copy(suma.get(claves[i])).normalize();
    normales[i * 3] = v.x;
    normales[i * 3 + 1] = v.y;
    normales[i * 3 + 2] = v.z;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(normales, 3));
}

// ---------------- Texturas ----------------

/**
 * Entorno de estudio para los reflejos del teléfono (PMREM, se genera una vez): fondo casi negro, un softbox
 * arriba al frente, un recorte blanco a la izquierda, una tira Sea Breeze a la derecha (el acento) y un rebote
 * tenue desde abajo. Se usa como material.envMap: no toca scene.environment ni añade luces a la escena.
 */
function crearEstudio(renderer) {
  const escena = new THREE.Scene();
  escena.background = new THREE.Color(0x060c1a);
  const geo = new THREE.PlaneGeometry(1, 1);
  const mats = [];
  const panel = (color, intensidad, w, h, x, y, z) => {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensidad),
      side: THREE.DoubleSide,
    });
    mats.push(mat);
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(w, h, 1);
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    escena.add(m);
  };
  panel(0xffffff, 1.8, 7, 3.5, -1.5, 6, 4.5); // softbox principal
  panel(0xffffff, 1.1, 1.4, 9, -7, 0.5, -1); // recorte izquierdo
  panel(BRISA, 1.0, 1.2, 9, 7, 0.5, -2); // acento Sea Breeze
  panel(0xb8bccc, 0.22, 12, 12, 0, -7, 2); // rebote del piso
  const pmrem = new THREE.PMREMGenerator(renderer);
  const textura = pmrem.fromScene(escena, 0.02).texture;
  pmrem.dispose();
  geo.dispose();
  for (const m of mats) m.dispose();
  return textura;
}

/** Degradado radial suave para el halo trasero (CanvasTexture en sRGB). */
function crearTexturaHalo() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  const radial = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  radial.addColorStop(0, 'rgba(255,255,255,1)');
  radial.addColorStop(0.45, 'rgba(255,255,255,0.32)');
  radial.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = radial;
  g.fillRect(0, 0, 128, 128);
  const textura = new THREE.CanvasTexture(canvas);
  textura.colorSpace = THREE.SRGBColorSpace;
  return textura;
}
