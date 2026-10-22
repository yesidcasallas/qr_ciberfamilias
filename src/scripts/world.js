import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Paleta (strings para canvas, hex para three).
const C = {
  bg: '#071126', // noche Amalfi
  panel: '#0d1a33',
  accent: '#86c5ff', // Sea Breeze
  cyan: '#86c5ff',
  ok: '#34d399',
  bad: '#fb7185',
  amber: '#ffa62b', // Citrus Zest
  text: '#fff6de', // crema
  muted: 'rgba(255,246,222,0.62)',
};

const GATE_Z = -17;

/**
 * Construye el mundo dentro del teléfono y devuelve los elementos con los que
 * el jugador interactúa, los obstáculos, la barrera y la TV de salida.
 */
export function buildWorld(scene) {
  scene.background = new THREE.Color(C.bg);
  // Niebla exponencial del mismo color que la base del cielo: el fondo del pasillo se disuelve.
  scene.fog = new THREE.FogExp2(C.bg, 0.03);

  const root = new THREE.Group();
  scene.add(root);

  // ---------- Luces ----------
  // Iluminación sobria: luz fría de noche y el acento Sea Breeze.
  scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x07101f, 1.3));
  scene.add(new THREE.AmbientLight(0xffffff, 0.38));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(4, 10, 6);
  scene.add(dir);
  const spawnGlow = new THREE.PointLight(C.accent, 18, 20);
  spawnGlow.position.set(0, 3, -2);
  const glowA = new THREE.PointLight(C.accent, 22, 24);
  glowA.position.set(-3, 3, -14);
  const glowC = new THREE.PointLight(0xe8eef8, 18, 24);
  glowC.position.set(3, 3, -28);
  scene.add(spawnGlow, glowA, glowC);

  // ---------- Suelo y paredes: superficies mate, sin rejillas; sin techo (arriba se ve el cielo) ----------
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 64),
    new THREE.MeshStandardMaterial({ color: 0x172238, metalness: 0.2, roughness: 0.75 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -26;
  root.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x131d33, metalness: 0, roughness: 0.95, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(64, 6), wallMat);
    wall.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    wall.position.set(side * 6.6, 2.7, -26);
    root.add(wall);
  }

  // ---------- Registros ----------
  const interactables = [];
  const colliders = []; // obstáculos estáticos {x,z,r}
  const ticking = []; // funciones update(dt,t)

  const add = (record) => {
    for (const mesh of record.meshes) mesh.userData.interactable = record;
    record.enabled = record.enabled !== false;
    root.add(record.group);
    interactables.push(record);
    return record;
  };

  // ---------- Zona 1: anuncios‑cebo a los lados ----------
  const ads = [
    { z: -3, w: 2.4, h: 1.4, side: 1, title: '¡Ganaste un iPhone!', sub: 'Toca para reclamar',
      lesson: { tone: 'danger', kind: 'Publicidad‑cebo', title: 'Premios imposibles', body: 'Cuanto más increíble es el premio, más probable es el fraude. Si no participaste, no hay nada que reclamar.' } },
    { z: -6, w: 2.4, h: 1.4, side: -1, title: 'Tu equipo está infectado', sub: 'Limpiar ahora',
      lesson: { tone: 'danger', kind: 'Scareware', title: 'Falsas alertas de virus', body: 'Las alertas que te apuran a “limpiar ya” buscan asustarte para que instales algo. Un sitio web no puede escanear tu equipo así.' } },
    { z: -9, w: 2.2, h: 1.3, side: 1, title: 'Descarga gratis', sub: 'Instalador oficial',
      lesson: { tone: 'danger', kind: 'Software falso', title: 'Descargas “gratis”', body: 'Botones de descarga enormes suelen traer programas no deseados. Baja apps solo de la tienda o del sitio real.' } },
    { z: -12, w: 2.2, h: 1.3, side: -1, title: 'Alguien a 2 km quiere chatear', sub: 'Responder ahora',
      lesson: { tone: 'danger', kind: 'Cebo social', title: 'Anzuelos de citas', body: 'Perfiles “cercanos” que insisten en chatear fuera de la app suelen ser estafas (romance scam). Desconfía.' } },
  ];
  for (const ad of ads) {
    const group = new THREE.Group();
    // Tarjeta sobria: fondo azul noche, borde fino, una etiqueta Sea Breeze y texto crema.
    const screen = signMesh(ad.w, ad.h, (g, W, H) => {
      roundRect(g, 0, 0, W, H, 28);
      g.fillStyle = '#0d1830';
      g.fill();
      g.strokeStyle = 'rgba(255,246,222,0.14)';
      g.lineWidth = 3;
      g.stroke();
      g.textAlign = 'left';
      g.fillStyle = C.accent;
      g.font = '600 30px system-ui, sans-serif';
      g.fillText('ANUNCIO', 56, 76);
      g.fillStyle = C.text;
      g.font = '600 64px system-ui, sans-serif';
      wrapText(g, ad.title, 56, H * 0.46, W - 112, 72);
      g.fillStyle = C.muted;
      g.font = '500 38px system-ui, sans-serif';
      g.fillText(ad.sub, 56, H - 64);
    });
    group.add(screen);
    group.position.set(ad.side < 0 ? -5.9 : 5.9, 2.2, ad.z);
    group.rotation.y = ad.side < 0 ? Math.PI / 2 : -Math.PI / 2;
    const base = group.position.y;
    ticking.push((dt, t) => (group.position.y = base + Math.sin(t * 0.8 + ad.z) * 0.05));
    add({ id: `ad-${ad.z}`, kind: 'ad', group, meshes: [screen], prompt: 'Ver anuncio', lesson: ad.lesson });
  }

  // ---------- Zona 2: las 3 ventanas flotantes ----------
  const windowDefs = shuffle([
    {
      safe: false,
      url: 'feria-empleo-ti.net/login',
      title: 'Feria de empleo TI',
      sub: 'Inscríbete con tu correo y contraseña',
      cta: 'Entrar',
      lesson: { tone: 'danger', kind: 'Phishing de credenciales', title: 'Evento falso que pide tu contraseña',
        body: 'Ningún evento ni portal legítimo necesita tu contraseña para “inscribirte”. Pedirla es la señal: así roban tu cuenta.' },
    },
    {
      safe: false,
      url: 'vivo-premios.com/reclamar',
      title: 'Transmisión en vivo',
      sub: 'Reclama tu premio antes de que acabe',
      cta: 'Ver ahora',
      lesson: { tone: 'danger', kind: 'Cebo de premio', title: 'Premio que exige tus datos',
        body: 'Un premio inesperado que pide tus datos para “reclamarlo”, con un reloj en cuenta regresiva, es un anzuelo clásico.' },
    },
    {
      safe: true,
      url: 'registro.universidad.edu',
      title: 'Portal universidad',
      sub: 'Registro oficial de estudiantes',
      cta: 'Continuar',
      lesson: { tone: 'safe', kind: 'Camino seguro', title: 'Portal oficial .edu',
        body: 'Dominio institucional (.edu), sin premios ni urgencia, y no te pide contraseña. Este sí es de fiar: la barrera se abrirá.' },
    },
  ]);
  // Las tres ventanas comparten el mismo estilo neutro: solo el dominio y el texto delatan cuál es segura.
  const WINDOW_EMISSIVE = 0x24365c;
  const windowXs = [-3.7, 0, 3.7];
  windowDefs.forEach((def, i) => {
    const group = new THREE.Group();
    const live = liveSign(2.9, 2.0); // redibujable: el correo se escribe sobre la ventana
    live.draw((g, W, H) => drawWindow(g, W, H, def));
    const screen = live.mesh;
    const frame = new THREE.Mesh(
      new RoundedBoxGeometry(3.1, 2.2, 0.12, 3, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x111c33, emissive: WINDOW_EMISSIVE, emissiveIntensity: 0.25, metalness: 0.3, roughness: 0.6 }),
    );
    frame.position.z = -0.08;
    group.add(frame, screen);
    group.position.set(windowXs[i], 2.1, -14);
    const base = group.position.y;
    ticking.push((dt, t) => (group.position.y = base + Math.sin(t * 0.9 + i * 2) * 0.05));
    add({
      id: `win-${i}`,
      kind: 'window',
      group,
      meshes: [screen, frame],
      prompt: 'Abrir ventana',
      safe: def.safe,
      url: def.url,
      focus: { mesh: screen, w: 3.1, h: 2.2 }, // encuadre de cámara al escribir
      frame,
      baseEmissive: WINDOW_EMISSIVE,
      resolved: false,
      lesson: def.lesson,
      drawInput: (text, opts) => live.draw((g, W, H) => drawWindowInput(g, W, H, def, text, opts)),
      hitSubmit: (uv) => hitsButton(uv, screen.material.map.image), // tocar "Enviar"
      resetInput: () => live.draw((g, W, H) => drawWindow(g, W, H, def)),
      showConfirm: (email) => live.draw((g, W, H) => drawWindowConfirm(g, W, H, def, email)),
      showRobbed: (email, hint) => live.draw((g, W, H) => drawWindowRobbed(g, W, H, def, email, hint)),
    });
  });

  // ---------- Barrera (se abre al elegir la ventana segura) ----------
  // Velo Sea Breeze tenue, sin rejilla: se ve que hay un límite sin gritarlo.
  const gateMat = new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: 0.07, side: THREE.DoubleSide });
  const gate = new THREE.Mesh(new THREE.PlaneGeometry(11, 5), gateMat);
  gate.position.set(0, 2.5, GATE_Z);
  root.add(gate);
  const gateLabel = signMesh(4, 0.6, (g, W, H) => {
    g.fillStyle = 'rgba(134,197,255,0.88)';
    g.font = '500 36px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('Elige el portal seguro para continuar', W / 2, H * 0.66);
  });
  gateLabel.position.set(0, 3.6, GATE_Z + 0.05);
  root.add(gateLabel);

  const gateObj = {
    z: GATE_Z,
    isOpen: false,
    open() {
      if (this.isOpen) return;
      this.isOpen = true;
      ticking.push(fadeOut([gate, gateLabel], 0.6));
    },
  };

  // ---------- Zona 3: objetos de fraude ----------
  const fraudDefs = [
    { x: -3, z: -21, name: 'Grabadora', build: makeRecorder,
      lesson: { tone: 'danger', kind: 'Ingeniería social · vishing', title: 'La grabadora: llamadas que engañan',
        body: 'Fingen ser tu banco, soporte técnico o un jefe para que reveles claves o códigos. Cuelga y vuelve a llamar al número oficial.' } },
    { x: 3, z: -24, name: 'USB', build: makeUsb,
      lesson: { tone: 'danger', kind: 'Baiting', title: 'El USB “olvidado”',
        body: 'Un USB tentador puede instalar malware en cuanto lo conectas. Nunca enchufes dispositivos de origen desconocido.' } },
    { x: -3.2, z: -27, name: 'Código QR', build: makeQr,
      lesson: { tone: 'danger', kind: 'Quishing', title: 'Código QR falso',
        body: 'Un QR puede llevarte a una web que imita a la real. Revisa el enlace que muestra antes de abrirlo y desconfía de QR pegados encima de otros.' } },
    { x: 3.2, z: -30, name: 'Wi‑Fi gratis', build: makeRouter,
      lesson: { tone: 'danger', kind: 'Red gemela · evil twin', title: 'Wi‑Fi gratis falso',
        body: 'Una red abierta con nombre creíble puede espiar todo lo que envías. Evita entrar a tus cuentas o pagar conectado a Wi‑Fi público.' } },
    { x: -2.4, z: -29.5, name: 'Cargador', build: makeCharger,
      lesson: { tone: 'danger', kind: 'Juice jacking', title: 'Cargador público que roba datos',
        body: 'Los puertos USB públicos pueden copiar tu información. Usa tu propio cargador en el enchufe, o un cable solo‑carga.' } },
  ];
  for (const def of fraudDefs) {
    const group = new THREE.Group();
    group.position.set(def.x, 0, def.z);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.65, 0.9, 24),
      new THREE.MeshStandardMaterial({ color: 0x101a30, metalness: 0.5, roughness: 0.5, emissive: new THREE.Color(C.accent).multiplyScalar(0.08) }),
    );
    pedestal.position.y = 0.45;
    group.add(pedestal);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.58, 0.03, 10, 48),
      new THREE.MeshBasicMaterial({ color: C.accent }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.92;
    group.add(ring);

    const obj = def.build();
    obj.position.y = 1.5;
    group.add(obj);

    const label = signMesh(1.8, 0.5, (g, W, H) => {
      g.fillStyle = C.text;
      g.font = '600 42px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(def.name, W / 2, H * 0.72);
    });
    label.position.y = 2.35;
    group.add(label);

    const objMeshes = [];
    obj.traverse((m) => m.isMesh && objMeshes.push(m));
    ticking.push((dt, t) => {
      obj.rotation.y += dt * 0.6;
      obj.position.y = 1.5 + Math.sin(t * 1.4 + def.x) * 0.06;
      label.position.y = 2.35 + Math.sin(t * 1.4 + def.x) * 0.06;
    });
    colliders.push({ x: def.x, z: def.z, r: 0.95 });
    add({ id: `fraud-${def.name}`, kind: 'fraud', group, meshes: [...objMeshes, pedestal], prompt: `Examinar: ${def.name}`, lesson: def.lesson });
  }

  // ---------- Zona 4: la salida es una TV vieja, apagada, a un lado (no es obvia) ----------
  // Pantallas señuelo "sin señal" para que la verdadera no destaque.
  for (const dec of [
    { x: 4.2, z: -29, y: 2.2 },
    { x: 4.2, z: -35, y: 2.2 },
    { x: -4.2, z: -37, y: 2.2 },
  ]) {
    const group = new THREE.Group();
    const screen = signMesh(1.8, 1.2, (g, W, H) => drawStatic(g, W, H));
    group.add(screen);
    group.position.set(dec.x, dec.y, dec.z);
    group.rotation.y = dec.x < 0 ? Math.PI / 2 : -Math.PI / 2;
    add({ id: `decoy-${dec.z}`, kind: 'ad', group, meshes: [screen], prompt: 'Mirar pantalla',
      lesson: { tone: 'danger', kind: 'Señuelo', title: 'No toda pantalla es la salida',
        body: 'Hay pantallas por todos lados. La salida real no grita “gratis” ni “premio”: es discreta y pide solo tu universidad por el canal oficial.' } });
  }

  const tvGroup = new THREE.Group();
  tvGroup.position.set(-4, 0, -33);
  tvGroup.rotation.y = Math.PI / 2; // la pantalla mira al centro del pasillo
  const plastic = new THREE.MeshStandardMaterial({ color: 0x1b2233, metalness: 0.2, roughness: 0.75 });
  const crt = new THREE.Mesh(new RoundedBoxGeometry(2.2, 1.8, 1.7, 4, 0.1), plastic);
  crt.position.y = 1.5;
  tvGroup.add(crt);
  const legs = [];
  for (const sx of [-0.7, 0.7]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8), plastic);
    leg.position.set(sx, 0.3, 0.2);
    tvGroup.add(leg);
    legs.push(leg);
  }
  const offTex = signTexture(1024, 768, drawTvOff);
  const onTex = signTexture(1024, 768, drawTvOn);
  // La universidad se escribe sobre la pantalla encendida: se redibuja su canvas en vivo.
  const onCtx = onTex.canvas.getContext('2d');
  const paintOn = (fn) => {
    fn(onCtx, onTex.canvas.width, onTex.canvas.height);
    onTex.texture.needsUpdate = true;
  };
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.25), new THREE.MeshBasicMaterial({ map: offTex.texture, transparent: true }));
  tvScreen.position.set(0, 1.55, 0.861);
  tvGroup.add(tvScreen);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff5555 }));
  led.position.set(0.72, 0.78, 0.86);
  tvGroup.add(led);
  let activeLed = led; // si llega el modelo de Blender, se usa su propio PowerLED
  const tvLight = new THREE.PointLight(C.ok, 0, 10); // apagada hasta encender
  tvLight.position.set(0, 1.55, 1.3);
  tvGroup.add(tvLight);
  root.add(tvGroup);
  colliders.push({ x: -4, z: -33, r: 1.3 });
  const tv = add({
    id: 'tv',
    kind: 'tv',
    group: tvGroup,
    meshes: [tvScreen, crt],
    prompt: 'Revisar la pantalla',
    enabled: true,
    screen: tvScreen,
    focus: { mesh: tvScreen, w: 2.1, h: 1.7 }, // encuadre de cámara al escribir
    revealed: false,
    turnOn() {
      tvScreen.material.map = onTex.texture;
      tvScreen.material.needsUpdate = true;
      tvLight.intensity = 16;
      activeLed.material.color.set(0x34d399);
      activeLed.material.emissive?.set(0x34d399);
      this.revealed = true;
    },
    drawInput: (text, opts) => paintOn((g, W, H) => drawTvInput(g, W, H, text, opts)),
    resetInput: () => paintOn(drawTvOn),
    showConfirm: (text) => paintOn((g, W, H) => drawTvConfirm(g, W, H, text)),
    /** Sustituye el cuerpo procedural por un modelo glTF (hecho en Blender) con un nodo "Screen". */
    useModel(model) {
      crt.visible = false;
      for (const leg of legs) leg.visible = false;
      tvGroup.add(model);
      let glbScreen = model.getObjectByName('Screen');
      if (glbScreen && !glbScreen.isMesh) glbScreen = glbScreen.getObjectByProperty('isMesh', true);
      if (glbScreen) {
        // las UV de glTF tienen la V invertida: las texturas de canvas necesitan flipY=false
        for (const t of [offTex.texture, onTex.texture]) {
          t.flipY = false;
          t.needsUpdate = true;
        }
        glbScreen.material = tvScreen.material; // comparte el material: turnOn() lo enciende
        tvScreen.visible = false;
        this.screen = glbScreen;
        this.focus.mesh = glbScreen;
      }
      const glbLed = model.getObjectByName('PowerLED');
      if (glbLed?.isMesh) {
        glbLed.material = glbLed.material.clone(); // propio: cambia a verde al encender
        led.visible = false;
        activeLed = glbLed;
      }
      // Tonos oscuros y apagados: encaja con la estética minimalista y no delata la salida.
      model.traverse((o) => {
        if (!o.isMesh || o === glbScreen || o === glbLed) return;
        for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!mat.color) continue;
          const hsl = {};
          mat.color.getHSL(hsl);
          mat.color.setHSL(hsl.h, hsl.s * 0.25, Math.min(hsl.l, 0.22));
        }
      });
      const meshes = [];
      model.traverse((o) => o.isMesh && meshes.push(o));
      for (const m of meshes) m.userData.interactable = this;
      this.meshes = meshes;
    },
  });

  return {
    interactables,
    colliders,
    gate: gateObj,
    tv,
    root,
    addInteractable: add,
    bounds: { minX: -5.3, maxX: 5.3, minZ: -37, maxZ: 3 },
    spawn: { x: 0, z: 2, yaw: 0 },
    targets() {
      const out = [];
      for (const r of interactables) if (r.enabled) out.push(...r.meshes);
      return out;
    },
    update(dt, t) {
      for (const fn of ticking) fn(dt, t);
    },
  };
}

