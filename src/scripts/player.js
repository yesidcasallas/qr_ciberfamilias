import * as THREE from 'three';

const EYE = 1.6;
const SPEED = 3.3;
const REACH = 5.5; // distancia máxima para usar un objeto
const SIGHT = 14; // hasta dónde se reconoce lo que tocas (para pedirte que te acerques)
const RADIUS = 0.35; // radio del jugador para colisiones

/**
 * Controlador en primera persona para móvil y escritorio:
 *  - caminar: WASD/flechas o joystick táctil
 *  - mirar: arrastrar en la pantalla
 *  - interactuar: tocar o hacer clic directamente sobre el objeto, como en el teléfono.
 *    En escritorio, el objeto bajo el mouse se resalta y la tecla E/espacio también lo usa.
 */
export function createPlayer({ camera, canvas, hud, world, onInteract, audio }) {
  let yaw = world.spawn.yaw ?? 0;
  let pitch = 0;
  const pos = new THREE.Vector3(world.spawn.x, EYE, world.spawn.z);
  let enabled = false;
  let locked = false;
  let bob = 0;
  let stepT = 0;
  const baseFov = camera.fov;

  const keys = new Set();
  const joy = { x: 0, y: 0 };

  const capture = (elm, id) => {
    try {
      elm.setPointerCapture(id);
    } catch {
      /* puntero sintético o ya liberado */
    }
  };

  const raycaster = new THREE.Raycaster();
  raycaster.far = SIGHT;
  const pointer = new THREE.Vector2();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const yawEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  let focused = null; // objeto bajo el mouse (escritorio)
  let focusHit = null;
  let hover = null; // última posición del mouse sobre el canvas

  // ---------- Teclado (escritorio) ----------
  const onKeyDown = (e) => {
    const k = (e.key || '').toLowerCase(); // algunos eventos sintéticos no traen `key`
    keys.add(k);
    if ((k === 'e' || k === ' ') && enabled && !locked && focused) onInteract(focused, focusHit);
  };
  const onKeyUp = (e) => keys.delete((e.key || '').toLowerCase());
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // ---------- Mirar / tocar (sobre el canvas) ----------
  let look = null; // {id, x, y, moved, t}
  canvas.addEventListener('pointerdown', (e) => {
    if (!enabled || locked) return;
    // sin el clic de mouse que el navegador simula tras un toque: si el toque abre un campo
    // de texto, ese clic le quitaría el foco y cerraría el teclado
    e.preventDefault();
    look = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t: performance.now() };
    capture(canvas, e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') hover = { x: e.clientX, y: e.clientY };
    if (!look || e.pointerId !== look.id) return;
    const dx = e.clientX - look.x;
    const dy = e.clientY - look.y;
    look.x = e.clientX;
    look.y = e.clientY;
    look.moved += Math.abs(dx) + Math.abs(dy);
    const sens = 0.0042;
    yaw -= dx * sens;
    pitch = THREE.MathUtils.clamp(pitch - dy * sens, -1.1, 1.1);
  });
  canvas.addEventListener('pointerleave', () => (hover = null));
  canvas.addEventListener('pointerup', (e) => {
    if (!look || e.pointerId !== look.id) return;
    const quick = performance.now() - look.t < 400;
    if (look.moved < 10 && quick && enabled && !locked) tapAt(e.clientX, e.clientY); // toque = usar lo tocado
    look = null;
  });
  canvas.addEventListener('pointercancel', (e) => {
    if (look && e.pointerId === look.id) look = null;
  });

  // ---------- Joystick táctil ----------
  const { pad, stick } = hud;
  if (pad) {
    let active = null;
    const R = 46;
    const set = (e) => {
      const rect = pad.getBoundingClientRect();
      let dx = e.clientX - (rect.left + rect.width / 2);
      let dy = e.clientY - (rect.top + rect.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      if (d > R) {
        dx = (dx / d) * R;
        dy = (dy / d) * R;
      }
      stick.style.transform = `translate(${dx}px, ${dy}px)`;
      joy.x = dx / R;
      joy.y = -dy / R; // arriba = adelante
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      active = e.pointerId;
      capture(pad, e.pointerId);
      set(e);
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === active) set(e);
    });
    const release = (e) => {
      if (e.pointerId !== active) return;
      active = null;
      joy.x = joy.y = 0;
      stick.style.transform = 'translate(0,0)';
    };
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);
  }

  // ---------- Tocar/clic sobre los objetos (rayo desde el punto tocado) ----------
  /** Lo que hay bajo un punto de la pantalla: el objeto interactivo y dónde se tocó. */
  function pickAt(x, y) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(world.targets(), false)[0];
    return hit ? { record: hit.object.userData.interactable, hit } : null;
  }

  function tapAt(x, y) {
    const picked = pickAt(x, y);
    if (!picked) return;
    if (picked.hit.distance > REACH) flashPrompt('Acércate para usarlo');
    else onInteract(picked.record, picked.hit);
  }

  // En escritorio, lo que está bajo el mouse se resalta: cursor de mano y qué hace abajo.
  function updateFocus() {
    const picked = enabled && !locked && hover && !look ? pickAt(hover.x, hover.y) : null;
    const near = picked && picked.hit.distance <= REACH ? picked : null;
    focusHit = near?.hit ?? null;
    setFocus(near?.record ?? null);
  }

  function setFocus(record) {
    if (record === focused) return;
    focused = record;
    if (record) audio?.focus();
    canvas.style.cursor = record ? 'pointer' : '';
    if (!flashTimer) showPrompt(record?.prompt);
  }

  // Aviso abajo: lo que hace el objeto bajo el mouse, o un aviso breve ("acércate").
  let flashTimer = 0;
  function showPrompt(text) {
    hud.prompt.textContent = text || '';
    hud.prompt.hidden = !text;
  }
  function flashPrompt(text) {
    clearTimeout(flashTimer);
    showPrompt(text);
    flashTimer = setTimeout(() => {
      flashTimer = 0;
      showPrompt(focused?.prompt);
    }, 1400);
  }

  // ---------- Movimiento + colisiones ----------
  function move(dt) {
    let ix = 0;
    let iz = 0;
    if (keys.has('w') || keys.has('arrowup')) iz += 1;
    if (keys.has('s') || keys.has('arrowdown')) iz -= 1;
    if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
    if (keys.has('d') || keys.has('arrowright')) ix += 1;
    ix += joy.x;
    iz += joy.y;
    const len = Math.hypot(ix, iz);
    if (len > 1) {
      ix /= len;
      iz /= len;
    }

    yawEuler.y = yaw;
    forward.set(0, 0, -1).applyEuler(yawEuler);
    right.set(1, 0, 0).applyEuler(yawEuler);

    let nx = pos.x + (forward.x * iz + right.x * ix) * SPEED * dt;
    let nz = pos.z + (forward.z * iz + right.z * ix) * SPEED * dt;

    const b = world.bounds;
    nx = THREE.MathUtils.clamp(nx, b.minX, b.maxX);
    nz = THREE.MathUtils.clamp(nz, b.minZ, b.maxZ);

    if (!world.gate.isOpen && nz < world.gate.z + 0.6) nz = world.gate.z + 0.6;

    for (const c of world.colliders) {
      const dx = nx - c.x;
      const dz = nz - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + RADIUS;
      if (d < min && d > 0.0001) {
        nx = c.x + (dx / d) * min;
        nz = c.z + (dz / d) * min;
      }
    }
    nx = THREE.MathUtils.clamp(nx, b.minX, b.maxX);
    nz = THREE.MathUtils.clamp(nz, b.minZ, b.maxZ);

    pos.x = nx;
    pos.z = nz;
    const moving = len > 0.05;
    bob += dt * (moving ? 9 : 0);
    camera.position.set(pos.x, EYE + (moving ? Math.sin(bob) * 0.035 : 0), pos.z);
    // leve balanceo y "kick" de FOV al caminar: la cámara se siente viva
    const roll = moving ? Math.sin(bob * 0.5) * 0.008 : 0;
    camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
    const targetFov = moving ? baseFov + 4 : baseFov;
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 6);
      camera.updateProjectionMatrix();
    }

    if (moving) {
      stepT += dt;
      if (stepT > 0.42) {
        stepT = 0;
        audio?.step();
      }
    } else {
      stepT = 0.42;
    }
  }

  function update(dt) {
    if (enabled && !locked) move(dt);
    updateFocus();
  }

  return {
    update,
    get focused() {
      return focused;
    },
    setEnabled(v) {
      enabled = v;
      if (v) {
        camera.position.copy(pos);
        camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
      }
    },
    setLocked(v) {
      locked = v;
      if (!v) return;
      setFocus(null);
      clearTimeout(flashTimer);
      flashTimer = 0;
      showPrompt('');
    },
    setPose(x, z, yawVal = yaw) {
      pos.set(x, EYE, z);
      yaw = yawVal;
      pitch = 0;
      camera.position.copy(pos);
      camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    },
    get position() {
      return pos;
    },
    getYaw: () => yaw,
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}
