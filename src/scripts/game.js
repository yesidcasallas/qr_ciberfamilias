import * as THREE from 'three';
import { liveSign, roundRect, wrapText } from './world.js';
import { esCorreoValido, esUniversidadValida } from '../entities/participacion.js';
import { crearRecorrido } from '../entities/recorrido.js';

const EXIT_DUR = 1.6;
const RETURN_DUR = 1.2;

/**
 * Máquina de estados del simulador. Todo se muestra EN LA ESCENA (sin modales):
 *  - Ventanas: al elegir una, escribes tu correo sobre ella. Si es falsa, la ventana
 *    te muestra que le entregaste tus datos y, al tocar, un portal te devuelve al
 *    inicio. Si es la oficial, queda registrado y se abre la barrera.
 *  - TV (vieja, apagada, a un lado): escribes tu universidad sobre su pantalla; te
 *    absorbe, sales del teléfono y aparece el agradecimiento.
 *  - Objetos, anuncios y el guía muestran su lección en una tarjeta 3D.
 */
export function createGame({ world, hud, player, camera, audio, portal, onFinished }) {
  const el = hud.dom;
  const isTouch = () => document.body.classList.contains('touch');
  // trampas, cebos, resistencia al estafador y lo registrado: las reglas del puntaje viven en la entidad
  const recorrido = crearRecorrido();

  const objective = (text) => (el.objectiveText.textContent = text);
  objective('Elige el portal seguro entre las 3 ventanas');

  const makeFlash = () => {
    const d = document.createElement('div');
    Object.assign(d.style, {
      position: 'fixed',
      inset: '0',
      background: '#fff6de',
      opacity: '0',
      zIndex: '45',
      pointerEvents: 'none',
    });
    document.body.appendChild(d);
    return d;
  };

  // ---------- Tarjeta 3D de lección (reemplaza al modal) ----------
  const card = createLessonCard(camera);
  const cardFrom = new THREE.Vector3();
  let cardT = 0;
  function showCard(lesson) {
    card.show(lesson, isTouch());
    cardFrom.copy(player.position);
    cardT = 0;
  }
  // Cualquier toque cierra la tarjeta; ese mismo toque no activa otro objeto.
  let swallowTap = false;
  document.addEventListener('pointerdown', () => {
    if (!card.visible || typing) return;
    card.hide();
    swallowTap = true;
    setTimeout(() => (swallowTap = false), 350);
  });

  // ---------- Escribir sobre una pantalla 3D ----------
  // Un input invisible recibe el teclado (y abre el del celular); el texto se dibuja
  // en vivo sobre la ventana o la TV, con un cursor que parpadea.
  let typing = null; // { record, field, onSubmit, error }
  let caretOn = true;
  let caretTimer = 0;

  // Encuadre: mientras escribes (y lees el resultado), la cámara se pone de frente a la
  // pantalla y la ajusta al espacio visible (en el celular, el que queda sobre el teclado).
  let focusRecord = null;
  const focusTarget = new THREE.Vector3();
  const focusNormal = new THREE.Vector3();
  const focusPos = new THREE.Vector3();
  const focusQuat = new THREE.Quaternion();
  const lookMatrix = new THREE.Matrix4();

  function updateFocusCamera(dt) {
    const f = focusRecord.focus;
    if (!f) return;
    f.mesh.getWorldPosition(focusTarget);
    f.mesh.getWorldDirection(focusNormal); // el +Z local de la pantalla = hacia donde mira
    focusNormal.y = 0;
    focusNormal.normalize();
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(f.h / 2 / tan, f.w / 2 / (tan * camera.aspect)) * 1.12;
    focusPos.copy(focusTarget).addScaledVector(focusNormal, dist);
    lookMatrix.lookAt(focusPos, focusTarget, camera.up);
    focusQuat.setFromRotationMatrix(lookMatrix);
    const k = 1 - Math.exp(-6 * dt);
    camera.position.lerp(focusPos, k);
    camera.quaternion.slerp(focusQuat, k);
  }

  // Suelta el encuadre dejando al jugador frente a la pantalla (sin salto de cámara).
  function releaseFocus() {
    focusRecord = null;
    camera.getWorldDirection(focusNormal);
    player.setPose(camera.position.x, camera.position.z, Math.atan2(-focusNormal.x, -focusNormal.z));
    player.setLocked(false);
  }

  function hintFor(field) {
    if (field === 'email') return isTouch() ? 'Toca «Enviar» o ↵ en el teclado' : 'Enter para enviar · Esc para cancelar';
    return isTouch() ? 'Toca ↵ en el teclado para salir' : 'Enter para salir del teléfono';
  }

  function startTyping(record, field, onSubmit) {
    card.hide();
    typing = { record, field, onSubmit, error: '' };
    focusRecord = record;
    player.setLocked(true);
    document.body.classList.add('typing');
    el.typer.value = '';
    el.typer.type = field === 'email' ? 'email' : 'text';
    el.typer.inputMode = field === 'email' ? 'email' : 'text';
    el.typer.focus({ preventScroll: true });
    caretOn = true;
    renderTyping();
    clearInterval(caretTimer);
    caretTimer = setInterval(() => {
      caretOn = !caretOn;
      renderTyping();
    }, 500);
  }

  function renderTyping() {
    if (!typing) return;
    typing.record.drawInput(el.typer.value, { caret: caretOn, error: typing.error, hint: hintFor(typing.field) });
  }

  function stopTyping() {
    const current = typing;
    typing = null; // antes del blur: así el blur no lo toma como cancelación
    clearInterval(caretTimer);
    document.body.classList.remove('typing');
    el.typer.blur();
    return current;
  }

  function cancelTyping() {
    if (!typing) return;
    const { record } = stopTyping();
    record.resetInput();
    releaseFocus();
  }

  function submitTyping() {
    const value = el.typer.value.trim();
    const { field, onSubmit } = typing;
    const error =
      field === 'email'
        ? esCorreoValido(value)
          ? ''
          : 'Escribe un correo válido'
        : esUniversidadValida(value)
          ? ''
          : 'Escribe el nombre de tu universidad';
    if (error) {
      typing.error = error;
      audio?.danger();
      renderTyping();
      return;
    }
    stopTyping();
    onSubmit(value);
  }

  el.typer.addEventListener('input', () => {
    if (!typing) return;
    typing.error = '';
    caretOn = true;
    audio?.key();
    renderTyping();
  });
  el.typer.addEventListener('keydown', (e) => {
    if (!typing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      submitTyping();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelTyping();
    }
  });
  // Mientras escribes, la pantalla se toca como en el teléfono: tocarla (el campo) mantiene el
  // teclado abierto y el botón "Enviar" de la ventana envía. Tocar fuera la cierra.
  const tapRay = new THREE.Raycaster();
  const tapNdc = new THREE.Vector2();
  let keepFocusAt = -Infinity;
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!typing) return;
      tapNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      tapRay.setFromCamera(tapNdc, camera);
      const hit = tapRay.intersectObject(typing.record.focus.mesh, false)[0];
      if (!hit) return;
      e.preventDefault(); // el campo conserva el foco
      keepFocusAt = performance.now();
      if (hit.uv && typing.record.hitSubmit?.(hit.uv)) submitTyping();
    },
    true,
  );

  // Cerrar el teclado del celular (o tocar fuera de la pantalla) cancela la escritura.
  el.typer.addEventListener('blur', () => {
    if (typing && performance.now() - keepFocusAt < 500) {
      setTimeout(() => typing && el.typer.focus({ preventScroll: true }), 0); // tocaste la pantalla: sigue
      return;
    }
    cancelTyping();
  });

  // ---------- Interacción ----------
  function onInteract(record, hit) {
    if (exiting || returning || typing || swallowTap || loseState !== 'none') return;
    if (card.visible) {
      card.hide(); // la tecla E también cierra la tarjeta
      return;
    }
    switch (record.kind) {
      case 'guide':
        audio?.good();
        showCard(record.lesson);
        break;
      case 'ad':
      case 'fraud':
        if (record.bait !== false) recorrido.tocarCebo(record.id);
        audio?.danger();
        showCard(record.lesson);
        break;
      case 'window':
        onWindow(record);
        break;
      case 'tv':
        onTv(record);
        break;
      case 'offer':
        // solo su botón "Aceptar atajo" acepta, como en una app (tocar el panel no hace nada)
        if (hit?.uv && record.hitAccept && !record.hitAccept(hit.uv)) return;
        // aceptar el "atajo" del estafador ya es caer: no se pide escribir ninguna contraseña
        record.taken = true;
        lose(record, '');
        break;
    }
  }

  // Ventana: el correo se escribe sobre ella. El resultado se muestra en la misma ventana.
  function onWindow(record) {
    if (recorrido.correoRegistrado) return;
    audio?.focus();
    startTyping(record, 'email', (email) => {
      if (record.safe) {
        recorrido.registrarCorreo(email);
        audio?.good();
        record.showConfirm(email);
        record.frame.material.emissive.set(0x34d399);
        record.frame.material.emissiveIntensity = 0.6;
        for (const r of world.interactables) if (r.kind === 'window') r.enabled = false;
        // se queda encuadrada un momento para leer la confirmación; luego vuelves a caminar
        setTimeout(() => {
          world.gate.open();
          objective('Correo registrado. La salida no es obvia: explora y mira a los lados.');
          releaseFocus();
        }, 2600);
      } else {
        lose(record, email);
      }
    });
  }

  // ---------- Perder: la ventana muestra el robo; al tocar, un portal te devuelve al inicio ----------
  let loseState = 'none'; // none | await | portal
  let loseTimer = 0;
  let autoTimer = 0;
  const portalPos = new THREE.Vector3();
  const fwd = new THREE.Vector3();

  function lose(record, email) {
    recorrido.caerEnTrampa();
    if (record.frame) {
      record.frame.material.emissive.set(0xfb7185);
      record.frame.material.emissiveIntensity = 0.7;
    }
    focusRecord = record; // encuadra el mensaje del robo para leerlo
    record.showRobbed(email, isTouch() ? 'Toca para volver al inicio' : 'Haz clic o pulsa Enter para volver al inicio');
    player.setLocked(true);
    audio?.alarm();
    objective(record.kind === 'offer' ? 'Le diste tu cuenta al estafador.' : 'Le entregaste tu correo a un sitio falso.');
    loseState = 'reading';
    clearTimeout(loseTimer);
    clearTimeout(autoTimer);
    // un instante para leer antes de aceptar el toque; si no hay toque, vuelve solo
    loseTimer = setTimeout(() => (loseState = 'await'), 900);
    autoTimer = setTimeout(openReturnPortal, 9000);
  }

  function openReturnPortal() {
    if (loseState !== 'await' && loseState !== 'reading') return;
    loseState = 'portal';
    focusRecord = null;
    clearTimeout(autoTimer);
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    portalPos.copy(camera.position).addScaledVector(fwd, 3.2);
    portalPos.y = 1.9;
    if (portal) {
      portal.group.rotation.y = Math.atan2(-fwd.x, -fwd.z);
      portal.show(portalPos.x, portalPos.y, portalPos.z);
    }
    objective('Un portal te regresa al inicio');
    setTimeout(startReturn, 800); // se ve abrirse y luego lo atraviesas
  }

  document.addEventListener('pointerdown', () => {
    if (loseState === 'await') openReturnPortal();
  });
  window.addEventListener('keydown', (e) => {
    const k = (e.key || '').toLowerCase();
    if (loseState === 'await' && (k === 'enter' || k === ' ' || k === 'e')) openReturnPortal();
  });

  // ---------- Volver al inicio (atravesar el portal) ----------
  let returning = false;
  let retT = 0;
  const retStart = new THREE.Vector3();
  let retFov0 = camera.fov;
  let retFlash = null;

  function startReturn() {
    returning = true;
    retT = 0;
    retStart.copy(camera.position);
    retFov0 = camera.fov;
    retFlash = makeFlash();
    audio?.power();
  }

  function updateReturn(dt) {
    retT += dt;
    const k = Math.min(1, retT / RETURN_DUR);
    const accel = k * k;
    camera.position.lerpVectors(retStart, portalPos, accel);
    camera.lookAt(portalPos);
    camera.fov = retFov0 + accel * 30; // efecto warp al atravesar
    camera.updateProjectionMatrix();
    retFlash.style.opacity = String(Math.max(0, (k - 0.55) / 0.45));
    if (k >= 1) {
      returning = false;
      loseState = 'none';
      portal?.hide();
      camera.fov = retFov0;
      camera.updateProjectionMatrix();
      resetChallenge();
      setTimeout(() => retFlash?.remove(), 400);
    }
  }

  function resetChallenge() {
    if (!recorrido.correoRegistrado) {
      // caíste antes de registrarte: las ventanas vuelven a empezar
      for (const r of world.interactables) {
        if (r.kind === 'window') {
          r.enabled = true;
          r.resetInput();
          r.frame.material.emissive.set(r.baseEmissive);
          r.frame.material.emissiveIntensity = 0.25;
        }
      }
      objective('Elige el portal seguro entre las 3 ventanas');
    } else {
      // ya tenías el correo registrado (caíste con el estafador): conservas el avance
      objective('Ignora al estafador y busca la salida: no es obvia.');
    }
    player.setPose(world.spawn.x, world.spawn.z, world.spawn.yaw ?? 0);
    player.setLocked(false);
  }

  // ---------- TV de salida: la universidad se escribe sobre su pantalla ----------
  function onTv(record) {
    if (!record.revealed) {
      record.turnOn();
      audio?.power();
    }
    objective('Escribe tu universidad para salir del teléfono.');
    startTyping(record, 'university', (university) => {
      recorrido.registrarUniversidad(university);
      record.showConfirm(university);
      startExit();
    });
  }

  // ---------- Salida: la TV te absorbe y sales del teléfono ----------
  let exiting = false;
  let exitT = 0;
  const exitStart = new THREE.Vector3();
  const exitTarget = new THREE.Vector3();
  let exitFov0 = camera.fov;
  let exitFlash;

  function startExit() {
    exiting = true;
    exitT = 0;
    focusRecord = null;
    card.hide();
    player.setLocked(true);
    player.setEnabled(false);
    el.hud.hidden = true;
    audio?.success();
    exitStart.copy(camera.position);
    exitFov0 = camera.fov;
    world.tv.screen.getWorldPosition(exitTarget);
    exitFlash = makeFlash();
  }

  function updateExit(dt) {
    exitT += dt;
    const k = Math.min(1, exitT / EXIT_DUR);
    const accel = k * k;
    camera.position.lerpVectors(exitStart, exitTarget, accel);
    camera.lookAt(exitTarget);
    camera.fov = exitFov0 + accel * 42;
    camera.updateProjectionMatrix();
    exitFlash.style.opacity = String(Math.max(0, (k - 0.55) / 0.45));
    if (k >= 1) {
      exiting = false;
      camera.fov = exitFov0;
      camera.updateProjectionMatrix();
      // sales del teléfono: el final (salida por el teléfono + créditos) lo dirige main.js
      onFinished?.(recorrido.resumen()); // { email, university, fell, resisted }
      exitFlash.style.transition = 'opacity 0.8s ease';
      exitFlash.style.opacity = '0';
      setTimeout(() => exitFlash?.remove(), 900);
    }
  }

  return {
    onInteract,
    /** Lo que está pasando (lo usa el estafador para elegir su táctica). */
    get state() {
      return {
        typingField: typing?.field ?? null,
        safeChosen: recorrido.correoRegistrado,
        losing: loseState !== 'none' || returning,
        exiting,
      };
    },
    noteResisted() {
      recorrido.resistirEstafador();
    },
    update(dt) {
      if (exiting) updateExit(dt);
      else if (returning) updateReturn(dt);
      else if (focusRecord) updateFocusCamera(dt);
      // la tarjeta se va sola al caminar o tras unos segundos
      if (card.visible) {
        cardT += dt;
        if (cardT > 12 || player.position.distanceTo(cardFrom) > 0.8) card.hide();
      }
    },
  };
}