// ---------------- Dibujo de pantallas ----------------

// Base de ventana neutra: el único dato que distingue la oficial es la barra de dirección.
function drawWindowChrome(g, W, H, def) {
  roundRect(g, 0, 0, W, H, 28);
  g.fillStyle = '#0d1830';
  g.fill();
  g.strokeStyle = 'rgba(255,246,222,0.12)';
  g.lineWidth = 3;
  g.stroke();
  roundRect(g, 40, 34, W - 80, 72, 36);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  g.fill();
  g.textAlign = 'left';
  g.fillStyle = C.muted;
  g.font = '500 34px ui-monospace, Menlo, Consolas, monospace';
  g.fillText(def.url, 76, 82);
}

// En reposo la ventana ya parece un formulario: se toca su campo para escribir el correo.
function drawWindow(g, W, H, def) {
  drawWindowChrome(g, W, H, def);
  g.textAlign = 'center';
  g.fillStyle = C.text;
  g.font = '600 56px system-ui, sans-serif';
  g.fillText(def.title, W / 2, H * 0.3);
  drawInputBox(g, 90, H * 0.4, W - 180, 96, '', 'tu@correo.com', false, false, false);
  g.textAlign = 'center';
  g.fillStyle = C.muted;
  g.font = '500 32px system-ui, sans-serif';
  g.fillText(fitText(g, def.sub, W - 160), W / 2, H * 0.4 + 96 + 62);
  outlinedButton(g, W, H, def.cta);
}

