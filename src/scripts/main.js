import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildWorld } from './world.js';
import { createPlayer } from './player.js';
import { createGame } from './game.js';
import { createAudio } from './audio.js';
import { createPortal } from './portal.js';
import { createEnvironment } from './environment.js';
import { createEnding } from './ending.js';
import { createPhone } from './phone.js';
import { createScammer } from './scammer.js';
import { saveResponse } from './registro.js';

const $ = (id) => document.getElementById(id);

const ICON_SOUND =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const ICON_MUTED =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m16 9 5 6"/><path d="m21 9-5 6"/></svg>';

const el = {
  loader: $('loader'),
  intro: $('intro'),
  enter: $('enter'),
  hud: $('hud'),
  objectiveText: $('objective-text'),
  prompt: $('prompt'),
  pad: $('pad'),
  stick: $('stick'),
  mute: $('mute'),
  hint: $('hint'),
  typer: $('typer'),
  consent: $('consent'), // solo existe si el sitio guarda respuestas (Supabase configurado)
};

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch {
  renderer = null;
}

if (!renderer) {
  document.documentElement.classList.add('no-webgl');
  el.loader.classList.add('hide');
  el.intro.hidden = false;
  el.enter.disabled = true;
  el.enter.textContent = 'WebGL no disponible';
} else {
  start(renderer);
}

