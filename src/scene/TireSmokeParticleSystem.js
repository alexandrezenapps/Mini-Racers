import * as THREE from 'three';

/**
 * Three.js Tire Smoke Particle System for 1:87 / 1:150 Micro-Kart Racing
 * (`src/scene/TireSmokeParticleSystem.js`)
 *
 * Simulates realistic billowing tire smoke (fumée de pneus) curling off slipping
 * rubber tires during high-speed drifts, hard slides, and cornering on tight turns
 * (such as Circuit 1's Cat Helix / Lamp Corkscrew and Circuit 2's Grand Prix Pro
 * double hairpins, chicanes, and mousepad slalom).
 *
 * Features:
 * - 360-particle fixed ring buffer with ZERO garbage collection in the render loop.
 * - Procedural multi-lobed Gaussian/Worley smoke puff canvas texture (zero external asset 404s).
 * - Custom GLSL vertex & fragment shaders with billow rotation, perspective pixel sizing,
 *   soft alpha edge falloff, and dynamic thermal expansion.
 * - Dynamic aerodynamic wake: smoke expands from small tire contact patches (~3mm) into
 *   volumetric puffy clouds (~22mm) as it billows upward and drifts in the kart slipstream.
 * - Multi-source slip detection: curvature, drift angle, lateral tire scrub velocity,
 *   and high-speed brake lockup.
 * - Circuit-aware: seamlessly handles Circuit 1 (Desk Coaster) & Circuit 2 (Grand Prix Pro).
 */

const MAX_SMOKE_PARTICLES = 360;

/**
 * Generates an organic, multi-lobed volumetric smoke puff texture via HTML5 2D Canvas.
 * Produces soft, feathered edges with cloudy density variations.
 * @return {!THREE.CanvasTexture}
 */
function createSmokePuffTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);

  // 1. Center core soft radial density
  const coreGrad = ctx.createRadialGradient(64, 64, 2, 64, 64, 58);
  coreGrad.addColorStop(0.0, 'rgba(255, 255, 255, 0.95)');
  coreGrad.addColorStop(0.28, 'rgba(244, 247, 252, 0.75)');
  coreGrad.addColorStop(0.58, 'rgba(226, 232, 242, 0.38)');
  coreGrad.addColorStop(0.85, 'rgba(210, 218, 230, 0.10)');
  coreGrad.addColorStop(1.0, 'rgba(200, 210, 225, 0.0)');
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fill();

  // 2. Off-center organic billowing lobes for authentic turbulent cloud texture
  const lobes = [
    { x: 50, y: 52, r: 36, alpha: 0.60 },
    { x: 78, y: 54, r: 32, alpha: 0.55 },
    { x: 58, y: 76, r: 34, alpha: 0.58 },
    { x: 74, y: 72, r: 30, alpha: 0.50 },
    { x: 64, y: 46, r: 28, alpha: 0.52 },
    { x: 44, y: 66, r: 26, alpha: 0.45 },
  ];

  for (const lobe of lobes) {
    const lg = ctx.createRadialGradient(lobe.x, lobe.y, 2, lobe.x, lobe.y, lobe.r);
    lg.addColorStop(0.0, `rgba(255, 255, 255, ${lobe.alpha})`);
    lg.addColorStop(0.45, `rgba(238, 242, 250, ${lobe.alpha * 0.55})`);
    lg.addColorStop(0.85, `rgba(216, 224, 236, ${lobe.alpha * 0.15})`);
    lg.addColorStop(1.0, 'rgba(200, 210, 225, 0.0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(lobe.x, lobe.y, lobe.r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

export class TireSmokeParticleSystem {
  /**
   * @param {!THREE.Scene} scene - The main Three.js scene.
   */
  constructor(scene) {
    this.scene = scene;
    this.smokeTexture = createSmokePuffTexture();

    // Particle state typed arrays
    this.maxCount = MAX_SMOKE_PARTICLES;
    this.posArray = new Float32Array(this.maxCount * 3);
    this.scaleArray = new Float32Array(this.maxCount);
    this.opacityArray = new Float32Array(this.maxCount);
    this.rotationArray = new Float32Array(this.maxCount);
    this.colorArray = new Float32Array(this.maxCount * 3);

    // Particle physics & lifetime simulation arrays
    this.velX = new Float32Array(this.maxCount);
    this.velY = new Float32Array(this.maxCount);
    this.velZ = new Float32Array(this.maxCount);
    this.rotVel = new Float32Array(this.maxCount);
    this.age = new Float32Array(this.maxCount);
    this.maxAge = new Float32Array(this.maxCount);
    this.startScale = new Float32Array(this.maxCount);
    this.endScale = new Float32Array(this.maxCount);
    this.peakOpacity = new Float32Array(this.maxCount);
    this.active = new Uint8Array(this.maxCount);

    this.nextIndex = 0;
    this.hadActivePuffs = false;
    this.lastEmitTime = 0.0;
    this.accumulatedDrift = 0.0;

    // Initialize all particles inactive and placed deep off-screen
    for (let i = 0; i < this.maxCount; i++) {
      this.posArray[i * 3 + 0] = 0.0;
      this.posArray[i * 3 + 1] = -10.0;
      this.posArray[i * 3 + 2] = 0.0;
      this.scaleArray[i] = 0.0;
      this.opacityArray[i] = 0.0;
      this.rotationArray[i] = 0.0;
      this.colorArray[i * 3 + 0] = 0.92;
      this.colorArray[i * 3 + 1] = 0.94;
      this.colorArray[i * 3 + 2] = 0.98;
      this.active[i] = 0;
    }

    // Three.js BufferGeometry
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.posArray, 3));
    this.geometry.setAttribute('aScale', new THREE.BufferAttribute(this.scaleArray, 1));
    this.geometry.setAttribute('aOpacity', new THREE.BufferAttribute(this.opacityArray, 1));
    this.geometry.setAttribute('aRotation', new THREE.BufferAttribute(this.rotationArray, 1));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colorArray, 3));

    // Custom ShaderMaterial with billow rotation, soft edge clipping, and perspective scaling
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: this.smokeTexture },
        uPixelScale: { value: 720.0 }, // Updated on resize / camera FOV
      },
      vertexShader: /* glsl */ `
        attribute float aScale;
        attribute float aOpacity;
        attribute float aRotation;
        attribute vec3 aColor;

        varying float vOpacity;
        varying float vRotation;
        varying vec3 vColor;

        uniform float uPixelScale;

        void main() {
          vOpacity = aOpacity;
          vRotation = aRotation;
          vColor = aColor;

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          // Scale point size inversely with depth (-mvPosition.z)
          float pSize = (aScale * uPixelScale) / max(0.002, -mvPosition.z);
          gl_PointSize = clamp(pSize, 1.0, 360.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTexture;

        varying float vOpacity;
        varying float vRotation;
        varying vec3 vColor;

        void main() {
          if (vOpacity <= 0.002) discard;

          // Rotate gl_PointCoord around (0.5, 0.5)
          vec2 coord = gl_PointCoord - vec2(0.5);
          float s = sin(vRotation);
          float c = cos(vRotation);
          vec2 rotCoord = vec2(coord.x * c - coord.y * s, coord.x * s + coord.y * c) + vec2(0.5);

          // Fast circular boundary discard
          float dist = length(coord);
          if (dist > 0.5) discard;

          vec4 texColor = texture2D(uTexture, rotCoord);
          float alpha = texColor.a * vOpacity;
          if (alpha <= 0.003) discard;

          // Soft volumetric smoke with physical rubber ash scattering
          gl_FragColor = vec4(vColor * texColor.rgb, alpha);
        }
      `,
      transparent: true,
      depthTest: true,
      depthWrite: false, // Smoke is volumetric and must not occlude depth
      blending: THREE.NormalBlending, // Natural translucent smoke accumulation
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.name = 'TireSmokeParticleCloud';
    this.points.renderOrder = 24; // Renders after opaque track & kart, blending cleanly

    this.scene.add(this.points);

    // Reusable math scratchpad (Zero GC during render loop)
    this._kartPos = new THREE.Vector3();
    this._rearCenter = new THREE.Vector3();
    this._wheelLeft = new THREE.Vector3();
    this._wheelRight = new THREE.Vector3();
    this._spawnPos = new THREE.Vector3();
    this._backDir = new THREE.Vector3();
    this._upNormal = new THREE.Vector3();
    this._lateralDir = new THREE.Vector3();
  }

  /**
   * Resets all particles immediately (used on circuit switch, restart or countdown).
   */
  reset() {
    for (let i = 0; i < this.maxCount; i++) {
      this.active[i] = 0;
      this.opacityArray[i] = 0.0;
      this.scaleArray[i] = 0.0;
      this.posArray[i * 3 + 1] = -10.0;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aOpacity.needsUpdate = true;
    this.geometry.attributes.aScale.needsUpdate = true;
    this.hadActivePuffs = false;
    this.accumulatedDrift = 0.0;
  }

  /**
   * Spawns a single smoke puff at the given world coordinates with initial velocity & expansion.
   */
  spawnPuff(spawnPos, kartTangent, kartRight, kartNormal, speed, driftDir, intensity, kartScale, isLeftTire) {
    const idx = this.nextIndex;
    this.nextIndex = (this.nextIndex + 1) % this.maxCount;

    this.active[idx] = 1;
    this.age[idx] = 0.0;

    // Realistic puff lifetime: 0.45s to 0.75s (longer in tighter drifts)
    this.maxAge[idx] = 0.45 + Math.random() * 0.30 + intensity * 0.15;

    // Position at contact patch with slight jitter
    this.posArray[idx * 3 + 0] = spawnPos.x + (Math.random() - 0.5) * 0.0012 * kartScale;
    this.posArray[idx * 3 + 1] = spawnPos.y + (Math.random() * 0.0006) * kartScale;
    this.posArray[idx * 3 + 2] = spawnPos.z + (Math.random() - 0.5) * 0.0012 * kartScale;

    // Initial scale: begins tiny at tire contact (2.5mm - 3.8mm), expands to 18mm - 28mm
    const sInit = (0.0026 + Math.random() * 0.0014) * kartScale;
    const sEnd = (0.018 + Math.random() * 0.012 + intensity * 0.008) * kartScale;
    this.startScale[idx] = sInit;
    this.endScale[idx] = sEnd;
    this.scaleArray[idx] = sInit;

    // Peak opacity based on drift intensity (dense in sharp hairpins, subtle in mild slides)
    this.peakOpacity[idx] = Math.min(0.58, 0.28 + intensity * 0.32 + Math.random() * 0.10);
    this.opacityArray[idx] = 0.0;

    // Random rotation and vortex tumble rate
    this.rotationArray[idx] = Math.random() * Math.PI * 2;
    this.rotVel[idx] = (Math.random() - 0.5) * 4.2;

    // Velocity calculation:
    // 1. Backward impulse from spinning rubber: thrown opposite to tangent into slipstream
    // 2. Lateral scrub velocity along track right vector (opposing drift direction)
    // 3. Upward thermal buoyancy along track normal
    const backwardSpeed = Math.max(0.04, speed * 0.55) * (0.85 + Math.random() * 0.30);
    const lateralSpeed = (-driftDir * (0.015 + intensity * 0.025) + (Math.random() - 0.5) * 0.012);
    const upwardSpeed = (0.012 + Math.random() * 0.018 + intensity * 0.015);

    this.velX[idx] =
      -kartTangent.x * backwardSpeed +
      kartRight.x * lateralSpeed +
      kartNormal.x * upwardSpeed +
      (Math.random() - 0.5) * 0.006;
    this.velY[idx] =
      -kartTangent.y * backwardSpeed +
      kartRight.y * lateralSpeed +
      kartNormal.y * upwardSpeed +
      (Math.random() - 0.5) * 0.006;
    this.velZ[idx] =
      -kartTangent.z * backwardSpeed +
      kartRight.z * lateralSpeed +
      kartNormal.z * upwardSpeed +
      (Math.random() - 0.5) * 0.006;

    // Smoke color: soft rubber smoke with subtle asphalt grit
    // (cool off-white with hint of blue-grey: #e6ebf2)
    const whiteness = 0.88 + Math.random() * 0.08;
    this.colorArray[idx * 3 + 0] = whiteness * 0.94;
    this.colorArray[idx * 3 + 1] = whiteness * 0.97;
    this.colorArray[idx * 3 + 2] = whiteness * 1.00;
  }

  /**
   * Updates tire smoke simulation every frame.
   *
   * @param {number} dt - Delta time in seconds.
   * @param {!object} state - Vehicle state from KartPhysicsController.
   * @param {number} kartScale - Active visual scale of the kart (e.g. 0.38, 0.58, 0.78, 1.0).
   * @param {!THREE.Camera} camera - Active camera for perspective projection scaling.
   */
  update(dt, state, kartScale = 0.58, camera) {
    const clampedDt = Math.min(dt, 0.05);

    // Update pixel scale uniform based on camera FOV & window height
    if (camera && camera.isPerspectiveCamera) {
      const vFovRad = THREE.MathUtils.degToRad(camera.fov);
      const projFactor = (window.innerHeight * 0.5) / Math.tan(vFovRad * 0.5);
      this.material.uniforms.uPixelScale.value = projFactor;
    }

    const speed = Math.abs(state.speed || 0.0);
    const absCurv = Math.abs(state.signedCurvature || 0.0);
    const absDriftAngle = Math.abs(state.driftAngle || 0.0);
    const absLatVel = Math.abs(state.lateralVel || 0.0);
    const isDrifting = Boolean(state.isDrifting);
    const isBraking = Boolean(state.isBraking);

    // Detect tight corner drifts:
    // Tight turn: curvature > 0.28 rad/m (e.g. chicanes, hairpins, corkscrew, helix)
    // Extreme turn: curvature > 0.50 rad/m
    const isTightCorner = absCurv > 0.26;
    const isHardSliding = isDrifting || absDriftAngle > 0.035 || absLatVel > 0.009;
    const isBrakeLockup = isBraking && speed > 0.09;
    const isHardSteeringCurve = Math.abs(state.steerInput || 0) > 0.32 && isTightCorner && speed > 0.07;

    // Calculate dynamic drift intensity (0.0 to 1.0)
    let driftIntensity = 0.0;
    if (speed > 0.035) {
      if (isDrifting) {
        driftIntensity += 0.52 + Math.min(0.48, absCurv * 0.55);
      }
      if (isTightCorner && (isHardSliding || isHardSteeringCurve)) {
        driftIntensity += 0.38 + Math.min(0.42, (absCurv - 0.26) * 0.95);
      }
      if (absDriftAngle > 0.03) {
        driftIntensity += Math.min(0.35, absDriftAngle * 2.8);
      }
      if (absLatVel > 0.010) {
        driftIntensity += Math.min(0.30, (absLatVel - 0.010) * 35.0);
      }
      if (isBrakeLockup) {
        driftIntensity += 0.45;
      }
      // Rain conditions slightly reduce smoke density (wet asphalt dampening)
      if (state.weatherType === 'rain') {
        driftIntensity *= 0.55;
      } else if (state.weatherType === 'fog') {
        driftIntensity *= 0.88;
      }
    }
    driftIntensity = THREE.MathUtils.clamp(driftIntensity, 0.0, 1.0);

    // Determine drift direction (-1 Left, +1 Right)
    const driftDir = state.driftDir || Math.sign(state.driftAngle) || Math.sign(state.signedCurvature) || 1;

    // Emit new puffs if drifting on tight turns / sliding
    let emitCount = 0;
    if (driftIntensity > 0.16 && speed > 0.04) {
      this.accumulatedDrift += driftIntensity * clampedDt * 42.0;
      emitCount = Math.floor(this.accumulatedDrift);
      this.accumulatedDrift -= emitCount;
      emitCount = Math.min(emitCount, 4); // Cap per-frame emissions for smoothness
    } else {
      this.accumulatedDrift = 0.0;
    }

    if (emitCount > 0) {
      // Calculate 3D world positions of rear wheels at track contact patch
      // Micro-kart geometry: rear axle is at Z = -0.0058m, tread width ±0.0048m, contact Y = 0.0006m
      this._kartPos.copy(state.position);
      this._backDir.copy(state.tangent).multiplyScalar(-1.0);
      this._upNormal.copy(state.normal);
      this._lateralDir.copy(state.right);

      this._rearCenter
        .copy(this._kartPos)
        .addScaledVector(this._backDir, 0.0058 * kartScale)
        .addScaledVector(this._upNormal, 0.0006 * kartScale);

      this._wheelLeft
        .copy(this._rearCenter)
        .addScaledVector(this._lateralDir, -0.0048 * kartScale);

      this._wheelRight
        .copy(this._rearCenter)
        .addScaledVector(this._lateralDir, 0.0048 * kartScale);

      for (let e = 0; e < emitCount; e++) {
        // In cornering drifts, the outside tire slips more heavily, or both tires billow
        const isLeft = e % 2 === 0;
        const targetWheel = isLeft ? this._wheelLeft : this._wheelRight;
        this.spawnPuff(
          targetWheel,
          state.tangent,
          this._lateralDir,
          this._upNormal,
          speed,
          driftDir,
          driftIntensity,
          kartScale,
          isLeft
        );
      }
    }

    // Advance and simulate existing active smoke puffs
    let anyActive = false;
    let posNeedsUpdate = false;
    let opacityNeedsUpdate = false;
    let scaleNeedsUpdate = false;
    let rotNeedsUpdate = false;

    if (emitCount > 0 || this.hadActivePuffs) {
      for (let i = 0; i < this.maxCount; i++) {
        if (!this.active[i]) continue;

        this.age[i] += clampedDt;
        const maxA = this.maxAge[i];

        if (this.age[i] >= maxA) {
          // Retire particle
          this.active[i] = 0;
          this.opacityArray[i] = 0.0;
          this.scaleArray[i] = 0.0;
          this.posArray[i * 3 + 1] = -10.0;
          posNeedsUpdate = true;
          opacityNeedsUpdate = true;
          scaleNeedsUpdate = true;
          continue;
        }

        anyActive = true;
        const progress = this.age[i] / maxA;

        // Smooth physical opacity envelope:
        // 0.0 -> 0.14: fast initial billow ramp-up
        // 0.14 -> 1.0: graceful exponential dissipation into the atmosphere
        let currentOpacity = 0.0;
        if (progress < 0.14) {
          currentOpacity = (progress / 0.14) * this.peakOpacity[i];
        } else {
          const fadeProgress = (progress - 0.14) / 0.86;
          currentOpacity = this.peakOpacity[i] * Math.pow(1.0 - fadeProgress, 1.75);
        }
        this.opacityArray[i] = Math.max(0.0, currentOpacity);

        // Volumetric expansion: non-linear cloud growth as thermal dissipation spreads the smoke
        const expandCurve = Math.pow(progress, 0.65); // Expands rapidly at start
        this.scaleArray[i] = THREE.MathUtils.lerp(this.startScale[i], this.endScale[i], expandCurve);

        // Position integration with air drag and upward loft
        this.posArray[i * 3 + 0] += this.velX[i] * clampedDt;
        this.posArray[i * 3 + 1] += this.velY[i] * clampedDt;
        this.posArray[i * 3 + 2] += this.velZ[i] * clampedDt;

        // Air drag slows down forward/backward slipstream motion
        const dragFactor = Math.max(0.85, 1.0 - 2.8 * clampedDt);
        this.velX[i] *= dragFactor;
        this.velZ[i] *= dragFactor;

        // Gentle thermal buoyancy: warm rubber smoke slowly rises
        this.velY[i] += 0.012 * clampedDt;

        // Cloud vortex rotation
        this.rotationArray[i] += this.rotVel[i] * clampedDt;

        posNeedsUpdate = true;
        opacityNeedsUpdate = true;
        scaleNeedsUpdate = true;
        rotNeedsUpdate = true;
      }

      if (posNeedsUpdate) this.geometry.attributes.position.needsUpdate = true;
      if (opacityNeedsUpdate) this.geometry.attributes.aOpacity.needsUpdate = true;
      if (scaleNeedsUpdate) this.geometry.attributes.aScale.needsUpdate = true;
      if (rotNeedsUpdate) this.geometry.attributes.aRotation.needsUpdate = true;

      this.hadActivePuffs = anyActive;
    }
  }

  /**
   * Cleans up GPU buffers and textures.
   */
  dispose() {
    if (this.points && this.points.parent) {
      this.points.parent.remove(this.points);
    }
    if (this.geometry) {
      this.geometry.dispose();
    }
    if (this.material) {
      this.material.dispose();
    }
    if (this.smokeTexture) {
      this.smokeTexture.dispose();
    }
  }
}