// La ventana pide el correo: lo que se teclea aparece aquí, con cursor parpadeante.
function drawWindowInput(g, W, H, def, text, { caret, error, hint } = {}) {
  drawWindowChrome(g, W, H, def);
  g.textAlign = 'center';
  g.fillStyle = C.text;
  g.font = '600 56px system-ui, sans-serif';
  g.fillText(def.title, W / 2, H * 0.3);
  drawInputBox(g, 90, H * 0.4, W - 180, 96, text, 'tu@correo.com', caret, error);
  g.textAlign = 'center';
  g.font = '500 32px system-ui, sans-serif';
  g.fillStyle = error ? C.bad : C.muted;
  g.fillText(error || hint || 'Enter para enviar · Esc para cancelar', W / 2, H * 0.4 + 96 + 62);
  outlinedButton(g, W, H, 'Enviar');
}

// Portal oficial: el correo queda registrado y la ventana explica por qué era de fiar.
function drawWindowConfirm(g, W, H, def, email) {
  drawWindowChrome(g, W, H, def);
  g.textAlign = 'center';
  g.fillStyle = C.ok;
  g.font = '600 56px system-ui, sans-serif';
  g.fillText('Correo registrado', W / 2, H * 0.3);
  g.fillStyle = C.text;
  g.font = '500 36px system-ui, sans-serif';
  g.fillText(fitText(g, email, W - 160), W / 2, H * 0.4);
  g.fillStyle = C.muted;
  g.font = '500 32px system-ui, sans-serif';
  wrapText(g, def.lesson.body, W / 2, H * 0.62, W - 160, 42);
  g.fillStyle = C.accent;
  g.font = '500 30px system-ui, sans-serif';
  g.fillText('La barrera se abrirá', W / 2, H - 64);
}

