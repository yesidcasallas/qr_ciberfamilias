import * as THREE from 'three';
import { liveSign, roundRect, wrapText } from './world.js';
import { FRASES, elegirFrase } from '../entities/tacticas.js';

/**
 * El estafador (modelo de Blender): te sigue y aplica ingeniería social según lo que
 * estés haciendo. Cada frase se rotula con su técnica (urgencia, autoridad, cebo…) para
 * aprender a reconocerla. Una vez, tras abrir la barrera, te ofrece un "atajo" en un panel:
 * si lo aceptas, te roba la cuenta; si te alejas, lo resististe.
 */
const FOLLOW_DIST = 3; // distancia a la que se mantiene
const FOLLOW_SPEED = 2.5; // m/s: algo más lento que tú (3.3); te alcanza cuando te detienes
const BUBBLE_T = 3.8; // segundos que se ve cada subtítulo

export function createScammer({ gltf, world, player, camera, audio, game, hud }) {
  const model = gltf.scene;
  // Paleta Amalfi: ojos, enlace y ribete en Citrus (el brillo del estafador avisa "cuidado"); su celular
  // en Sea Breeze y crema; la piel y la túnica pasan del violeta del modelo al azul.
  const citrico = new THREE.Color(0xffa62b);
  model.traverse((o) => {
    if (!o.isMesh) return;
    for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
      if (mat.name === 'Eyes_Glow' || mat.name === 'Phone_Link') {
        mat.color?.set(0xffa62b);
        mat.emissive?.set(0xffa62b);
      } else if (mat.name === 'Trim') {
        mat.color.copy(citrico).multiplyScalar(0.3); // apagado: el ribete acompaña, no compite con los ojos
        mat.emissive.copy(citrico).multiplyScalar(0.18);
      } else if (mat.name === 'Phone_Screen') {
        mat.color.set(0x86c5ff);
        mat.emissive.set(0x86c5ff);
      } else if (mat.name === 'Phone_UI') {
        mat.color.set(0xfff6de);
        mat.emissive.set(0xfff6de);
      } else if (mat.name === 'Skin' || mat.name === 'Robe') {
        const hsl = {};
        mat.color.getHSL(hsl);
        mat.color.setHSL(0.6, hsl.s, hsl.l);
      }
    }
  });

  const holder = new THREE.Group();
  holder.position.set(-4.8, 0, -9);
  holder.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const idleClip = THREE.AnimationClip.findByName(gltf.animations, 'Idle') || gltf.animations[0];
  const beckonClip = THREE.AnimationClip.findByName(gltf.animations, 'Beckon');
  const aIdle = idleClip ? mixer.clipAction(idleClip) : null;
  const aBeckon = beckonClip ? mixer.clipAction(beckonClip) : null;
  aIdle?.play();
  let beckoning = false;

  const meshes = [];
  model.traverse((o) => o.isMesh && meshes.push(o));
  world.addInteractable({
    id: 'scammer',
    kind: 'fraud',
    group: holder,
    meshes,
    prompt: 'Examinar: el estafador',
    bait: false, // examinarlo enseña a reconocerlo: no cuenta como caer
    lesson: {
      tone: 'danger',
      kind: 'Ingeniería social',
      title: 'El estafador que te sigue y te susurra',
      body: 'Usa urgencia, autoridad falsa, premios y atajos para que hagas lo que él quiere. Cada frase suya tiene una técnica: reconócela, no respondas y sigue por el canal oficial.',
    },
  });

  // Subtítulo de lo que dice, con la técnica rotulada (un Sprite siempre mira a la cámara).
  const bubble = makeBubble();
  bubble.sprite.position.y = 2.35;
  holder.add(bubble.sprite);
  let bubbleT = 0;

  // Panel de la oferta ("atajo") que aparece una sola vez.
  const offer = makeOfferPanel(world);

  let state = 'lurk'; // lurk | follow | offer | taken
  let talkT = 1.5;
  let offerT = 0;
  let pressured = false;
  let offerDone = false;
  let wasLosing = false;
  let last = null;
  const offerSpot = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const step = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();

  function say(line, camDist) {
    last = line;
    bubble.set(line.tactic, line.text);
    bubbleT = BUBBLE_T;
    // voz grave + susurro de fondo que suena del lado donde está
    camera.getWorldDirection(fwd);
    right.crossVectors(fwd, camera.up).normalize();
    tmp.set(holder.position.x - camera.position.x, 0, holder.position.z - camera.position.z).normalize();
    const gain = THREE.MathUtils.clamp(1.25 - camDist / 6, 0.3, 1);
    audio.whisper({ pan: tmp.dot(right), gain: gain * 0.45 });
    audio.speak(line.say, { gain });
  }

  // Elige la táctica según lo que estás haciendo y dónde estás: la escena arma el contexto y la
  // regla (qué técnica toca) vive en la entidad.
  function lineFor(gs) {
    const p = player.position;
    tmp.set(p.x, 0, p.z);
    return elegirFrase(
      {
        campo: gs.typingField,
        cercaDeTv: world.gate.isOpen && world.tv.group.position.distanceTo(tmp) < 7,
        objetosCerca: world.interactables
          .filter((r) => r.kind === 'fraud' && r.id !== 'scammer' && r.group.position.distanceTo(tmp) < 3.8)
          .map((r) => r.id),
        correoRegistrado: gs.safeChosen,
        frenteAVentanas: !world.gate.isOpen && p.z < -5,
      },
      last,
    );
  }

  function setBeckon(on) {
    if (!aBeckon || !aIdle || on === beckoning) return;
    beckoning = on;
    const from = on ? aIdle : aBeckon;
    const to = on ? aBeckon : aIdle;
    to.reset().setEffectiveWeight(1).play();
    from.crossFadeTo(to, 0.4, false);
  }

  function startOffer() {
    state = 'offer';
    offerT = 0;
    pressured = false;
    // El panel queda centrado frente a ti, a la distancia en la que cabe en cualquier pantalla
    // (en un celular vertical la vista es angosta); el estafador se asoma detrás, a su izquierda.
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    right.crossVectors(fwd, camera.up).normalize();
    const p = player.position;
    const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const panelDist = Math.max(2.4, 1.5 / (0.8 * 2 * halfTan * camera.aspect) + 0.3);
    offer.group.position.set(p.x + fwd.x * panelDist, 1.6, p.z + fwd.z * panelDist);
    offer.group.position.x = THREE.MathUtils.clamp(offer.group.position.x, -4.8, 4.8);
    offer.group.lookAt(p.x, 1.6, p.z);
    offerSpot.set(
      offer.group.position.x - right.x * 0.95 + fwd.x * 0.7,
      0,
      offer.group.position.z - right.z * 0.95 + fwd.z * 0.7,
    );
    offerSpot.x = THREE.MathUtils.clamp(offerSpot.x, -5, 5);
    offer.reset();
    offer.group.visible = true;
    offer.record.enabled = true;
    offer.record.taken = false;
  }

  function endOffer() {
    offer.group.visible = false;
    offer.record.enabled = false;
    offerDone = true;
    state = 'follow';
  }

  return {
    mixer,
    update(dt, realDt = dt) {
      const gs = game.state;
      const playing = !hud.hidden && !gs.exiting;
      const p = player.position;
      const dist = Math.hypot(holder.position.x - p.x, holder.position.z - p.z);

      if (state === 'lurk' && playing && dist < 8) state = 'follow';

      // La oferta: una sola vez, ya pasada la barrera, en la zona de objetos.
      if (state === 'follow' && playing && !offerDone && world.gate.isOpen && p.z < -19 && !gs.typingField && !gs.losing) {
        startOffer();
        say(FRASES.offer, dist);
        talkT = 7;
      }

      if (state === 'offer') {
        offerT += realDt;
        if (offer.record.taken) {
          state = 'taken'; // la aceptaste: el juego muestra el robo y te devuelve al inicio
        } else if (p.distanceTo(tmp.set(offerSpot.x, p.y, offerSpot.z)) > 5.5 || offerT > 16) {
          endOffer(); // te alejaste: la resististe
          game.noteResisted();
          say(FRASES.declined, dist);
          talkT = 8;
        } else if (!pressured && offerT > 7) {
          pressured = true;
          say(FRASES.pressure, dist);
        }
      }
      if (state === 'taken' && !gs.losing) endOffer(); // de vuelta en el inicio

      // Movimiento: en la oferta se planta frente a ti; si no, te sigue con una "correa".
      if (playing && (state === 'follow' || state === 'offer' || state === 'taken')) {
        if (state === 'follow') {
          // "correa": se queda a FOLLOW_DIST en la dirección en la que esté (suele quedar detrás)
          tmp.set(holder.position.x - p.x, 0, holder.position.z - p.z);
          const d = tmp.length();
          if (d < 1e-3) tmp.set(-1, 0, 0);
          else tmp.divideScalar(d);
          step.set(p.x + tmp.x * FOLLOW_DIST, 0, p.z + tmp.z * FOLLOW_DIST);
        } else {
          step.copy(offerSpot);
        }
        step.x = THREE.MathUtils.clamp(step.x, -5, 5);
        step.z = THREE.MathUtils.clamp(step.z, -36.5, 2.5);
        if (!world.gate.isOpen) step.z = Math.max(step.z, world.gate.z + 0.9);
        step.sub(holder.position);
        const len = step.length();
        const max = (state === 'follow' ? FOLLOW_SPEED : 4) * dt;
        if (len > max) step.multiplyScalar(max / len);
        holder.position.add(step);
      }

      // Siempre te mira (el frente del modelo es +Z)
      const dx = camera.position.x - holder.position.x;
      const dz = camera.position.z - holder.position.z;
      const camDist = Math.hypot(dx, dz);
      let diff = Math.atan2(dx, dz) - holder.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      holder.rotation.y += diff * Math.min(1, dt * 3);
      setBeckon(state === 'offer' || camDist < 3.8);

      // Se burla cuando caes en una trampa
      if (gs.losing && !wasLosing && state !== 'lurk') say(FRASES.gloat, camDist);
      wasLosing = gs.losing;

      // Habla cada pocos segundos con la táctica que toca
      talkT -= realDt;
      if (playing && state === 'follow' && talkT <= 0 && camDist < 7.5 && !gs.losing) {
        talkT = 6 + Math.random() * 4;
        say(lineFor(gs), camDist);
      }

      if (bubbleT > 0) bubbleT -= realDt;
      bubble.mat.opacity = bubbleT > 0 ? Math.min(1, (BUBBLE_T - bubbleT) / 0.25) * Math.min(1, bubbleT / 0.5) : 0;
    },
  };
}

