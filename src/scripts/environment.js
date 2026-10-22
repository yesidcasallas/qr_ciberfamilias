import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Ambientación del pasillo neón: cielo degradado, columnas, tiras de neón y partículas flotantes.
 *
 * API:  const env = createEnvironment({ scene })
 *   - Añade todo a `scene`, dentro de un THREE.Group llamado 'environment'.
 *   - env.update(dt, t) : cada frame, en segundos. Pulsa los neones, hace derivar las partículas
 *                         y mueve muy lento el tono de la banda del horizonte. Todo se calcula a
 *                         partir de `t` (sin estado acumulado), así que un tirón de frames no lo rompe.
 *   - env.group         : grupo raíz, por si se quiere ocultar (visible = false) o quitar.
 *
 * Integración:
 *   - Todos los materiales respetan la niebla (fog: true por defecto) menos el cielo, que la ignora.
 *     Pensado para scene.fog = new THREE.FogExp2(0x071126, 0.03).
 *   - El cielo pone su profundidad en el plano lejano (gl_Position.z = w): se ve aunque camera.far sea
 *     menor que su radio, siempre queda detrás de todo y no escribe profundidad.
 *   - Nada sólido dentro de x∈[-5.4, 5.4]; solo las partículas flotan en la zona caminable.
 *   - 5 draw calls en total: cielo, columnas, barras, tiras del piso y partículas.
 *
 * Ejemplo de uso (3 líneas):
 *   import { createEnvironment } from './environment.js';
 *   const env = createEnvironment({ scene });
 *   env.update(dt, t); // en el bucle existente, junto a world.update(dt, t)
 */

// Paleta del proyecto (Amalfi).
const BRISA = 0x86c5ff; // Sea Breeze
const AMALFI = 0x2e5aa7; // Amalfi Tile

// ---------- Cielo ----------
const CIELO_RADIO = 120;
const CIELO_Z = -17; // centro del pasillo
const CIELO_ABAJO = 0x071126;
const CIELO_MEDIO = 0x0c1a35; // azul noche
const CIELO_ARRIBA = 0x1d3566; // Amalfi apagado
const CIELO_BANDA = 0.04; // banda del horizonte apenas insinuada

// Estética minimalista: neones apagados (se pueden reactivar cambiando esta constante).
const NEON_VISIBLE = false;

// ---------- Columnas ----------
const COL_X = 6.2; // centro; la cara interior queda en x = ±5.95
const COL_Y = 2.6;
const COL_Z_INI = 2;
const COL_Z_FIN = -38;
const COL_PASO = 5;

// ---------- Neón ----------
// El bloom (threshold ≈ 0.62) solo deja pasar los píxeles cuya luminancia LINEAL supera el umbral; con
// EffectComposer el tone mapping lo aplica OutputPass al final, así que toneMapped:false no cambia eso.
// Luminancia lineal: Sea Breeze ≈ 0.522 y Amalfi ≈ 0.107. Sea Breeze ×1.67 da ≈ 0.87 (como el violeta ×2.6 de antes).
const BARRA_X = 5.93;
const BARRA_GROSOR = 0.04; // en x: ocupa [5.91, 5.95], justo detrás del plano de los anuncios (x = ±5.9), sin z-fighting
const BARRA_ALTO = 4.6;
const BARRA_ANCHO = 0.06; // en z
const BARRA_INTENSIDAD = 1.67; // lum ≈ 0.87
const BARRA_PULSO = 0.12; // ±12 % → lum ≈ [0.77, 0.98]: de cerca nunca baja del umbral (el bloom no parpadea)
const ONDA_W = 1.4; // rad/s
const ONDA_K = 0.3; // rad por unidad de z: la onda de brillo avanza hacia -Z a ≈ 4.7 u/s

const TIRA_X = 5.5;
const TIRA_Y = 0.02;
const TIRA_Z = -17;
const TIRA_LARGO = 44;
const TIRA_INTENSIDAD = 1.7; // lum ≈ 0.90
const TIRA_PULSO = 0.12;
const TIRA_W = 1.1; // rad/s

// ---------- Partículas ----------
const N_PART = 90; // pocas y tenues: atmósfera sin ruido visual
const VOL_X0 = -6;
const VOL_X1 = 6;
const VOL_Y0 = 0.2;
const VOL_Y1 = 5.2;
const VOL_Z0 = -40;
const VOL_Z1 = 4;
const DERIVA_X = 0.05; // velocidad máxima de deriva por eje (u/s)
const DERIVA_Y = 0.04;
const DERIVA_Z = 0.12;