// Sitio falso: la ventana muestra qué pasó con el correo que escribiste.
function drawWindowRobbed(g, W, H, def, email, hint) {
  drawWindowChrome(g, W, H, def);
  g.textAlign = 'center';
  g.fillStyle = C.bad;
  g.font = '600 56px system-ui, sans-serif';
  g.fillText('Te robaron tus datos', W / 2, H * 0.28);
  g.fillStyle = C.text;
  g.font = '500 34px system-ui, sans-serif';
  g.fillText(fitText(g, `Le diste «${email}» a este sitio`, W - 140), W / 2, H * 0.38);
  g.fillStyle = C.muted;
  g.font = '500 31px system-ui, sans-serif';
  wrapText(g, def.lesson.body, W / 2, H * 0.6, W - 150, 41);
  g.fillStyle = C.accent;
  g.font = '600 32px system-ui, sans-serif';
  g.fillText(hint, W / 2, H - 60);
}

// Botón de las ventanas, en px del canvas: abajo al centro (también se puede tocar).
const BUTTON = { w: 340, h: 88, bottom: 146 };

function outlinedButton(g, W, H, label) {
  roundRect(g, (W - BUTTON.w) / 2, H - BUTTON.bottom, BUTTON.w, BUTTON.h, 44);
  g.strokeStyle = 'rgba(255,246,222,0.7)';
  g.lineWidth = 3;
  g.stroke();
  g.textAlign = 'center';
  g.fillStyle = C.text;
  g.font = '600 40px system-ui, sans-serif';
  g.fillText(label, W / 2, H - BUTTON.bottom + 58);
}