// ---------------- panel de la oferta ----------------

function makeOfferPanel(world) {
  const live = liveSign(1.5, 1.05);
  const group = new THREE.Group();
  group.add(live.mesh);
  group.visible = false;
  const reset = () => live.draw(drawOffer);
  reset();
  const record = world.addInteractable({
    id: 'scam-offer',
    kind: 'offer',
    group,
    meshes: [live.mesh],
    enabled: false,
    prompt: 'Aceptar el atajo del estafador',
    focus: { mesh: live.mesh, w: 1.7, h: 1.25 },
    taken: false,
    lesson: {
      tone: 'danger',
      kind: 'Ingeniería social · atajo falso',
      title: 'Nadie te saca con tu contraseña',
      body: 'Ofrecer un atajo a cambio de tu contraseña es un pretexto clásico. Ninguna persona ni servicio legítimo te la pide: ignóralo y sigue por el camino oficial.',
    },
    showRobbed: (_, hint) => live.draw((g, W, H) => drawOfferRobbed(g, W, H, hint)),
    resetInput: reset,
    // solo el botón "Aceptar atajo" (ver drawOffer) acepta, con margen para el dedo
    hitAccept: (uv) => {
      const { width: W, height: H } = live.mesh.material.map.image;
      const x = uv.x * W;
      const y = (1 - uv.y) * H;
      return x >= 48 && x <= W - 48 && y >= H - 248 && y <= H - 120;
    },
  });
  return { group, record, reset };
}