export function createEnvironment({ scene }) {
  const group = new THREE.Group();
  group.name = 'environment';
  scene.add(group);

  // ---------- 1. Cielo: esfera invertida con degradado (ignora la niebla) ----------
  const cieloMat = new THREE.ShaderMaterial({
    uniforms: {
      uAbajo: { value: new THREE.Color(CIELO_ABAJO) },
      uMedio: { value: new THREE.Color(CIELO_MEDIO) },
      uArriba: { value: new THREE.Color(CIELO_ARRIBA) },
      uBrisa: { value: new THREE.Color(BRISA) },
      uAmalfi: { value: new THREE.Color(AMALFI) },
      uBanda: { value: CIELO_BANDA },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;

      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition; // vector de vista en espacio mundo (se normaliza en el fragment shader)
        gl_Position = projectionMatrix * viewMatrix * wp;
        gl_Position.z = gl_Position.w; // z = w: siempre en el plano lejano (camera.far no lo recorta y queda al fondo)
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uAbajo;
      uniform vec3 uMedio;
      uniform vec3 uArriba;
      uniform vec3 uBrisa;
      uniform vec3 uAmalfi;
      uniform float uBanda;
      uniform float uTime;
      varying vec3 vDir;

      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y; // -1 abajo, 0 horizonte, 1 arriba

        // Degradado vertical: abajo -> medio -> arriba (sin ramas).
        vec3 col = mix(uMedio, uAbajo, smoothstep(0.0, 0.5, -h));
        col = mix(col, uArriba, smoothstep(0.0, 0.85, h));

        // Banda tenue de brillo en el horizonte: centro fino + halo amplio.
        float banda = 0.75 * exp(-abs(h) * 18.0) + 0.25 * exp(-abs(h) * 5.0);
        // Tono Sea Breeze <-> Amalfi que cambia con el rumbo y deriva muy lento (sin atan: evita la singularidad de los polos).
        float k = 0.5 + 0.5 * sin(dir.x * 2.6 + dir.z * 1.7 + uTime * 0.07);
        col += mix(uBrisa, uAmalfi, k) * (banda * uBanda);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const cielo = new THREE.Mesh(new THREE.SphereGeometry(CIELO_RADIO, 32, 16), cieloMat);
  cielo.name = 'env-cielo';
  cielo.position.set(0, 0, CIELO_Z);
  cielo.frustumCulled = false;
  cielo.renderOrder = -1;
  group.add(cielo);

  // ---------- 2. Columnas + 3a. barras de neón (una por columna, en su cara interior) ----------
  const zs = [];
  for (let z = COL_Z_INI; z >= COL_Z_FIN; z -= COL_PASO) zs.push(z);
  const nCol = zs.length * 2; // ambos lados

  const columnas = new THREE.InstancedMesh(
    new RoundedBoxGeometry(0.5, 5.2, 0.5, 4, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x1a1b24, metalness: 0.15, roughness: 0.85 }), // mate, un tono sobre las paredes
    nCol,
  );
  columnas.name = 'env-columnas';

  const barras = new THREE.InstancedMesh(
    new THREE.BoxGeometry(BARRA_GROSOR, BARRA_ALTO, BARRA_ANCHO),
    // Color sobreexpuesto => supera el umbral de bloom. El pulso va en instanceColor, que multiplica a este color.
    new THREE.MeshBasicMaterial({ color: new THREE.Color(BRISA).multiplyScalar(BARRA_INTENSIDAD), toneMapped: false }),
    nCol,
  );
  barras.name = 'env-barras';

  const fasesBarra = new Float32Array(nCol);
  const m = new THREE.Matrix4();
  let i = 0;
  for (const z of zs) {
    for (const lado of [-1, 1]) {
      columnas.setMatrixAt(i, m.makeTranslation(lado * COL_X, COL_Y, z));
      barras.setMatrixAt(i, m.makeTranslation(lado * BARRA_X, COL_Y, z));
      fasesBarra[i] = z * ONDA_K; // mismo desfase a ambos lados: "anillos" de luz que recorren el pasillo
      i++;
    }
  }
  columnas.computeBoundingSphere();
  barras.computeBoundingSphere();
  group.add(columnas, barras);

  // ---------- 3b. Tiras de neón en el borde del piso (2 instancias, un draw call) ----------
  const tiraBase = new THREE.Color(AMALFI).multiplyScalar(TIRA_INTENSIDAD);
  const tiras = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.05, 0.03, TIRA_LARGO),
    new THREE.MeshBasicMaterial({ color: tiraBase, toneMapped: false }),
    2,
  );
  tiras.name = 'env-tiras-piso';
  tiras.setMatrixAt(0, m.makeTranslation(-TIRA_X, TIRA_Y, TIRA_Z));
  tiras.setMatrixAt(1, m.makeTranslation(TIRA_X, TIRA_Y, TIRA_Z));
  tiras.computeBoundingSphere();
  group.add(tiras);
  barras.visible = tiras.visible = NEON_VISIBLE;

  // Pulso de los neones: onda por instancia en las barras, pulso global en las tiras del piso.
  const tmpColor = new THREE.Color();
  const actualizarNeones = (t) => {
    for (let k = 0; k < nCol; k++) {
      tmpColor.setScalar(1 + BARRA_PULSO * Math.sin(t * ONDA_W + fasesBarra[k]));
      barras.setColorAt(k, tmpColor);
    }
    barras.instanceColor.needsUpdate = true;
    tiras.material.color.copy(tiraBase).multiplyScalar(1 + TIRA_PULSO * Math.sin(t * TIRA_W));
  };
  actualizarNeones(0); // crea instanceColor ANTES del primer render (así el shader compila con color por instancia)
  barras.instanceColor.setUsage(THREE.DynamicDrawUsage);

  // ---------- 4. Partículas flotantes (polvo neón) ----------
  const RX = VOL_X1 - VOL_X0;
  const RY = VOL_Y1 - VOL_Y0;
  const RZ = VOL_Z1 - VOL_Z0;

  // Por partícula: fase inicial de plegado (0..2) y velocidad en "rangos por segundo" en cada eje,
  // más amplitud, frecuencia y fase de su oscilación vertical.
  const ux = new Float32Array(N_PART);
  const uy = new Float32Array(N_PART);
  const uz = new Float32Array(N_PART);
  const vx = new Float32Array(N_PART);
  const vy = new Float32Array(N_PART);
  const vz = new Float32Array(N_PART);
  const amp = new Float32Array(N_PART);
  const frec = new Float32Array(N_PART);
  const fase = new Float32Array(N_PART);

  const posiciones = new Float32Array(N_PART * 3);
  const colores = new Float32Array(N_PART * 3);
  const brisa = new THREE.Color(BRISA);
  const blanco = new THREE.Color(1, 1, 1);
  const c = new THREE.Color();
  for (let p = 0; p < N_PART; p++) {
    amp[p] = THREE.MathUtils.randFloat(0.05, 0.2);
    frec[p] = THREE.MathUtils.randFloat(0.4, 1.1);
    fase[p] = Math.random() * Math.PI * 2;
    ux[p] = Math.random() * 2; // uniforme en [0, 2) => posición uniforme tras el plegado
    uy[p] = Math.random() * 2;
    uz[p] = Math.random() * 2;
    vx[p] = THREE.MathUtils.randFloatSpread(2 * DERIVA_X) / RX;
    vy[p] = THREE.MathUtils.randFloatSpread(2 * DERIVA_Y) / (RY - 2 * amp[p]);
    vz[p] = THREE.MathUtils.randFloatSpread(2 * DERIVA_Z) / RZ;
    // Blanco azulado tenue: ninguna partícula llega al umbral de bloom.
    c.copy(brisa).lerp(blanco, 0.45).multiplyScalar(0.16 + 0.22 * Math.random());
    c.toArray(colores, p * 3);
  }

  // Posición en función de t: deriva lenta "envuelta" con plegado (rebota en los bordes en vez de
  // teletransportarse, así nunca sale del volumen ni hay saltos) + oscilación vertical propia.
  // En y la base se pliega en [Y0 + amp, Y1 - amp] para que la oscilación tampoco se salga.
  const colocarParticulas = (t) => {
    for (let p = 0, j = 0; p < N_PART; p++, j += 3) {
      const a = amp[p];
      posiciones[j] = VOL_X0 + RX * plegar(ux[p] + vx[p] * t);
      posiciones[j + 1] = VOL_Y0 + a + (RY - 2 * a) * plegar(uy[p] + vy[p] * t) + a * Math.sin(t * frec[p] + fase[p]);
      posiciones[j + 2] = VOL_Z0 + RZ * plegar(uz[p] + vz[p] * t);
    }
  };
  colocarParticulas(0);

  const geoPart = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(posiciones, 3).setUsage(THREE.DynamicDrawUsage);
  geoPart.setAttribute('position', posAttr);
  geoPart.setAttribute('color', new THREE.BufferAttribute(colores, 3));
  // Esfera envolvente fija = todo el volumen (las partículas nunca salen de él): culling y orden correctos.
  geoPart.boundingSphere = new THREE.Box3(
    new THREE.Vector3(VOL_X0, VOL_Y0, VOL_Z0),
    new THREE.Vector3(VOL_X1, VOL_Y1, VOL_Z1),
  ).getBoundingSphere(new THREE.Sphere());

  const particulas = new THREE.Points(
    geoPart,
    new THREE.PointsMaterial({
      size: 0.06,
      sizeAttenuation: true,
      map: crearSpriteRedondo(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  particulas.name = 'env-particulas';
  group.add(particulas);

  // ---------- API ----------
  function update(dt, t) {
    // dt no se usa: todo se deriva de t, sin acumular estado.
    cieloMat.uniforms.uTime.value = t;
    if (NEON_VISIBLE) actualizarNeones(t);
    colocarParticulas(t);
    posAttr.needsUpdate = true;
  }

  return { update, group };
}

/** Onda triangular de periodo 2 con valores en [0, 1]: "pliega" una coordenada para que rebote en los bordes. */
function plegar(u) {
  const m = u - 2 * Math.floor(u * 0.5); // módulo positivo en [0, 2)
  return 1 - Math.abs(m - 1);
}

/** Sprite redondo y suave para las partículas (CanvasTexture en sRGB). */
function crearSpriteRedondo() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  const radial = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  radial.addColorStop(0, 'rgba(255,255,255,1)');
  radial.addColorStop(0.3, 'rgba(255,255,255,0.75)');
  radial.addColorStop(0.65, 'rgba(255,255,255,0.18)');
  radial.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = radial;
  g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