/** ¿Un punto del plano (su uv) cae sobre el botón? Con margen para el dedo. */
function hitsButton(uv, { width: W, height: H }, margin = 24) {
  const x = uv.x * W;
  const y = (1 - uv.y) * H; // el canvas crece hacia abajo; el uv, hacia arriba
  return (
    Math.abs(x - W / 2) <= BUTTON.w / 2 + margin &&
    y >= H - BUTTON.bottom - margin &&
    y <= H - BUTTON.bottom + BUTTON.h + margin
  );
}

/** Campo de texto dibujado en canvas: texto (o placeholder), cursor y borde (activo, en reposo o error). */
function drawInputBox(g, x, y, w, h, text, placeholder, caret, error, active = true) {
  roundRect(g, x, y, w, h, 18);
  g.fillStyle = 'rgba(255,255,255,0.04)';
  g.fill();
  g.strokeStyle = error ? C.bad : active ? C.accent : 'rgba(255,246,222,0.45)';
  g.lineWidth = 3;
  g.stroke();
  g.textAlign = 'left';
  g.font = '500 42px system-ui, sans-serif';
  const pad = 28;
  const shown = text ? fitTail(g, text, w - pad * 2 - 12) : '';
  g.fillStyle = text ? C.text : 'rgba(255,246,222,0.58)';
  g.fillText(text ? shown : placeholder, x + pad, y + h / 2 + 15);
  if (caret) {
    const cx = x + pad + (text ? g.measureText(shown).width : 0) + 4;
    g.fillStyle = C.text;
    g.fillRect(cx, y + 22, 3, h - 44);
  }
}