function drawOffer(g, W, H) {
  roundRect(g, 4, 4, W - 8, H - 8, 34);
  g.fillStyle = 'rgba(9,20,44,0.95)';
  g.fill();
  g.strokeStyle = 'rgba(255,166,43,0.65)';
  g.lineWidth = 4;
  g.stroke();
  g.textAlign = 'left';
  g.fillStyle = '#ffa62b';
  g.font = '600 30px system-ui, sans-serif';
  g.fillText('OFERTA DEL ESTAFADOR', 60, 84);
  g.fillStyle = '#fff6de';
  g.font = '600 66px system-ui, sans-serif';
  g.fillText('Salida rápida', 60, 168);
  g.fillStyle = 'rgba(255,246,222,0.7)';
  g.font = '500 36px system-ui, sans-serif';
  wrapText(g, 'Te saco del teléfono ahora mismo. Solo necesito tu contraseña.', 60, 268, W - 120, 48);
  // botón tentador
  roundRect(g, 60, H - 236, W - 120, 104, 52);
  g.fillStyle = '#ffa62b';
  g.fill();
  g.textAlign = 'center';
  g.fillStyle = '#13254a';
  g.font = '700 42px system-ui, sans-serif';
  g.fillText('Aceptar atajo', W / 2, H - 236 + 68);
  g.fillStyle = 'rgba(255,246,222,0.5)';
  g.font = '500 28px system-ui, sans-serif';
  g.fillText('Aléjate para rechazar', W / 2, H - 70);
}

