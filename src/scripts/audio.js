/**
 * Sonido sintetizado con WebAudio: sin archivos que descargar, funciona offline.
 * El AudioContext se crea con el primer gesto del usuario (botón "Entrar").
 */
export function createAudio() {
  let ctx = null;
  let master = null;
  let hum = null;
  let muted = false;

  // Voz del estafador: síntesis de voz del navegador (Web Speech API), gratis y sin archivos.
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
  let voice = null;
  function pickVoice() {
    const es = speechSynthesis.getVoices().filter((v) => /^es/i.test(v.lang));
    const male = /raul|raúl|jorge|pablo|diego|enrique|carlos|juan|andr[eé]s|alvaro|álvaro|male|hombre/i;
    const latam = /^es[-_](CO|MX|US|419|AR|CL|PE)/i;
    // preferir voz masculina y latinoamericana (es el estafador); si no, la que haya en español
    voice =
      es.find((v) => latam.test(v.lang) && male.test(v.name)) ||
      es.find((v) => male.test(v.name)) ||
      es.find((v) => latam.test(v.lang)) ||
      es[0] ||
      null;
  }

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    startHum();
    if (canSpeak) {
      pickVoice(); // las voces cargan de forma asíncrona en algunos navegadores
      speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
    }
  }

  // Zumbido ambiente grave (vida de fondo tipo "dentro de la máquina").
  function startHum() {
    hum = ctx.createGain();
    hum.gain.value = 0.05;
    hum.connect(master);
    for (const [freq, detune] of [[55, 0], [55, 6], [110, -4]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 220;
      osc.connect(f).connect(hum);
      osc.start();
    }
  }

  function tone({ freq = 440, to, dur = 0.15, type = 'sine', gain = 0.3, when = 0, attack = 0.005 }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // Un segundo de ruido blanco compartido: base de los susurros (se usa por tramos).
  let noiseBuffer = null;
  function sharedNoise() {
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
  }

  function noise({ dur = 0.2, gain = 0.3, when = 0, cutoff = 1200, type = 'lowpass' }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const n = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur);
  }

  return {
    ensure,
    resume: ensure,
    setMuted(v) {
      muted = v;
      if (master) master.gain.value = v ? 0 : 0.5;
      if (v && canSpeak) speechSynthesis.cancel();
    },
    /** Dice una frase con voz grave y lenta (el estafador). gain 0..1 según la distancia. */
    speak(text, { gain = 1 } = {}) {
      if (!canSpeak || muted || !ctx) return;
      speechSynthesis.cancel(); // nunca encola: una frase a la vez
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.lang = voice?.lang || 'es-CO';
      u.pitch = 0.5; // grave
      u.rate = 0.82; // lento, insinuante
      u.volume = Math.max(0.2, Math.min(1, gain));
      speechSynthesis.speak(u);
    },
    stopVoice() {
      if (canSpeak) speechSynthesis.cancel();
    },
    isMuted: () => muted,
    focus() {
      tone({ freq: 760, dur: 0.06, type: 'triangle', gain: 0.12 });
    },
    step() {
      noise({ dur: 0.08, gain: 0.05, cutoff: 500 });
    },
    key() {
      noise({ dur: 0.03, gain: 0.05, cutoff: 3000, type: 'highpass' });
    },
    good() {
      tone({ freq: 523, dur: 0.12, type: 'sine', gain: 0.25 });
      tone({ freq: 784, dur: 0.16, type: 'sine', gain: 0.22, when: 0.1 });
    },
    danger() {
      tone({ freq: 180, to: 90, dur: 0.22, type: 'sawtooth', gain: 0.22 });
      noise({ dur: 0.12, gain: 0.08, cutoff: 900 });
    },
    alarm() {
      // sirena corta: dos tonos alternados
      for (let i = 0; i < 3; i++) {
        tone({ freq: 620, dur: 0.16, type: 'square', gain: 0.18, when: i * 0.34 });
        tone({ freq: 440, dur: 0.16, type: 'square', gain: 0.18, when: i * 0.34 + 0.17 });
      }
      noise({ dur: 0.5, gain: 0.07, cutoff: 1600 });
    },
    success() {
      [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.2, type: 'sine', gain: 0.22, when: i * 0.11 }));
    },
    power() {
      tone({ freq: 120, to: 600, dur: 0.3, type: 'sawtooth', gain: 0.16 });
    },
    /**
     * Murmullo del estafador: "sílabas" de ruido filtrado como un susurro ininteligible.
     * pan (-1 izquierda … 1 derecha) y gain (0..1, por distancia) lo ubican en el espacio.
     */
    whisper({ pan = 0, gain = 1 } = {}) {
      if (!ctx) return;
      const out = ctx.createGain();
      out.gain.value = 0.9 * gain;
      if (ctx.createStereoPanner) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        out.connect(panner).connect(master);
      } else {
        out.connect(master);
      }
      const buf = sharedNoise();
      let t = ctx.currentTime + 0.02;
      const syllables = 5 + Math.floor(Math.random() * 5);
      for (let i = 0; i < syllables; i++) {
        const dur = 0.07 + Math.random() * 0.11;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1100 + Math.random() * 2300; // formante al azar: suena a habla
        bp.Q.value = 1.3 + Math.random() * 1.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.32, t + dur * 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(bp).connect(g).connect(out);
        src.start(t, Math.random() * 0.8, dur);
        t += dur + 0.03 + Math.random() * 0.08;
      }
    },
  };
}