function start(renderer) {
  const isTouch =
    matchMedia('(pointer: coarse)').matches ||
    navigator.maxTouchPoints > 0 ||
    new URLSearchParams(location.search).has('touch');
  if (isTouch) document.body.classList.add('touch');
  const lowPerf = isTouch;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPerf ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  $('stage').appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
  // Luz de acento que acompaña al jugador: ilumina lo cercano al caminar.
  scene.add(camera);
  const playerGlow = new THREE.PointLight(0xdcdcf0, 6, 9, 2);
  playerGlow.position.set(0, 0.3, 0.6);
  camera.add(playerGlow);

  const world = buildWorld(scene);
  // Reflejos suaves de entorno: los metales (perillas de la TV) dejan de verse grises y planos.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.25;
  pmrem.dispose();
  const audio = createAudio();
  const portal = createPortal({ scene });
  const env = createEnvironment({ scene });
  const ending = createEnding({ scene, camera, audio });
  // El teléfono que te lleva al mundo de adentro (y del que sales al final). Va después de
  // buildWorld para que su precompilación vea las luces finales.
  const phone = createPhone({ scene, renderer });

  // ---------- Bloom (brillo neón) ----------
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      type: THREE.HalfFloatType,
      samples: lowPerf ? 0 : 2,
    }),
  );
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    lowPerf ? 0.26 : 0.32, // strength: brillo sutil
    0.35, // radius: halo corto y limpio
    1.0, // threshold: solo brilla lo emisivo HDR (ojos, portal); textos y tarjetas quedan nítidos
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const player = createPlayer({
    camera,
    canvas,
    world,
    audio,
    hud: { prompt: el.prompt, pad: el.pad, stick: el.stick },
    onInteract: (record, hit) => game.onInteract(record, hit),
  });

  // Final: la cámara sale del teléfono y su pantalla muestra los créditos del Proyecto CiberFamilias.
  const finish = (info) => {
    audio.stopVoice(); // el estafador se queda dentro del teléfono
    // con autorización: el correo (del portal oficial) y la universidad se guardan en Supabase
    if (el.consent?.checked) {
      saveResponse({
        origen: 'simulador',
        correo: info.email,
        universidad: info.university,
        senuelos: info.fell,
        resistio: info.resisted,
      });
    }
    phone.playOutro(camera, () => {
      // en los créditos solo queda el teléfono en el vacío: se oculta el pasillo lejano
      world.root.visible = false;
      for (const name of ['env-columnas', 'env-barras', 'env-tiras-piso', 'env-particulas']) {
        const obj = env.group.getObjectByName(name);
        if (obj) obj.visible = false;
      }
      ending.play({ screen: phone.group.getObjectByName('phone-pantalla'), data: info }, () => location.reload());
    });
  };
  const game = createGame({ world, player, camera, audio, portal, onFinished: finish, hud: { hud: el.hud, dom: el } });

  if (import.meta.env.DEV) window.__sim = { world, player, game, camera, audio };

  // ---------- Modelos glTF: robot guía, TV retro y estafador (estos dos hechos en Blender) ----------
  const loader = new GLTFLoader();
  const mixers = [];

  // TV retro: reemplaza el cuerpo procedural y conserva la pantalla interactiva.
  loader.load('/models/tv_retro.glb', (gltf) => world.tv.useModel(gltf.scene), undefined, () => {});

  // Estafador (Blender): te sigue y aplica ingeniería social según lo que estés haciendo.
  let scammer = null;
  loader.load(
    '/models/estafador.glb',
    (gltf) => {
      scammer = createScammer({ gltf, world, player, camera, audio, game, hud: el.hud });
      mixers.push(scammer.mixer);
    },
    undefined,
    () => {},
  );

  // Robot guía (modelo de los ejemplos de three.js)
  loader.load('/models/RobotExpressive.glb', (gltf) => {
    const robot = gltf.scene;
    robot.scale.setScalar(0.4);
    robot.position.set(3.4, 0, -4.5);
    robot.rotation.y = -0.8; // mira hacia el jugador
    // Paleta minimalista: el naranja original pasa a gris claro con un matiz violeta.
    robot.traverse((o) => {
      if (!o.isMesh) return;
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!mat.color) continue;
        const hsl = {};
        mat.color.getHSL(hsl);
        mat.color.setHSL(0.72, 0.12, hsl.l);
      }
    });
    const mixer = new THREE.AnimationMixer(robot);
    mixers.push(mixer);
    const clip = THREE.AnimationClip.findByName(gltf.animations, 'Idle') || gltf.animations[0];
    if (clip) mixer.clipAction(clip).play();
    const meshes = [];
    robot.traverse((o) => o.isMesh && meshes.push(o));
    const group = new THREE.Group();
    group.add(robot);
    world.addInteractable({
      id: 'guide',
      kind: 'guide',
      group,
      meshes,
      prompt: 'Hablar con el guía',
      lesson: {
        tone: '',
        kind: 'Guía de seguridad',
        title: 'Cómo cruzar sin caer',
        body: 'Antes de elegir un portal, lee su dirección: el oficial termina en .edu y no te apura ni te promete premios. Después, la salida no es obvia: busca una TV vieja a un lado y enciéndela.',
      },
    });
  });

  // ---------- Silencio ----------
  el.mute.innerHTML = ICON_SOUND;
  el.mute.addEventListener('click', () => {
    const m = !audio.isMuted();
    audio.setMuted(m);
    el.mute.innerHTML = m ? ICON_MUTED : ICON_SOUND;
    el.mute.setAttribute('aria-label', m ? 'Activar sonido' : 'Silenciar sonido');
  });

  // ---------- Atrás del teléfono: no te saca del simulador ----------
  // Al entrar se agrega una entrada al historial (con el toque de "Entrar", así el navegador
  // la respeta). El gesto o botón "atrás" la consume: se repone y aparece un aviso breve.
  const BACK_NOTE = 'Sigues dentro del teléfono: encuentra la salida';
  let inside = false;
  let backNoteTimer = 0;
  let objectiveBeforeNote = '';
  const holdHistory = () => history.pushState({ dentroDelTelefono: true }, '');
  window.addEventListener('popstate', () => {
    if (!inside) return;
    holdHistory();
    if (el.hud.hidden) return;
    if (el.objectiveText.textContent !== BACK_NOTE) objectiveBeforeNote = el.objectiveText.textContent;
    el.objectiveText.textContent = BACK_NOTE;
    clearTimeout(backNoteTimer);
    backNoteTimer = setTimeout(() => {
      if (el.objectiveText.textContent === BACK_NOTE) el.objectiveText.textContent = objectiveBeforeNote;
    }, 2600);
  });

  // ---------- Entrada: el teléfono te lleva al mundo de adentro ----------
  let booted = false;
  let introRunning = false;
  let introStarted = 0;

  el.enter.addEventListener('click', () => {
    if (!inside) {
      inside = true;
      holdHistory();
    }
    audio.ensure();
    el.intro.hidden = true;
    introRunning = true;
    introStarted = performance.now();
    phone.playIntro(camera, () => {
      introRunning = false;
      player.setEnabled(true); // la cámara ya quedó en la pose de inicio del pasillo
      el.hud.hidden = false;
      setTimeout(() => el.hint && (el.hint.style.opacity = '0'), 6500);
    });
  });
  // Tocar durante la entrada la salta (sin contar el mismo clic de "Entrar").
  document.addEventListener('pointerdown', () => {
    if (introRunning && performance.now() - introStarted > 400) phone.skip();
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  const timer = new THREE.Timer();
  timer.connect(document);

  renderer.setAnimationLoop(() => {
    timer.update();
    const rawDt = timer.getDelta();
    const dt = Math.min(rawDt, 1 / 20); // movimiento: paso corto para no atravesar obstáculos
    const animDt = Math.min(rawDt, 0.25); // cinemáticas: tiempo real aunque baje el FPS
    const t = timer.getElapsed();

    if (!booted) {
      booted = true;
      el.loader.classList.add('hide');
      el.intro.hidden = false;
      setTimeout(() => el.loader.remove(), 700);
    }

    phone.update(animDt); // siempre: también termina de desvanecer su velo (entrada saltada, outro)
    player.update(dt);

    for (const m of mixers) m.update(animDt);
    if (scammer) scammer.update(dt, animDt);
    world.update(dt, t);
    env.update(dt, t);
    ending.update(animDt);
    portal.update(animDt, t);
    game.update(animDt);
    composer.render();
  });
}