/** Si el texto no cabe, muestra su final (como un input real al escribir). */
function fitTail(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`…${s}`).width > maxW) s = s.slice(1);
  return `…${s}`;
}

/** Si el texto no cabe, recorta su final con puntos suspensivos. */
function fitText(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

// TV apagada: casi negra, con reflejo tenue y líneas de barrido. No delata que es la salida.
function drawTvOff(g, W, H) {
  g.fillStyle = '#0a0b0e';
  g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, 'rgba(255,255,255,0.05)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 2);
  g.textAlign = 'left';
  g.fillStyle = 'rgba(255,246,222,0.25)';
  g.font = '500 30px system-ui, sans-serif';
  g.fillText('AV · 1', 36, H - 36);
}

// Base de la TV encendida: registro discreto por el canal oficial (sin promesas ni urgencia).
function drawTvBase(g, W, H) {
  g.fillStyle = '#0b1016';
  g.fillRect(0, 0, W, H);
  const grad = g.createRadialGradient(W / 2, H * 0.42, 10, W / 2, H * 0.42, W * 0.55);
  grad.addColorStop(0, 'rgba(52,211,153,0.16)');
  grad.addColorStop(1, 'rgba(11,16,22,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.textAlign = 'center';
  g.fillStyle = C.ok;
  g.font = '600 40px system-ui, sans-serif';
  g.fillText('registro.universidad.edu', W / 2, H * 0.22);
  g.fillStyle = C.text;
  g.font = '500 48px system-ui, sans-serif';
  g.fillText('¿A qué universidad perteneces?', W / 2, H * 0.38);
}

function drawTvOn(g, W, H) {
  drawTvBase(g, W, H);
  drawInputBox(g, W * 0.12, H * 0.5, W * 0.76, 100, '', 'tu universidad', false, false, false);
}

// La universidad se escribe sobre la pantalla de la TV, con cursor parpadeante.
function drawTvInput(g, W, H, text, { caret, error, hint } = {}) {
  drawTvBase(g, W, H);
  drawInputBox(g, W * 0.12, H * 0.5, W * 0.76, 100, text, 'tu universidad', caret, error);
  g.textAlign = 'center';
  g.font = '500 32px system-ui, sans-serif';
  g.fillStyle = error ? C.bad : C.muted;
  g.fillText(error || hint || 'Enter para salir del teléfono', W / 2, H * 0.5 + 100 + 66);
}

function drawTvConfirm(g, W, H, text) {
  drawTvBase(g, W, H);
  g.textAlign = 'center';
  g.fillStyle = C.ok;
  g.font = '600 52px system-ui, sans-serif';
  g.fillText('Registrando…', W / 2, H * 0.58);
  g.fillStyle = C.muted;
  g.font = '500 36px system-ui, sans-serif';
  g.fillText(fitText(g, text, W - 160), W / 2, H * 0.7);
}

// Pantalla señuelo "sin señal": oscura y sobria.
function drawStatic(g, W, H) {
  roundRect(g, 0, 0, W, H, 24);
  g.fillStyle = '#0c1428';
  g.fill();
  g.strokeStyle = 'rgba(255,246,222,0.1)';
  g.lineWidth = 3;
  g.stroke();
  g.textAlign = 'center';
  g.fillStyle = 'rgba(255,246,222,0.6)';
  g.font = '500 48px system-ui, sans-serif';
  g.fillText('Sin señal', W / 2, H * 0.55);
}

// ---------------- Objetos de fraude (low‑poly) ----------------

function mat(color, emissive = 0x000000, e = 0) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.45, emissive, emissiveIntensity: e });
}