/**
 * Tarjeta de lección dibujada en canvas y colgada frente a la cámara: se lee como
 * parte de la escena (sin fondo oscurecido ni botón) y se ajusta al ancho de pantalla.
 */
function createLessonCard(camera) {
  const ASPECT = 1.6;
  const DIST = 1.2;
  const live = liveSign(1, 1 / ASPECT);
  const mesh = live.mesh;
  mesh.material.depthTest = false; // siempre encima: no la cortan paredes ni objetos cercanos
  mesh.material.depthWrite = false;
  mesh.renderOrder = 999;
  mesh.frustumCulled = false;
  mesh.visible = false;
  camera.add(mesh);

  return {
    show(lesson, touch) {
      live.draw((g, W, H) => drawCard(g, W, H, lesson, touch));
      const visH = 2 * DIST * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const visW = visH * camera.aspect;
      mesh.scale.setScalar(Math.min(1.05, visW * 0.9));
      mesh.position.set(0, visH * 0.12, -DIST);
      mesh.visible = true;
    },
    hide() {
      mesh.visible = false;
    },
    get visible() {
      return mesh.visible;
    },
  };
}

function drawCard(g, W, H, lesson, touch) {
  const tone = lesson.tone === 'danger' ? '#fb7185' : lesson.tone === 'safe' ? '#34d399' : '#86c5ff';
  roundRect(g, 4, 4, W - 8, H - 8, 36);
  g.fillStyle = 'rgba(9,20,44,0.94)';
  g.fill();
  g.strokeStyle = 'rgba(255,246,222,0.14)';
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = tone;
  g.fillRect(4, 44, 6, H - 88); // acento lateral
  g.textAlign = 'left';
  g.fillStyle = tone;
  g.font = '600 30px system-ui, sans-serif';
  g.fillText(lesson.kind.toUpperCase(), 60, 84);
  g.fillStyle = '#fff6de';
  g.font = '600 50px system-ui, sans-serif';
  g.fillText(lesson.title, 60, 152);
  g.fillStyle = 'rgba(255,246,222,0.76)';
  g.font = '500 34px system-ui, sans-serif';
  wrapText(g, lesson.body, 60, H * 0.58, W - 120, 46);
  g.fillStyle = 'rgba(134,197,255,0.92)';
  g.font = '500 28px system-ui, sans-serif';
  g.fillText(touch ? 'Toca o camina para continuar' : 'Haz clic o camina para continuar', 60, H - 44);
}
