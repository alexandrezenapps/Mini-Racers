/**
 * Fast Racers AAA Studio WebAudio Engine & Realistic Racing Synthesizer
 * (`src/audio/WebAudioSynth.js`)
 *
 * Implements:
 * 1. Responsive Engine Revving:
 *    - Real-time Virtual RPM simulation with instant throttle response (rev-up on W / Gas,
 *      pitch-drop and overrun misfires on lift-off, and high-RPM rev-limiter bouncing when
 *      stationary on the starting grid / countdown).
 *    - High-fidelity single-microphone studio stems (`kart_idle_loop.wav`, `kart_cruise_mid_loop.wav`)
 *      blended with a procedural mechanical cylinder pulse resonator + intake growl filter
 *      for visceral physical rumble without distortion.
 *    - Formula 1 boost wind-up and overrun sputter backfires (`engine_sputter_burst_1..3.wav`).
 *
 * 2. Multi-Component Tire Screeching:
 *    - Sampled rubber micro-chatter & asphalt scrub loop (`kart_tire_drift_loop.wav`).
 *    - Procedural resonant bandpass noise generator (2200 Hz - 3400 Hz) simulating asphalt shear.
 *    - Dual harmonic stick-slip squeal oscillators with subtle FM vibrato (2420 Hz & 3150 Hz)
 *      for genuine high-pitched rubber howling during lateral drifts, hard braking lockup, and tight corner scrub.
 *    - Transient tire bite chirps when snapping into a slide or slamming the brakes at speed.
 *
 * 3. Multi-Layered Collision & Barrier Friction Effects:
 *    - Multi-layered transient impacts (`playRailImpact`):
 *      * 'crash': deep sub-bass chassis thud (130->36 Hz), crunch deformation burst,
 *        and resonant ringing tubular rail partials (860 Hz, 1380 Hz, 2240 Hz).
 *      * 'graze': shallow barrier brush with high metallic ping (1560 Hz & 2620 Hz).
 *      * 'curb': punchy suspension hop bump (175->55 Hz).
 *    - Continuous rail scraping & grinding synthesis with sparking metallic friction when pinned against rails.
 */

const LOOP_STEM_FILES = {
  idle: 'kart_idle_loop.wav',
  cruise: 'kart_cruise_mid_loop.wav',
  drift: 'kart_tire_drift_loop.wav',
  curb: 'curb_rumble_loop.wav',
};

const ONESHOT_STEM_FILES = {
  sputter: [
    'engine_sputter_burst_1.wav',
    'engine_sputter_burst_2.wav',
    'engine_sputter_burst_3.wav',
  ],
};

/**
 * Creates a looping 1.5-second white/pink noise buffer for procedural tire screech,
 * collision crunch, and continuous guardrail scrape synthesis.
 * @param {!AudioContext} targetCtx
 * @return {!AudioBuffer}
 */
function createProceduralNoiseBuffer(targetCtx) {
  const sampleRate = targetCtx.sampleRate || 44100;
  const bufferSize = Math.floor(sampleRate * 1.5);
  const buffer = targetCtx.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;

  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2.0 - 1.0;
    // 3-pole pinking filter for smooth, natural friction texture
    b0 = 0.99765 * b0 + white * 0.0990460;
    b1 = 0.96300 * b1 + white * 0.2965164;
    b2 = 0.57000 * b2 + white * 1.0526913;
    const pink = b0 + b1 + b2 + white * 0.1848;
    data[i] = Math.max(-1.0, Math.min(1.0, pink * 0.22));
  }
  return buffer;
}

/**
 * Creates the hybrid single-mic + procedural racing audio engine.
 * @param {!Object=} options
 * @return {!Object}
 */