function makeRecorder() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.55, 0.2, 3, 0.05), mat(0x34466e, C.accent, 0.2));
  g.add(body);
  for (const x of [-0.18, 0.18]) {
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 20), mat(0x101018));
    reel.rotation.x = Math.PI / 2;
    reel.position.set(x, 0.08, 0.11);
    g.add(reel);
  }
  const mic = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), mat(0x9aa, C.accent, 0.4));
  mic.position.set(0, -0.16, 0.12);
  g.add(mic);
  return g;
}

function makeUsb() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.7, 0.14, 3, 0.04), mat(0x1f2430, C.accent, 0.2));
  g.add(body);
  const metal = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.08), new THREE.MeshStandardMaterial({ color: 0xcfd6e6, metalness: 0.95, roughness: 0.2 }));
  metal.position.y = 0.44;
  g.add(metal);
  return g;
}

function makeQr() {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.72, 0.08, 3, 0.03), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
  g.add(plate);
  const tex = qrTexture();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.58), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.z = 0.045;
  g.add(face);
  return g;
}

function makeRouter() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.28, 0.5, 3, 0.06), mat(0x15181f, C.accent, 0.25));
  g.add(body);
  for (const x of [-0.28, 0.28]) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 10), mat(0x0c0e14));
    ant.position.set(x, 0.38, -0.12);
    ant.rotation.z = x < 0 ? 0.25 : -0.25;
    g.add(ant);
  }
  for (let i = 0; i < 3; i++) {
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: C.accent }));
    led.position.set(-0.2 + i * 0.12, 0.05, 0.26);
    g.add(led);
  }
  return g;
}

