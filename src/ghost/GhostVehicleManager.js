import * as THREE from 'three';
import { buildGhostKart } from '../scene/GhostKartBuilder.js';
import { formatLapTime } from '../leaderboard/LeaderboardManager.js';

const STORAGE_KEY = 'fast_racers_best_lap_ghost_v1';
const SETTINGS_KEY = 'fast_racers_ghost_enabled_v1';

export class GhostVehicleManager {
  constructor() {
    this.enabled = this.loadEnabledPreference();
    this.ghostKart = null;
    this.activeGhost = null;
    this.currentLapSamples = [];
    this.lastSampleTime = -1;
    this.sampleInterval = 0.048; // ~20.8Hz sample rate (compact & high-fidelity)
    this.isRecording = false;

    // Reusable math objects for 60FPS interpolation
    this._posA = new THREE.Vector3();
    this._posB = new THREE.Vector3();
    this._lerpPos = new THREE.Vector3();
    this._quatA = new THREE.Quaternion();
    this._quatB = new THREE.Quaternion();
    this._slerpQuat = new THREE.Quaternion();
  }

  loadEnabledPreference() {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      return stored !== null ? stored === 'true' : true;
    } catch (_e) {
      return true;
    }
  }

  saveEnabledPreference(val) {
    this.enabled = !!val;
    try {
      localStorage.setItem(SETTINGS_KEY, String(this.enabled));
    } catch (_e) {
      // Ignore quota errors
    }
  }

  init(scene, physics = null) {
    this.physics = physics;
    this.ghostKart = buildGhostKart();
    this.ghostKart.kartRoot.scale.setScalar(0.38);
    this.ghostKart.kartRoot.visible = false;
    scene.add(this.ghostKart.kartRoot);

    // Try loading saved best lap ghost from localStorage
    const stored = this.loadGhostFromStorage();
    if (stored && Array.isArray(stored.samples) && stored.samples.length > 20) {
      this.activeGhost = stored;
    } else if (physics) {
      // Generate default benchmark ghost along the track spline
      this.activeGhost = this.generateBenchmarkGhost(physics);
    }

    return this.ghostKart;
  }

  setPhysics(physics) {
    this.physics = physics;
    if (!this.activeGhost && physics) {
      this.activeGhost = this.generateBenchmarkGhost(physics);
    }
  }

  loadGhostFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.samples) && parsed.samples.length > 20) {
        return parsed;
      }
    } catch (e) {
      console.warn('GhostVehicleManager: Failed to read from localStorage', e);
    }
    return null;
  }

  saveGhostToStorage(lapTime, samples, isBenchmark = false) {
    const data = {
      version: 1,
      lapTime: parseFloat(lapTime.toFixed(3)),
      formattedTime: formatLapTime(lapTime),
      date: new Date().toISOString(),
      isBenchmark: !!isBenchmark,
      sampleCount: samples.length,
      samples, // Array of [t, x, y, z, qx, qy, qz, qw, speed, steer, s]
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      this.activeGhost = data;
    } catch (e) {
      console.warn('GhostVehicleManager: Failed to save ghost to localStorage', e);
    }

    return data;
  }

  /**
   * Generates a high-quality default benchmark ghost (~48.85s) along the track spline
   * so the player has an immediate benchmark on their very first race.
   */
  generateBenchmarkGhost(physics) {
    if (!physics || typeof physics.sampleTrackAtArcLength !== 'function') {
      return null;
    }

    const totalLength = 3.6074; // track length in meters
    const targetLapTime = 48.85; // competitive baseline benchmark
    const numSamples = 600;
    const samples = [];

    const _left = new THREE.Vector3();
    const _rotMat = new THREE.Matrix4();
    const _baseQuat = new THREE.Quaternion();

    for (let i = 0; i <= numSamples; i++) {
      const fraction = i / numSamples;
      const t = fraction * targetLapTime;
      const s = fraction * totalLength;

      const frame = physics.sampleTrackAtArcLength(s);
      const pos = new THREE.Vector3()
        .copy(frame.position)
        .addScaledVector(frame.normal, 0.0003);

      _left.crossVectors(frame.normal, frame.tangent).normalize();
      _rotMat.makeBasis(_left, frame.normal, frame.tangent);
      _baseQuat.setFromRotationMatrix(_rotMat);

      // Speed calibrated with curvature
      const speed = 0.074 * (1.0 - Math.min(0.25, Math.abs(frame.signedCurvature) * 0.05));
      const steer = -frame.signedCurvature * 0.08;

      samples.push([
        parseFloat(t.toFixed(3)),
        parseFloat(pos.x.toFixed(4)),
        parseFloat(pos.y.toFixed(4)),
        parseFloat(pos.z.toFixed(4)),
        parseFloat(_baseQuat.x.toFixed(4)),
        parseFloat(_baseQuat.y.toFixed(4)),
        parseFloat(_baseQuat.z.toFixed(4)),
        parseFloat(_baseQuat.w.toFixed(4)),
        parseFloat(speed.toFixed(3)),
        parseFloat(steer.toFixed(3)),
        parseFloat(s.toFixed(3)),
      ]);
    }

    return {
      version: 1,
      lapTime: targetLapTime,
      formattedTime: formatLapTime(targetLapTime),
      isBenchmark: true,
      sampleCount: samples.length,
      samples,
    };
  }

  startLapRecording() {
    this.currentLapSamples = [];
    this.lastSampleTime = -1;
    this.isRecording = true;
  }

  recordFrame(state) {
    if (!this.isRecording || !state) return;
    const t = state.currentLapTime;
    if (t === undefined || t < 0) return;

    // Reset buffer if lap just wrapped around
    if (this.currentLapSamples.length > 0 && t < this.lastSampleTime - 0.5) {
      this.currentLapSamples = [];
      this.lastSampleTime = -1;
    }

    if (this.lastSampleTime < 0 || t - this.lastSampleTime >= this.sampleInterval) {
      this.lastSampleTime = t;
      this.currentLapSamples.push([
        parseFloat(t.toFixed(3)),
        parseFloat(state.position.x.toFixed(4)),
        parseFloat(state.position.y.toFixed(4)),
        parseFloat(state.position.z.toFixed(4)),
        parseFloat(state.quaternion.x.toFixed(4)),
        parseFloat(state.quaternion.y.toFixed(4)),
        parseFloat(state.quaternion.z.toFixed(4)),
        parseFloat(state.quaternion.w.toFixed(4)),
        parseFloat(state.speed.toFixed(3)),
        parseFloat(state.steerAngle.toFixed(3)),
        parseFloat(state.s.toFixed(3)),
      ]);
    }
  }

  finishLap(lapTime, isAutopilot) {
    if (isAutopilot || lapTime < 2.5 || this.currentLapSamples.length < 25) {
      this.currentLapSamples = [];
      this.lastSampleTime = -1;
      return { isNewGhost: false };
    }

    const previousGhostTime = this.activeGhost ? this.activeGhost.lapTime : Infinity;
    const isNewGhost = !this.activeGhost || lapTime < previousGhostTime;

    if (isNewGhost) {
      this.saveGhostToStorage(lapTime, this.currentLapSamples, false);
      this.currentLapSamples = [];
      this.lastSampleTime = -1;
      return {
        isNewGhost: true,
        lapTime,
        formattedTime: formatLapTime(lapTime),
        previousTime: previousGhostTime < 1000 ? previousGhostTime : null,
      };
    }

    this.currentLapSamples = [];
    this.lastSampleTime = -1;
    return { isNewGhost: false };
  }

  clearGhost() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_e) {}
    this.activeGhost = this.generateBenchmarkGhost(this.physics);
  }

  toggleEnabled() {
    this.enabled = !this.enabled;
    this.saveEnabledPreference(this.enabled);
    if (!this.enabled && this.ghostKart) {
      this.ghostKart.kartRoot.visible = false;
    }
    return this.enabled;
  }

  syncScale(scale) {
    if (this.ghostKart && this.ghostKart.kartRoot) {
      this.ghostKart.kartRoot.scale.setScalar(scale);
    }
  }

  attachGlb(glbScene) {
    if (this.ghostKart && typeof this.ghostKart.attachGlbGhost === 'function') {
      this.ghostKart.attachGlbGhost(glbScene);
    }
  }

  /**
   * Main per-frame update for the ghost car.
   * Evaluates pose along recorded best lap samples, updates wheels/visuals,
   * and computes real-time delta vs the player.
   */
  update(currentLapTime, dt, playerState, elapsedTime, isCountdownActive) {
    if (!this.enabled || !this.ghostKart || !this.activeGhost) {
      if (this.ghostKart) this.ghostKart.kartRoot.visible = false;
      return { visible: false, deltaSec: null, ghostTime: 0, ghostSpeed: 0 };
    }

    const samples = this.activeGhost.samples;
    if (!samples || samples.length < 2) {
      this.ghostKart.kartRoot.visible = false;
      return { visible: false, deltaSec: null, ghostTime: 0, ghostSpeed: 0 };
    }

    // 1. If at start countdown, pose ghost at starting line (sample 0)
    if (isCountdownActive || currentLapTime <= 0.001) {
      const s0 = samples[0];
      this.ghostKart.kartRoot.position.set(s0[1], s0[2], s0[3]);
      this.ghostKart.kartRoot.quaternion.set(s0[4], s0[5], s0[6], s0[7]);
      this.ghostKart.kartRoot.visible = true;
      this.ghostKart.updateGhostVisuals(dt, 0, 0, elapsedTime);
      return { visible: true, deltaSec: 0, ghostTime: 0, ghostSpeed: 0, isAhead: false };
    }

    // 2. Locate bounding sample indices for currentLapTime
    const targetT = Math.min(currentLapTime, this.activeGhost.lapTime);
    let low = 0;
    let high = samples.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (samples[mid][0] < targetT) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const idx0 = Math.max(0, Math.min(samples.length - 2, low - 1));
    const idx1 = idx0 + 1;
    const sA = samples[idx0];
    const sB = samples[idx1];

    const tA = sA[0];
    const tB = sB[0];
    const alpha = tB > tA ? Math.max(0, Math.min(1, (targetT - tA) / (tB - tA))) : 0;

    // 3. Interpolate Position & Quaternion
    this._posA.set(sA[1], sA[2], sA[3]);
    this._posB.set(sB[1], sB[2], sB[3]);
    this._lerpPos.lerpVectors(this._posA, this._posB, alpha);

    this._quatA.set(sA[4], sA[5], sA[6], sA[7]);
    this._quatB.set(sB[4], sB[5], sB[6], sB[7]);
    this._slerpQuat.slerpQuaternions(this._quatA, this._quatB, alpha);

    const ghostSpeed = sA[8] + (sB[8] - sA[8]) * alpha;
    const ghostSteer = sA[9] + (sB[9] - sA[9]) * alpha;
    const ghostDist = sA[10] + (sB[10] - sA[10]) * alpha;

    this.ghostKart.kartRoot.position.copy(this._lerpPos);
    this.ghostKart.kartRoot.quaternion.copy(this._slerpQuat);
    this.ghostKart.kartRoot.visible = true;

    this.ghostKart.updateWheels(dt, ghostSpeed, ghostSteer);
    this.ghostKart.updateGhostVisuals(dt, ghostSpeed, ghostSteer, elapsedTime);

    // 4. Calculate real-time Time Delta:
    // Find the time at which the ghost was at player's current spline position (playerState.s)
    let deltaSec = null;
    let isAhead = false;

    if (playerState && playerState.s !== undefined) {
      const playerS = playerState.s;
      // Search for sample nearest to playerS
      let bestDistDiff = Infinity;
      let ghostTimeAtPlayerS = null;

      for (let i = 0; i < samples.length; i++) {
        const diff = Math.abs(samples[i][10] - playerS);
        if (diff < bestDistDiff) {
          bestDistDiff = diff;
          ghostTimeAtPlayerS = samples[i][0];
        }
      }

      if (ghostTimeAtPlayerS !== null && bestDistDiff < 0.25) {
        // Delta = current player lap time - ghost time when at this same spot
        // Negative = player is ahead (took less time to reach here!)
        // Positive = player is behind (took more time!)
        deltaSec = currentLapTime - ghostTimeAtPlayerS;
        isAhead = deltaSec < 0;
      }
    }

    return {
      visible: true,
      deltaSec,
      ghostTime: targetT,
      ghostSpeed,
      isAhead,
      ghostLapTime: this.activeGhost.lapTime,
      formattedGhostTime: this.activeGhost.formattedTime,
    };
  }
}

export const ghostVehicleManager = new GhostVehicleManager();