export function createDeskRacerHybridAudio(options = {}) {
  const baseUrl = (options.baseUrl || '/assets/audio').replace(/\/$/, '');
  const masterVolume = options.masterVolume ?? 0.32;
  const cacheBust = options.cacheBust || 'v=9';

  let ctx = null;
  let enabled = false;
  let stemsLoaded = false;
  let loadingPromise = null;
  let noiseBuffer = null;

  let masterGain = null;
  let misfireDuckGain = null;
  let lowShelfFilter = null;
  let engineBusFilter = null;
  let presencePeakFilter = null;

  // Active looping AudioBufferSourceNodes & their GainNodes
  const loopNodes = {};
  const oneShotBuffers = { sputter: [] };

  // --- ENGINE REVVING SYNTHESIS NODES ---
  // Clean LFE Sub-Harmonic Sine Resonator (<95 Hz)
  let rumbleSubOsc = null;
  let rumbleLowpass = null;
  let rumbleOutGain = null;

  // Secondary mechanical intake pulse growl oscillator for immediate revving bite
  let intakeGrowlOsc = null;
  let intakeGrowlFilter = null;
  let intakeGrowlGain = null;

  // --- TIRE SCREECHING SYNTHESIS NODES ---
  let tireNoiseSrc = null;
  let tireNoiseFilter = null;
  let tireNoiseGain = null;

  let tireSquealOsc1 = null;
  let tireSquealOsc2 = null;
  let tireSquealLfo = null;
  let tireSquealLfoGain = null;
  let tireSquealGain = null;

  // --- CONTINUOUS RAIL SCRAPE NODES ---
  let railScrapeNoiseSrc = null;
  let railScrapeFilter = null;
  let railScrapeGain = null;

  // User-tunable texture parameters
  let userRumbleAmount = options.rumbleAmount ?? 1.0;
  let userSputterAmount = options.sputterAmount ?? 1.0;

  // Engine RPM and Revving Telemetry
  let virtualRpm = 0.0; // 0.0 = idle, 1.0 = nominal top speed, >1.0 = redline / boost
  let revLimiterTimer = 0.0;
  let prevThrottle = 0.0;
  let prevIsDrifting = false;
  let prevIsBraking = false;
  let lastChirpTime = 0.0;

  // Smoothed telemetry state
  let smoothNormSpeed = 0.0;
  let smoothAccelRate = 0.0;
  let smoothBoostBlend = 0.0;
  let smoothHillAndCurlLoad = 0.0;
  let smoothSkidIntensity = 0.0;
  let smoothScrapeIntensity = 0.0;
  let prevSpeed = 0.0;
  let prevTimeMs = performance.now();
  let nextSputterTime = 0;
  let sputterCount = 0;

  let lastDiag = {};
  const rawBufferPromises = new Map();
  const decodedBufferCache = new Map();
  let preloadPromise = null;

  function fetchRawArrayBuffer(url) {
    const sep = url.includes('?') ? '&' : '?';
    const fullUrl = `${url}${sep}${cacheBust}`;
    if (!rawBufferPromises.has(fullUrl)) {
      const p = fetch(fullUrl).then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
        return resp.arrayBuffer();
      });
      rawBufferPromises.set(fullUrl, p);
    }
    return rawBufferPromises.get(fullUrl);
  }

  async function fetchAndDecodeBuffer(url, decodeCtx = ctx) {
    const sep = url.includes('?') ? '&' : '?';
    const fullUrl = `${url}${sep}${cacheBust}`;
    if (decodedBufferCache.has(fullUrl)) {
      return decodedBufferCache.get(fullUrl);
    }
    const arr = await fetchRawArrayBuffer(url);
    const targetCtx = decodeCtx || ctx;
    if (!targetCtx) return null;
    const decoded = await targetCtx.decodeAudioData(arr.slice(0));
    decodedBufferCache.set(fullUrl, decoded);
    return decoded;
  }

  function preload() {
    if (preloadPromise) return preloadPromise;
    preloadPromise = (async () => {
      try {
        const OfflineCtx =
          window.OfflineAudioContext || window.webkitAudioContext;
        const offlineCtx = OfflineCtx ? new OfflineCtx(2, 1, 44100) : null;
        const allUrls = [
          ...Object.values(LOOP_STEM_FILES).map((f) => `${baseUrl}/${f}`),
          ...ONESHOT_STEM_FILES.sputter.map((f) => `${baseUrl}/${f}`),
        ];
        await Promise.all(
          allUrls.map(async (url) => {
            try {
              if (offlineCtx) {
                await fetchAndDecodeBuffer(url, offlineCtx);
              } else {
                await fetchRawArrayBuffer(url);
              }
            } catch (_) {
              // Ignore individual stem preload errors
            }
          })
        );
      } catch (_) {
        // Fallback to on-demand loading in loadAllStems
      }
    })();
    return preloadPromise;
  }

  async function loadAllStems() {
    if (!ctx || loadingPromise) return loadingPromise;
    loadingPromise = (async () => {
      try {
        const activeLoopKeys = ['idle', 'cruise', 'drift', 'curb'];
        await Promise.all(
          activeLoopKeys.map(async (key) => {
            const filename = LOOP_STEM_FILES[key];
            try {
              const buffer = await fetchAndDecodeBuffer(`${baseUrl}/${filename}`);
              if (!buffer) return;
              const src = ctx.createBufferSource();
              src.buffer = buffer;
              src.loop = true;

              const gain = ctx.createGain();
              gain.gain.value = 0.0;

              src.connect(gain);
              if (key === 'drift' || key === 'curb') {
                gain.connect(masterGain);
              } else {
                gain.connect(misfireDuckGain);
              }

              src.start(0, 0);
              loopNodes[key] = { src, gain, buffer };
            } catch (e) {
              console.warn(`[WebAudioSynth] Could not load loop stem ${filename}:`, e);
            }
          })
        );

        for (const file of ONESHOT_STEM_FILES.sputter) {
          try {
            const buf = await fetchAndDecodeBuffer(`${baseUrl}/${file}`);
            if (buf) oneShotBuffers.sputter.push(buf);
          } catch (_) {}
        }

        stemsLoaded = Boolean(loopNodes.cruise);
      } catch (err) {
        console.warn('[WebAudioSynth] Stem loading error:', err);
      }
    })();
    return loadingPromise;
  }

  function initAudio() {
    if (ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    ctx = new AudioCtx();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.0001;
    masterGain.connect(ctx.destination);

    // 1. Master presence peak (1.55 kHz)
    presencePeakFilter = ctx.createBiquadFilter();
    presencePeakFilter.type = 'peaking';
    presencePeakFilter.frequency.value = 1550;
    presencePeakFilter.Q.value = 1.0;
    presencePeakFilter.gain.value = 1.8;
    presencePeakFilter.connect(masterGain);

    // 2. Formant-compensating engine low-pass filter
    engineBusFilter = ctx.createBiquadFilter();
    engineBusFilter.type = 'lowpass';
    engineBusFilter.frequency.value = 6200;
    engineBusFilter.Q.value = 0.707;
    engineBusFilter.connect(presencePeakFilter);

    // 3. Low-shelf filter for exhaust rumble
    lowShelfFilter = ctx.createBiquadFilter();
    lowShelfFilter.type = 'lowshelf';
    lowShelfFilter.frequency.value = 98;
    lowShelfFilter.gain.value = 3.5;
    lowShelfFilter.connect(engineBusFilter);

    // 4. Misfire duck gain node (brief dips on cylinder skip or collision hit)
    misfireDuckGain = ctx.createGain();
    misfireDuckGain.gain.value = 1.0;
    misfireDuckGain.connect(lowShelfFilter);

    // 5. Clean <95 Hz sub-harmonic sine resonator
    rumbleSubOsc = ctx.createOscillator();
    rumbleSubOsc.type = 'sine';
    rumbleSubOsc.frequency.value = 55.0;

    rumbleLowpass = ctx.createBiquadFilter();
    rumbleLowpass.type = 'lowpass';
    rumbleLowpass.frequency.value = 95.0;
    rumbleLowpass.Q.value = 0.707;

    rumbleOutGain = ctx.createGain();
    rumbleOutGain.gain.value = 0.0;

    rumbleSubOsc.connect(rumbleLowpass);
    rumbleLowpass.connect(rumbleOutGain);
    rumbleOutGain.connect(masterGain);
    rumbleSubOsc.start();

    // 6. Responsive Engine Revving Intake Growl Synthesizer
    // A secondary harmonic oscillator that tracks throttle and virtual RPM,
    // giving that aggressive "VROOOM" mechanical throatiness when stepping on the throttle!
    intakeGrowlOsc = ctx.createOscillator();
    intakeGrowlOsc.type = 'sawtooth';
    intakeGrowlOsc.frequency.value = 85.0;

    intakeGrowlFilter = ctx.createBiquadFilter();
    intakeGrowlFilter.type = 'lowpass';
    intakeGrowlFilter.frequency.value = 380;
    intakeGrowlFilter.Q.value = 1.6;

    intakeGrowlGain = ctx.createGain();
    intakeGrowlGain.gain.value = 0.0;

    intakeGrowlOsc.connect(intakeGrowlFilter);
    intakeGrowlFilter.connect(intakeGrowlGain);
    intakeGrowlGain.connect(misfireDuckGain);
    intakeGrowlOsc.start();

    // 7. Procedural Tire Screech Synthesizer
    noiseBuffer = createProceduralNoiseBuffer(ctx);

    tireNoiseSrc = ctx.createBufferSource();
    tireNoiseSrc.buffer = noiseBuffer;
    tireNoiseSrc.loop = true;

    tireNoiseFilter = ctx.createBiquadFilter();
    tireNoiseFilter.type = 'bandpass';
    tireNoiseFilter.frequency.value = 2800;
    tireNoiseFilter.Q.value = 4.8;

    tireNoiseGain = ctx.createGain();
    tireNoiseGain.gain.value = 0.0;

    tireNoiseSrc.connect(tireNoiseFilter);
    tireNoiseFilter.connect(tireNoiseGain);
    tireNoiseGain.connect(masterGain);
    tireNoiseSrc.start();

    // Dual stick-slip harmonic squeal oscillators (rubber block slip frequencies)
    tireSquealOsc1 = ctx.createOscillator();
    tireSquealOsc1.type = 'sine';
    tireSquealOsc1.frequency.value = 2420;

    tireSquealOsc2 = ctx.createOscillator();
    tireSquealOsc2.type = 'triangle';
    tireSquealOsc2.frequency.value = 3150;

    // Subtle 44 Hz stick-slip frequency modulation (vibrato) for realistic chatter
    tireSquealLfo = ctx.createOscillator();
    tireSquealLfo.type = 'sine';
    tireSquealLfo.frequency.value = 44.0;

    tireSquealLfoGain = ctx.createGain();
    tireSquealLfoGain.gain.value = 65.0;

    tireSquealLfo.connect(tireSquealLfoGain);
    tireSquealLfoGain.connect(tireSquealOsc1.frequency);
    tireSquealLfoGain.connect(tireSquealOsc2.frequency);

    tireSquealGain = ctx.createGain();
    tireSquealGain.gain.value = 0.0;

    tireSquealOsc1.connect(tireSquealGain);
    tireSquealOsc2.connect(tireSquealGain);
    tireSquealGain.connect(masterGain);

    tireSquealLfo.start();
    tireSquealOsc1.start();
    tireSquealOsc2.start();

    // 8. Continuous Guardrail Scrape Friction Synthesizer
    railScrapeNoiseSrc = ctx.createBufferSource();
    railScrapeNoiseSrc.buffer = noiseBuffer;
    railScrapeNoiseSrc.loop = true;

    railScrapeFilter = ctx.createBiquadFilter();
    railScrapeFilter.type = 'peaking';
    railScrapeFilter.frequency.value = 3400;
    railScrapeFilter.Q.value = 3.2;
    railScrapeFilter.gain.value = 6.0;

    railScrapeGain = ctx.createGain();
    railScrapeGain.gain.value = 0.0;

    railScrapeNoiseSrc.connect(railScrapeFilter);
    railScrapeFilter.connect(railScrapeGain);
    railScrapeGain.connect(masterGain);
    railScrapeNoiseSrc.start();

    loadAllStems();
  }

  /**
   * Plays a quick, sharp tire bite chirp when breaking traction into a slide
   * or when slamming the brakes at speed.
   * @param {number=} intensity
   */
  function playTireChirp(intensity = 0.8) {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - lastChirpTime < 0.16) return;
    lastChirpTime = now;

    const strength = Math.max(0.2, Math.min(1.2, intensity));
    const dur = 0.048;

    const chirpOsc = ctx.createOscillator();
    chirpOsc.type = 'sine';
    chirpOsc.frequency.setValueAtTime(2950 * (0.95 + 0.1 * Math.random()), now);
    chirpOsc.frequency.exponentialRampToValueAtTime(1750, now + dur);

    const chirpGain = ctx.createGain();
    const peak = Math.min(0.24, 0.16 * strength);
    chirpGain.gain.setValueAtTime(0.0001, now);
    chirpGain.gain.linearRampToValueAtTime(peak, now + 0.004);
    chirpGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    const chirpFilter = ctx.createBiquadFilter();
    chirpFilter.type = 'bandpass';
    chirpFilter.frequency.setValueAtTime(2400, now);
    chirpFilter.Q.setValueAtTime(3.5, now);

    chirpOsc.connect(chirpGain);
    chirpGain.connect(chirpFilter);
    chirpFilter.connect(masterGain);

    chirpOsc.start(now);
    chirpOsc.stop(now + dur + 0.01);
  }

  /**
   * Triggers a clean, subtle cylinder stumble + exhaust pop without cluttering cruise stem.
   */
  function fireSingleRealSputterPop(
    delayS = 0.0,
    intensity = 1.0,
    mode = 'idle'
  ) {
    if (!ctx || !enabled || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + delayS;
    const isIdleStumble = mode === 'idle';
    const isOverrunBackfire = mode === 'overrun';
    const v = 0.92 + 0.16 * Math.random();

    if (misfireDuckGain) {
      misfireDuckGain.gain.setValueAtTime(1.0, t0);
      misfireDuckGain.gain.linearRampToValueAtTime(
        isIdleStumble ? 0.55 : 0.42,
        t0 + 0.008
      );
      misfireDuckGain.gain.linearRampToValueAtTime(1.0, t0 + 0.036);
    }

    const tPop = t0 + 0.012;
    const dur = isOverrunBackfire ? 0.050 : 0.038;

    const thumpOsc = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thumpOsc.type = 'sine';
    thumpOsc.frequency.setValueAtTime((isIdleStumble ? 76.0 : 98.0) * v, tPop);
    thumpOsc.frequency.exponentialRampToValueAtTime(
      (isIdleStumble ? 40.0 : 45.0) * v,
      tPop + dur
    );

    const peakGain = Math.min(0.30, (isIdleStumble ? 0.12 : 0.18) * intensity);
    thumpGain.gain.setValueAtTime(0.0001, tPop);
    thumpGain.gain.linearRampToValueAtTime(peakGain, tPop + 0.003);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, tPop + dur);

    thumpOsc.connect(thumpGain);
    thumpGain.connect(masterGain);
    thumpOsc.start(tPop);
    thumpOsc.stop(tPop + dur + 0.01);

    if (
      (isOverrunBackfire || isIdleStumble) &&
      oneShotBuffers.sputter.length > 0
    ) {
      const buf = isIdleStumble
        ? oneShotBuffers.sputter[0]
        : oneShotBuffers.sputter[
            1 +
              Math.floor(
                Math.random() * Math.max(1, oneShotBuffers.sputter.length - 1)
              )
          ] || oneShotBuffers.sputter[oneShotBuffers.sputter.length - 1];
      const sliceDur = 0.16 + 0.10 * Math.random();
      const maxOffset = Math.max(0.0, buf.duration - sliceDur - 0.05);
      const offset = Math.random() * maxOffset;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 0.94 + 0.12 * Math.random();

      const g = ctx.createGain();
      const gPeak = Math.min(0.55, (isIdleStumble ? 0.22 : 0.32) * intensity);
      g.gain.setValueAtTime(0.0001, tPop);
      g.gain.linearRampToValueAtTime(gPeak, tPop + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, tPop + sliceDur);

      src.connect(g);
      g.connect(presencePeakFilter);
      src.start(tPop, offset, sliceDur + 0.02);
    }
  }

  function triggerSputterBurst(intensity = 1.0, mode = 'auto') {
    if (!ctx || !enabled) return;
    sputterCount += 1;
    let resolvedMode = mode;
    if (resolvedMode === 'auto') {
      if (smoothAccelRate < -0.25 && smoothNormSpeed > 0.18) {
        resolvedMode = 'overrun';
      } else if (smoothNormSpeed < 0.15) {
        resolvedMode = 'idle';
      } else {
        resolvedMode = 'accel';
      }
    }
    const numPops =
      resolvedMode === 'overrun' ? 1 + Math.floor(Math.random() * 2) : 1;
    let offset = 0.0;
    for (let i = 0; i < numPops; i++) {
      fireSingleRealSputterPop(
        offset,
        intensity * (0.85 + 0.20 * Math.random()),
        resolvedMode
      );
      offset += 0.075 + 0.065 * Math.random();
    }
  }

  function setEnabled(state) {
    enabled = Boolean(state);
    if (enabled) {
      initAudio();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume();
      }
      if (masterGain && ctx) {
        masterGain.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.05);
      }
    } else if (masterGain && ctx) {
      masterGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
    }
    return enabled;
  }

  function toggle() {
    return setEnabled(!enabled);
  }

  /**
   * Main per-frame audio telemetry update.
   * Dynamically models Engine Revving, Tire Screeching, and Collision Grinds.
   * @param {!Object} state
   */
  function update(state) {
    if (!enabled || !ctx || ctx.state !== 'running') return;

    const nowMs = performance.now();
    const dt = Math.min(0.1, Math.max(0.004, (nowMs - prevTimeMs) * 0.001));
    prevTimeMs = nowMs;
    const now = ctx.currentTime;

    const rawSpeed = Math.abs(state.speed || 0.0);
    const targetNormSpeed = Math.min(1.45, rawSpeed / 0.204);
    const rawAccel = (targetNormSpeed - prevSpeed) / dt;
    prevSpeed = targetNormSpeed;

    const speedAlpha = 1.0 - Math.exp(-9.5 * dt);
    const accelAlpha = 1.0 - Math.exp(-6.5 * dt);
    const boostAlpha = 1.0 - Math.exp(-6.0 * dt);
    const loadAlpha = 1.0 - Math.exp(-7.5 * dt);

    smoothNormSpeed += (targetNormSpeed - smoothNormSpeed) * speedAlpha;
    smoothAccelRate += (rawAccel - smoothAccelRate) * accelAlpha;

    const isBoostActive = (state.boostActive || 0) > 0 || rawSpeed > 0.245;
    const targetBoost = isBoostActive ? 1.0 : 0.0;
    smoothBoostBlend += (targetBoost - smoothBoostBlend) * boostAlpha;

    // Track input throttle and braking
    const throttle = typeof state.throttle === 'number'
      ? state.throttle
      : (state.keys && state.keys.forward ? 1.0 : 0.0) - (state.keys && state.keys.backward ? 1.0 : 0.0);
    const isAccelerating = throttle > 0.05 || (state.keys && state.keys.forward);
    const isBraking = Boolean(state.isBraking) || (throttle < -0.05 && rawSpeed > 0.02);

    // =========================================================================
    // 1. DYNAMIC ENGINE REVVING & VIRTUAL RPM SIMULATION
    // =========================================================================
    // At zero speed / starting grid / F1 countdown:
    // If the user holds gas (W), the engine revs up quickly to high RPM (~0.95 - 1.15)
    // with rev-limiter oscillation and pops!
    let targetRpm = 0.0;
    const isCountdownOrStopped = Boolean(state.countdownLocked) || rawSpeed < 0.015;

    if (isCountdownOrStopped) {
      if (isAccelerating) {
        // Rev-limiter bounce oscillation
        const limiterOsc = 0.08 * Math.sin(nowMs * 0.038);
        targetRpm = 0.98 + limiterOsc;

        // Rev limiter micro-pops every ~110ms when held at redline
        revLimiterTimer += dt;
        if (revLimiterTimer > 0.11) {
          revLimiterTimer = 0.0;
          triggerSputterBurst(0.55 * userSputterAmount, 'overrun');
        }
      } else {
        targetRpm = 0.0;
        revLimiterTimer = 0.0;
      }
    } else {
      // In motion: RPM leads road speed during acceleration, drops on lift-off/braking
      const speedRpmBase = Math.min(1.10, smoothNormSpeed);
      const throttleSurge = isAccelerating ? 0.24 * Math.max(0.5, throttle) : isBraking ? -0.22 : 0.0;
      const boostSurge = 0.32 * smoothBoostBlend;
      targetRpm = Math.max(0.0, Math.min(1.48, speedRpmBase + throttleSurge + boostSurge));
      revLimiterTimer = 0.0;
    }

    // Fast rev-up attack rate (14.0) vs natural roll-off decay (7.5)
    const rpmAttackRate = targetRpm > virtualRpm ? 14.0 : (isBraking ? 12.0 : 7.0);
    const rpmAlpha = 1.0 - Math.exp(-rpmAttackRate * dt);
    virtualRpm += (targetRpm - virtualRpm) * rpmAlpha;

    // Detect sudden lift-off from high RPM for authentic overrun misfire pops
    if (prevThrottle > 0.4 && throttle <= 0.0 && virtualRpm > 0.35) {
      triggerSputterBurst(0.9 * userSputterAmount, 'overrun');
    }
    prevThrottle = throttle;

    // Track slope & Cat/Lamp spiral curl load
    const slope = typeof state.slope === 'number'
      ? state.slope
      : state.tangent && typeof state.tangent.y === 'number'
      ? state.tangent.y
      : 0.0;
    const sPos = typeof state.s === 'number' ? ((state.s % 3.12) + 3.12) % 3.12 : -1.0;

    let spiralCurlLoad = 0.0;
    if (sPos >= 0.40 && sPos <= 1.34) {
      const uCat = (sPos - 0.40) / 0.94;
      const entryFade = Math.min(1.0, uCat / 0.16);
      const exitFade = Math.min(1.0, (1.0 - uCat) / 0.28);
      const climbShape = 0.35 + 0.65 * Math.exp(-Math.pow((uCat - 0.32) / 0.28, 2.0));
      spiralCurlLoad = entryFade * exitFade * climbShape;
    } else if (sPos >= 1.46 && sPos <= 2.48) {
      const uLamp = (sPos - 1.46) / 1.02;
      const entryFade = Math.min(1.0, uLamp / 0.16);
      const exitFade = Math.min(1.0, (1.0 - uLamp) / 0.26);
      const climbShape = 0.35 + 0.65 * Math.exp(-Math.pow((uLamp - 0.38) / 0.28, 2.0));
      spiralCurlLoad = entryFade * exitFade * climbShape;
    }

    const uphillLug = slope > 0.0 ? slope * 0.72 : slope * 0.32;
    const targetHillAndCurlLoad = Math.max(-0.12, Math.min(0.36, uphillLug + spiralCurlLoad * 0.18));
    smoothHillAndCurlLoad += (targetHillAndCurlLoad - smoothHillAndCurlLoad) * loadAlpha;

    const decelFactor = Math.min(
      1.0,
      Math.max(0.0, (-smoothAccelRate - 0.06) / 0.55 + Math.max(0.0, smoothHillAndCurlLoad) * 0.75)
    );

    // Map Virtual RPM to Cruise stem playback rate (0.68x -> 1.48x)
    const baseCruiseRate = 0.68 + virtualRpm * 0.58;
    const targetCruiseRate = Math.max(
      0.65,
      Math.min(1.48, baseCruiseRate - smoothHillAndCurlLoad * 0.6 + 0.15 * smoothBoostBlend)
    );
    const targetF0 = Math.round(122.0 * targetCruiseRate);

    const timeConst = 0.035;

    // Crossfade between stationary Idle loop and high-rev Cruise loop:
    // If stopped/countdown and not pressing gas: pure Idle loop.
    // As virtual RPM rises (either from revving with W or driving), crossfade smoothly into Cruise!
    const effectiveRevLevel = Math.max(smoothNormSpeed, virtualRpm);
    const idleCruiseMix = Math.min(1.0, Math.max(0.0, effectiveRevLevel / 0.18));

    if (loopNodes.idle && loopNodes.cruise) {
      const idleGain = 0.96 * Math.cos(0.5 * Math.PI * idleCruiseMix);
      const cruiseGain = 0.96 * Math.sin(0.5 * Math.PI * idleCruiseMix);
      loopNodes.idle.gain.gain.setTargetAtTime(idleGain, now, timeConst);
      loopNodes.idle.src.playbackRate.setTargetAtTime(1.0 + 0.15 * virtualRpm, now, timeConst);

      loopNodes.cruise.gain.gain.setTargetAtTime(cruiseGain, now, timeConst);
      loopNodes.cruise.src.playbackRate.setTargetAtTime(targetCruiseRate, now, timeConst);
    } else if (loopNodes.cruise) {
      loopNodes.cruise.gain.gain.setTargetAtTime(0.96, now, timeConst);
      loopNodes.cruise.src.playbackRate.setTargetAtTime(targetCruiseRate, now, timeConst);
    }

    // Secondary Intake Growl Oscillator (gives punchy revving throatiness on throttle)
    if (intakeGrowlOsc && intakeGrowlGain && intakeGrowlFilter) {
      const growlFreq = Math.min(260.0, Math.max(72.0, targetF0 * 0.92));
      intakeGrowlOsc.frequency.setTargetAtTime(growlFreq, now, 0.03);

      const targetIntakeCutoff = Math.min(650, 240 + virtualRpm * 380);
      intakeGrowlFilter.frequency.setTargetAtTime(targetIntakeCutoff, now, 0.04);

      // Swells aggressively when accelerating/revving
      const intakeGainVal = isAccelerating
        ? Math.min(0.24, 0.06 + 0.14 * virtualRpm)
        : Math.min(0.04, 0.02 * virtualRpm);
      intakeGrowlGain.gain.setTargetAtTime(intakeGainVal, now, 0.04);
    }

    // Formant-Compensating EQ & Low-Shelf Resonance
    const pitchAboveOne = Math.max(0.0, targetCruiseRate - 0.95);
    const lugWarmth = Math.max(0.0, smoothHillAndCurlLoad) * 9.5;
    const shelfDb = userRumbleAmount * (2.8 + 8.5 * pitchAboveOne + lugWarmth + (isAccelerating ? 2.5 : 0.0));
    if (lowShelfFilter) {
      lowShelfFilter.gain.setTargetAtTime(Math.min(10.5, shelfDb), now, 0.04);
    }

    if (presencePeakFilter) {
      const presDb = Math.max(
        -1.5,
        (targetCruiseRate < 0.92 ? 2.4 : 2.0 - 3.0 * pitchAboveOne) -
          Math.max(0.0, smoothHillAndCurlLoad) * 8.0
      );
      presencePeakFilter.gain.setTargetAtTime(presDb, now, 0.04);
    }

    const slowCurlDarken = Math.max(0.0, 0.96 - targetCruiseRate) * 9500;
    const targetCutoff = Math.max(
      2150,
      Math.min(
        6800,
        6400 - 7200 * Math.max(0.0, targetCruiseRate - 1.04) - slowCurlDarken - 650 * decelFactor
      )
    );
    engineBusFilter.frequency.setTargetAtTime(targetCutoff, now, 0.04);

    // Sub-harmonic sine (<95 Hz)
    if (rumbleSubOsc && rumbleOutGain) {
      const subHz = Math.min(82.0, Math.max(40.0, targetF0 * 0.5));
      rumbleSubOsc.frequency.setTargetAtTime(subHz, now, 0.03);
      const subGain = Math.min(
        0.20,
        0.075 * userRumbleAmount * (0.85 + 0.35 * Math.min(1.0, virtualRpm) + Math.max(0.0, smoothHillAndCurlLoad) * 0.8)
      );
      rumbleOutGain.gain.setTargetAtTime(subGain, now, 0.04);
    }

    // =========================================================================
    // 2. TIRE SCREECHING & SKID MODULATION
    // =========================================================================
    // Trigger conditions:
    // a. Lateral drift: state.isDrifting, driftAngle, or lateralVel
    // b. Hard braking skid: braking while moving forward at speed
    // c. High-speed cornering scrub: steering into tight curve at speed
    const isDrifting = Boolean(state.isDrifting);
    const driftAngleMag = Math.abs(state.driftAngle || 0.0);
    const lateralVelMag = Math.abs(state.lateralVel || 0.0);

    const driftSkid = isDrifting ? Math.min(1.0, 0.35 + driftAngleMag * 2.8 + lateralVelMag * 14.0) : 0.0;
    const brakeSkid = isBraking && smoothNormSpeed > 0.12 ? Math.min(1.0, smoothNormSpeed / 0.55) * 0.82 : 0.0;
    const cornerScrub = Math.abs(state.signedCurvature || 0.0) * smoothNormSpeed > 0.18 ? 0.28 : 0.0;

    const rawSkid = Math.max(driftSkid, brakeSkid, cornerScrub);
    const skidAlpha = 1.0 - Math.exp((rawSkid > smoothSkidIntensity ? 16.0 : 9.0) * -dt);
    smoothSkidIntensity += (rawSkid - smoothSkidIntensity) * skidAlpha;

    // Trigger instant tire bite chirp on rising edge of drift or brake
    if ((isDrifting && !prevIsDrifting) || (isBraking && !prevIsBraking && smoothNormSpeed > 0.20)) {
      playTireChirp(Math.max(0.6, smoothSkidIntensity));
    }
    prevIsDrifting = isDrifting;
    prevIsBraking = isBraking;

    // A. Sampled drift loop (kart_tire_drift_loop.wav)
    const targetDriftGain = smoothSkidIntensity > 0.02
      ? Math.min(0.55, smoothSkidIntensity * 0.52 * Math.min(1.0, smoothNormSpeed / 0.25))
      : 0.0;
    if (loopNodes.drift) {
      loopNodes.drift.gain.gain.setTargetAtTime(targetDriftGain, now, 0.035);
      loopNodes.drift.src.playbackRate.setTargetAtTime(0.92 + 0.22 * smoothNormSpeed, now, 0.04);
    }

    // B. Procedural resonant bandpass noise screech (rubber block shear texture)
    if (tireNoiseGain && tireNoiseFilter) {
      const targetNoiseGain = smoothSkidIntensity > 0.05
        ? Math.min(0.35, (smoothSkidIntensity - 0.05) * 0.36)
        : 0.0;
      tireNoiseGain.gain.setTargetAtTime(targetNoiseGain, now, 0.035);

      const screechCenterHz = 2400 + smoothNormSpeed * 650 + smoothSkidIntensity * 400;
      tireNoiseFilter.frequency.setTargetAtTime(screechCenterHz, now, 0.04);
    }

    // C. Dual stick-slip harmonic squeal oscillators (authentic high-pitch rubber howling)
    if (tireSquealGain) {
      const targetSquealGain = smoothSkidIntensity > 0.15
        ? Math.min(0.24, (smoothSkidIntensity - 0.15) * 0.28)
        : 0.0;
      tireSquealGain.gain.setTargetAtTime(targetSquealGain, now, 0.04);
    }

    // =========================================================================
    // 3. CURB RUMBLE & CONTINUOUS GUARDRAIL SCRAPING
    // =========================================================================
    const targetCurbGain = (state.curbRumble || 0) > 0.05
      ? Math.min(0.48, state.curbRumble * 0.48)
      : 0.0;
    if (loopNodes.curb) {
      loopNodes.curb.gain.gain.setTargetAtTime(targetCurbGain, now, 0.03);
      loopNodes.curb.src.playbackRate.setTargetAtTime(0.88 + 0.32 * smoothNormSpeed, now, 0.04);
    }

    // Continuous Guardrail Scrape Friction (when sliding or pinned along barrier)
    const rawScrape = Number(state.railScrapeIntensity || 0.0);
    const scrapeAlpha = 1.0 - Math.exp((rawScrape > smoothScrapeIntensity ? 14.0 : 8.0) * -dt);
    smoothScrapeIntensity += (rawScrape - smoothScrapeIntensity) * scrapeAlpha;

    if (railScrapeGain && railScrapeFilter) {
      const scrapeGainVal = smoothScrapeIntensity > 0.05
        ? Math.min(0.38, smoothScrapeIntensity * 0.38)
        : 0.0;
      railScrapeGain.gain.setTargetAtTime(scrapeGainVal, now, 0.035);

      const scrapeFreq = 3000 + smoothNormSpeed * 1200;
      railScrapeFilter.frequency.setTargetAtTime(scrapeFreq, now, 0.04);
    }

    // Subtle overrun sputter scheduler
    if (userSputterAmount > 0.05 && now >= nextSputterTime) {
      if (decelFactor > 0.22 && smoothNormSpeed > 0.22) {
        triggerSputterBurst(userSputterAmount * 0.85, 'overrun');
        nextSputterTime = now + (0.60 + 0.75 * Math.random()) / Math.max(0.3, userSputterAmount);
      } else if (smoothNormSpeed < 0.10 && virtualRpm < 0.2) {
        triggerSputterBurst(userSputterAmount * 0.45, 'idle');
        nextSputterTime = now + (3.20 + 2.50 * Math.random()) / Math.max(0.3, userSputterAmount);
      } else {
        nextSputterTime = now + 0.35;
      }
    }

    lastDiag = {
      stemsLoaded,
      virtualRpm: Number(virtualRpm.toFixed(2)),
      normSpeed: Number(smoothNormSpeed.toFixed(2)),
      cruisePlaybackRate: Number(targetCruiseRate.toFixed(2)),
      skidIntensity: Number(smoothSkidIntensity.toFixed(2)),
      scrapeIntensity: Number(smoothScrapeIntensity.toFixed(2)),
      sputterCount,
    };
  }

  function playLapChime() {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.001, now + idx * 0.07);
      g.gain.exponentialRampToValueAtTime(0.12, now + idx * 0.07 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.07 + 0.35);
      o.connect(g);
      g.connect(masterGain);
      o.start(now + idx * 0.07);
      o.stop(now + idx * 0.07 + 0.38);
    });
  }

  function playF1CountdownBeep(isGo = false) {
    if (!enabled) return;
    initAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const now = ctx.currentTime;
    const baseFreq = isGo ? 1760.0 : 880.0;
    const dur = isGo ? 0.42 : 0.20;
    const peakGain = isGo ? 1.10 : 0.88;

    if (misfireDuckGain) {
      misfireDuckGain.gain.setValueAtTime(0.72, now);
      misfireDuckGain.gain.linearRampToValueAtTime(1.0, now + dur);
    }

    const toneFilter = ctx.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.value = isGo ? 5200 : 3000;
    toneFilter.Q.value = 0.707;
    toneFilter.connect(masterGain);

    const envGain = ctx.createGain();
    envGain.gain.setValueAtTime(0.0001, now);
    envGain.gain.linearRampToValueAtTime(peakGain, now + 0.005);
    envGain.gain.setValueAtTime(peakGain * 0.92, now + dur * 0.65);
    envGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    envGain.connect(toneFilter);

    const oscMain = ctx.createOscillator();
    oscMain.type = 'sine';
    oscMain.frequency.setValueAtTime(baseFreq, now);
    oscMain.connect(envGain);

    const oscHarm = ctx.createOscillator();
    oscHarm.type = 'triangle';
    oscHarm.frequency.setValueAtTime(baseFreq, now);
    const harmGain = ctx.createGain();
    harmGain.gain.value = 0.32;
    oscHarm.connect(harmGain);
    harmGain.connect(envGain);

    oscMain.start(now);
    oscHarm.start(now);
    oscMain.stop(now + dur + 0.02);
    oscHarm.stop(now + dur + 0.02);
  }

  /**
   * Plays a physical, visceral collision impact sound effect:
   * - 'crash': heavy nose-in barrier smash (sub-thud, deformation crunch, ringing tubular rail clang)
   * - 'graze': glancing rail brush (lighter tap, high metallic ping, sparking crackle)
   * - 'curb': suspension curb hop (punchy suspension pop and low chassis jolt)
   * @param {number=} intensity
   * @param {string=} type
   */
  function playRailImpact(intensity = 1.0, type = 'crash') {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const strength = Math.max(0.2, Math.min(1.4, Number(intensity) || 1.0));
    const pitchJitter = 0.96 + 0.08 * Math.random();

    // 1. Visceral engine ducking during heavy impacts
    if (misfireDuckGain && type === 'crash') {
      misfireDuckGain.gain.cancelScheduledValues(now);
      misfireDuckGain.gain.setValueAtTime(1.0, now);
      misfireDuckGain.gain.linearRampToValueAtTime(
        Math.max(0.32, 1.0 - 0.55 * strength),
        now + 0.008
      );
      misfireDuckGain.gain.linearRampToValueAtTime(1.0, now + 0.11);
    }

    if (type === 'curb') {
      // Curb Hop Suspension Thud (punchy 175 -> 55 Hz pop)
      const curbDur = 0.08;
      const curbGain = ctx.createGain();
      const curbPeak = Math.min(0.36, 0.22 * strength);
      curbGain.gain.setValueAtTime(0.0001, now);
      curbGain.gain.linearRampToValueAtTime(curbPeak, now + 0.003);
      curbGain.gain.exponentialRampToValueAtTime(0.0001, now + curbDur);
      curbGain.connect(masterGain);

      const curbOsc = ctx.createOscillator();
      curbOsc.type = 'sine';
      curbOsc.frequency.setValueAtTime(175.0 * pitchJitter, now);
      curbOsc.frequency.exponentialRampToValueAtTime(55.0 * pitchJitter, now + curbDur);
      curbOsc.connect(curbGain);

      curbOsc.start(now);
      curbOsc.stop(now + curbDur + 0.015);
      return;
    }

    // 2. Chassis Low Thud (Punchy physical weight)
    const isHeavyCrash = type === 'crash';
    const thudDur = isHeavyCrash ? 0.11 : 0.07;
    const thudGain = ctx.createGain();
    const thudPeak = Math.min(0.48, (isHeavyCrash ? 0.34 : 0.18) * strength);
    thudGain.gain.setValueAtTime(0.0001, now);
    thudGain.gain.linearRampToValueAtTime(thudPeak, now + 0.003);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + thudDur);
    thudGain.connect(masterGain);

    const thudSine = ctx.createOscillator();
    thudSine.type = 'sine';
    const startThudHz = (isHeavyCrash ? 130.0 : 100.0) * pitchJitter;
    const endThudHz = (isHeavyCrash ? 36.0 : 48.0) * pitchJitter;
    thudSine.frequency.setValueAtTime(startThudHz, now);
    thudSine.frequency.exponentialRampToValueAtTime(endThudHz, now + thudDur);
    thudSine.connect(thudGain);

    const thudTri = ctx.createOscillator();
    thudTri.type = 'triangle';
    thudTri.frequency.setValueAtTime(startThudHz, now);
    thudTri.frequency.exponentialRampToValueAtTime(endThudHz, now + thudDur);
    const thudTriGain = ctx.createGain();
    thudTriGain.gain.value = 0.35;
    thudTri.connect(thudTriGain);
    thudTriGain.connect(thudGain);

    thudSine.start(now);
    thudTri.start(now);
    thudSine.stop(now + thudDur + 0.015);
    thudTri.stop(now + thudDur + 0.015);

    // 3. Impact Crunch / Deformation Noise Burst
    if (noiseBuffer) {
      const crunchSrc = ctx.createBufferSource();
      crunchSrc.buffer = noiseBuffer;
      const crunchOffset = Math.random() * 0.8;
      const crunchDur = isHeavyCrash ? 0.065 : 0.040;

      const crunchFilter = ctx.createBiquadFilter();
      crunchFilter.type = 'bandpass';
      crunchFilter.frequency.setValueAtTime(isHeavyCrash ? 1450 : 2100, now);
      crunchFilter.Q.setValueAtTime(2.2, now);

      const crunchGain = ctx.createGain();
      const crunchPeak = Math.min(0.38, (isHeavyCrash ? 0.28 : 0.14) * strength);
      crunchGain.gain.setValueAtTime(0.0001, now);
      crunchGain.gain.linearRampToValueAtTime(crunchPeak, now + 0.002);
      crunchGain.gain.exponentialRampToValueAtTime(0.0001, now + crunchDur);

      crunchSrc.connect(crunchFilter);
      crunchFilter.connect(crunchGain);
      crunchGain.connect(masterGain);

      crunchSrc.start(now, crunchOffset, crunchDur + 0.01);
    }

    // 4. Ringing Metallic Rail / Barrier Clang Partials
    const clangDur = isHeavyCrash ? 0.18 : 0.09;
    const railBandpass = ctx.createBiquadFilter();
    railBandpass.type = 'bandpass';
    railBandpass.frequency.setValueAtTime((isHeavyCrash ? 1350.0 : 1850.0) * pitchJitter, now);
    railBandpass.Q.setValueAtTime(2.6, now);
    railBandpass.connect(masterGain);

    const partialFrequencies = isHeavyCrash
      ? [
          { freq: 860.0 * pitchJitter, endFreq: 780.0 * pitchJitter, type: 'triangle', gain: 0.18 * strength },
          { freq: 1380.0 * pitchJitter, endFreq: 1240.0 * pitchJitter, type: 'sine', gain: 0.14 * strength },
          { freq: 2240.0 * pitchJitter, endFreq: 1980.0 * pitchJitter, type: 'sine', gain: 0.09 * strength },
        ]
      : [
          { freq: 1560.0 * pitchJitter, endFreq: 1420.0 * pitchJitter, type: 'triangle', gain: 0.14 * strength },
          { freq: 2620.0 * pitchJitter, endFreq: 2380.0 * pitchJitter, type: 'sine', gain: 0.10 * strength },
        ];

    partialFrequencies.forEach((p) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = p.type;
      osc.frequency.setValueAtTime(p.freq, now);
      osc.frequency.exponentialRampToValueAtTime(p.endFreq, now + clangDur);
      const peak = Math.min(0.26, p.gain);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(peak, now + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, now + clangDur);
      osc.connect(g);
      g.connect(railBandpass);
      osc.start(now);
      osc.stop(now + clangDur + 0.015);
    });
  }

  function playRaceFinishFanfare() {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;

    if (misfireDuckGain) {
      misfireDuckGain.gain.cancelScheduledValues(now);
      misfireDuckGain.gain.setValueAtTime(0.68, now);
      misfireDuckGain.gain.linearRampToValueAtTime(1.0, now + 1.15);
    }

    const fanfareFilter = ctx.createBiquadFilter();
    fanfareFilter.type = 'lowpass';
    fanfareFilter.frequency.setValueAtTime(3600, now);
    fanfareFilter.frequency.linearRampToValueAtTime(5400, now + 0.34);
    fanfareFilter.frequency.exponentialRampToValueAtTime(2400, now + 1.35);
    fanfareFilter.Q.value = 0.707;
    fanfareFilter.connect(masterGain);

    const arpeggio = [
      { freq: 523.25, start: 0.00, dur: 0.32, gain: 0.14 },
      { freq: 659.25, start: 0.07, dur: 0.34, gain: 0.14 },
      { freq: 783.99, start: 0.14, dur: 0.36, gain: 0.15 },
      { freq: 987.77, start: 0.21, dur: 0.42, gain: 0.15 },
      { freq: 1046.50, start: 0.29, dur: 0.92, gain: 0.19 },
    ];

    const resolutionChord = [
      { freq: 523.25, start: 0.29, dur: 0.88, gain: 0.11 },
      { freq: 659.25, start: 0.29, dur: 0.88, gain: 0.10 },
      { freq: 783.99, start: 0.29, dur: 0.90, gain: 0.11 },
      { freq: 987.77, start: 0.29, dur: 0.86, gain: 0.09 },
      { freq: 1174.66, start: 0.31, dur: 0.84, gain: 0.08 },
    ];

    [...arpeggio, ...resolutionChord].forEach(({ freq, start, dur, gain }) => {
      const t0 = now + start;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(gain, t0 + 0.014);
      env.gain.setValueAtTime(gain * 0.85, t0 + dur * 0.35);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      env.connect(fanfareFilter);

      const oscSine = ctx.createOscillator();
      oscSine.type = 'sine';
      oscSine.frequency.setValueAtTime(freq, t0);
      oscSine.connect(env);

      const oscTri = ctx.createOscillator();
      oscTri.type = 'triangle';
      oscTri.frequency.setValueAtTime(freq, t0);
      const triGain = ctx.createGain();
      triGain.gain.value = 0.38;
      oscTri.connect(triGain);
      triGain.connect(env);

      oscSine.start(t0);
      oscTri.start(t0);
      oscSine.stop(t0 + dur + 0.02);
      oscTri.stop(t0 + dur + 0.02);
    });
  }

  return {
    preload,
    toggle,
    setEnabled,
    update,
    playLapChime,
    playRaceFinishFanfare,
    playRailImpact,
    playTireChirp,
    playF1CountdownBeep,
    triggerSputterBurst,
    setRumbleAmount: (v) => {
      userRumbleAmount = Math.max(0.0, Math.min(2.5, Number(v)));
    },
    setSputterAmount: (v) => {
      userSputterAmount = Math.max(0.0, Math.min(2.5, Number(v)));
    },
    isEnabled: () => enabled,
    getDiagnostics: () => lastDiag,
  };
}

// Export alias matching previous signature for 100% backward compatibility
export const createWebAudioSynth = createDeskRacerHybridAudio;