function makeCharger() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.5, 0.3, 3, 0.06), mat(0xe8ebf2, C.accent, 0.1));
  g.add(body);
  for (const x of [-0.1, 0.1]) {
    const prong = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.05), new THREE.MeshStandardMaterial({ color: 0xcfd6e6, metalness: 0.9, roughness: 0.3 }));
    prong.position.set(x, 0.33, 0);
    g.add(prong);
  }
  return g;
}

// ---------------- Texturas ----------------

function qrTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#000';
  const n = 12;
  const s = 128 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (Math.random() > 0.5) g.fillRect(x * s, y * s, s, s);
  // esquinas de posición
  for (const [ox, oy] of [[0, 0], [n - 3, 0], [0, n - 3]]) {
    g.fillStyle = '#000';
    g.fillRect(ox * s, oy * s, s * 3, s * 3);
    g.fillStyle = '#fff';
    g.fillRect((ox + 0.5) * s, (oy + 0.5) * s, s * 2, s * 2);
    g.fillStyle = '#000';
    g.fillRect((ox + 1) * s, (oy + 1) * s, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** Textura de canvas lista para usar como mapa. */
function signTexture(W, H, draw) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  draw(g, W, H);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return { canvas: c, texture };
}

/** Plano con canvas redibujable (para escribir texto en vivo sobre una pantalla). */
export function liveSign(worldW, worldH) {
  const W = 1024;
  const H = Math.round((W * worldH) / worldW);
  const { canvas, texture } = signTexture(W, H, () => {});
  const g = canvas.getContext('2d');
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH), new THREE.MeshBasicMaterial({ map: texture, transparent: true }));
  return {
    mesh,
    draw(fn) {
      g.clearRect(0, 0, W, H);
      fn(g, W, H);
      texture.needsUpdate = true;
    },
  };
}

/** Plano con textura de canvas (1024 px de ancho) que glow sin luces. */
function signMesh(worldW, worldH, draw) {
  const W = 1024;
  const H = Math.round((W * worldH) / worldW);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  draw(g, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(worldW, worldH),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
  );
  return mesh;
}

// ---------------- Utilidades ----------------

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function wrapText(g, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  lines.push(line);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => g.fillText(l, x, startY + i * lineHeight));
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Devuelve una función update que desvanece y oculta meshes en `dur` segundos. */
function fadeOut(meshes, dur) {
  let e = 0;
  const start = meshes.map((m) => m.material.opacity);
  return (dt) => {
    e += dt;
    const k = Math.min(1, e / dur);
    meshes.forEach((m, i) => {
      m.material.opacity = start[i] * (1 - k);
      if (k >= 1) m.visible = false;
    });
    return k >= 1; // listo
  };
}