function drawOfferRobbed(g, W, H, hint) {
  roundRect(g, 4, 4, W - 8, H - 8, 34);
  g.fillStyle = 'rgba(9,20,44,0.95)';
  g.fill();
  g.strokeStyle = 'rgba(251,113,133,0.7)';
  g.lineWidth = 4;
  g.stroke();
  g.textAlign = 'center';
  g.fillStyle = '#fb7185';
  g.font = '600 60px system-ui, sans-serif';
  g.fillText('Te robaron la cuenta', W / 2, 140);
  g.fillStyle = '#fff6de';
  g.font = '500 34px system-ui, sans-serif';
  g.fillText('Aceptaste el atajo de un desconocido', W / 2, 210);
  g.fillStyle = 'rgba(255,246,222,0.65)';
  g.font = '500 31px system-ui, sans-serif';
  wrapText(g, 'Nadie legítimo te pide la contraseña a cambio de un atajo. Era ingeniería social: un pretexto con urgencia.', W / 2, 360, W - 120, 42);
  g.fillStyle = '#86c5ff';
  g.font = '600 32px system-ui, sans-serif';
  g.fillText(hint, W / 2, H - 70);
}

// ---------------- subtítulo ----------------

/** Subtítulo flotante: técnica rotulada en Citrus + la frase en cursiva. */
function makeBubble() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 220;
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.4, 2.4 * (220 / 1024), 1);
  return {
    sprite,
    mat,
    set(tactic, text) {
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.font = 'italic 500 46px system-ui, sans-serif';
      const tw = g.measureText(text).width;
      g.font = '700 26px system-ui, sans-serif';
      const label = tactic.toUpperCase();
      const lw = g.measureText(label).width;
      const w = Math.min(canvas.width - 8, Math.max(tw, lw) + 90);
      const x = (canvas.width - w) / 2;
      g.beginPath();
      if (g.roundRect) g.roundRect(x, 16, w, 188, 40);
      else g.rect(x, 16, w, 188);
      g.fillStyle = 'rgba(9,20,44,0.8)';
      g.fill();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffa62b';
      g.font = '700 26px system-ui, sans-serif';
      g.fillText(label, canvas.width / 2, 62);
      g.fillStyle = 'rgba(255,246,222,0.96)';
      g.font = 'italic 500 46px system-ui, sans-serif';
      g.fillText(text, canvas.width / 2, 132);
      texture.needsUpdate = true;
    },
  };
}
