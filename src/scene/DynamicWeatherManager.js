import * as THREE from 'three';

/**
 * Dynamic Weather System for Three.js Desk Racer Diorama
 * Cycles between CLEAR, RAINY, and FOGGY conditions.
 * Controls lighting, scene fog, animated rain particles, desk puddle ripples,
 * and passes physical grip modifiers (1.0 -> 0.68 -> 0.85) to the kart kinematics.
 */
export class DynamicWeatherManager {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} atmosphereController
   */
  constructor(scene, renderer, atmosphereController) {
    this.scene = scene;
    this.renderer = renderer;
    this.atmosphere = atmosphereController;

    this.weatherTypes = ['clear', 'rain', 'fog'];
    this.currentWeather = 'clear';
    this.targetWeather = 'clear';
    this.transitionProgress = 1.0;
    this.transitionDuration = 3.5; // seconds for smooth visual fade

    // Auto-cycling timer (every 50s cycles naturally to the next condition)
    this.autoCycleEnabled = true;
    this.autoCycleTimer = 0.0;
    this.autoCycleInterval = 50.0;

    // Grip multipliers per weather condition
    this.gripSettings = {
      clear: { grip: 1.00, topSpeed: 1.00, label: 'CLAIR', icon: '☀️', color: '#ffd27d', desc: 'Adhérence maximale (100%)' },
      rain:  { grip: 0.68, topSpeed: 0.94, label: 'PLUIE', icon: '🌧️', color: '#38bdf8', desc: 'Piste mouillée & glissante (68%)' },
      fog:   { grip: 0.85, topSpeed: 0.97, label: 'BROUILLARD', icon: '🌫️', color: '#cbd5e1', desc: 'Brouillard dense & visibilité réduite (85%)' },
    };

    this.currentGrip = 1.0;
    this.currentTopSpeed = 1.0;

    // Callbacks
    this.onWeatherChangedCallbacks = [];

    // Root group for weather-specific 3D objects (rain lines, splash quads)
    this.weatherGroup = new THREE.Group();
    this.weatherGroup.name = 'DynamicWeatherGroup';
    this.scene.add(this.weatherGroup);

    // Weather Visual Elements
    this.initFogColors();
    this.initRainParticles();
    this.initSplashRipples();
    this.initLightningFlash();

    // Set initial state
    this.setWeather('clear', true);
  }

  initFogColors() {
    this.fogColorClear = new THREE.Color(0x181312);
    this.fogColorRain  = new THREE.Color(0x0c1422);
    this.fogColorFog   = new THREE.Color(0x131924);

    this.targetFogColor = this.fogColorClear.clone();
    this.currentFogColor = this.fogColorClear.clone();

    this.fogDensityClear = 0.016;
    this.fogDensityRain  = 0.030;
    this.fogDensityFog   = 0.052;

    this.currentFogDensity = this.fogDensityClear;
    this.targetFogDensity = this.fogDensityClear;
  }

  /**
   * Fast falling rain particle lines over the desk diorama area:
   * X in [-0.55m, +0.55m], Y in [0.0m, +0.55m], Z in [-0.35m, +0.35m]
   */
  initRainParticles() {
    const RAIN_COUNT = 1400;
    this.rainCount = RAIN_COUNT;

    const positions = new Float32Array(RAIN_COUNT * 6); // 2 vertices per line (start & end)
    const opacities = new Float32Array(RAIN_COUNT * 2);

    this.rainVelocities = new Float32Array(RAIN_COUNT);
    this.rainLengths = new Float32Array(RAIN_COUNT);
    this.rainX = new Float32Array(RAIN_COUNT);
    this.rainY = new Float32Array(RAIN_COUNT);
    this.rainZ = new Float32Array(RAIN_COUNT);

    const deskMinX = -0.62, deskMaxX = 0.62;
    const deskMinZ = -0.38, deskMaxZ = 0.38;
    const spawnMinY = 0.01, spawnMaxY = 0.52;

    for (let i = 0; i < RAIN_COUNT; i++) {
      this.rainX[i] = deskMinX + Math.random() * (deskMaxX - deskMinX);
      this.rainY[i] = spawnMinY + Math.random() * (spawnMaxY - spawnMinY);
      this.rainZ[i] = deskMinZ + Math.random() * (deskMaxZ - deskMinZ);
      this.rainVelocities[i] = 1.6 + Math.random() * 1.8; // m/s downwards
      this.rainLengths[i] = 0.016 + Math.random() * 0.022; // 16-38mm streaks

      const i6 = i * 6;
      positions[i6 + 0] = this.rainX[i];
      positions[i6 + 1] = this.rainY[i];
      positions[i6 + 2] = this.rainZ[i];

      positions[i6 + 3] = this.rainX[i] - 0.003; // slight wind slant
      positions[i6 + 4] = this.rainY[i] - this.rainLengths[i];
      positions[i6 + 5] = this.rainZ[i] + 0.001;

      opacities[i * 2 + 0] = 0.25 + Math.random() * 0.55;
      opacities[i * 2 + 1] = 0.05;
    }

    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    rainGeo.setAttribute('alpha', new THREE.BufferAttribute(opacities, 1));

    // Transparent illuminated cool blue raindrop line shader
    const rainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(0x88d4ff) },
        uGlobalAlpha: { value: 0.0 },
      },
      vertexShader: /* glsl */ `
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uGlobalAlpha;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(uColor, vAlpha * uGlobalAlpha);
        }
      `,
    });

    this.rainLines = new THREE.LineSegments(rainGeo, rainMat);
    this.rainLines.frustumCulled = false;
    this.rainLines.renderOrder = 8;
    this.weatherGroup.add(this.rainLines);
  }

  /**
   * Expanding puddle splash rings when drops hit the desk/coaster plane (y = 0.002)
   */
  initSplashRipples() {
    const SPLASH_COUNT = 80;
    this.splashCount = SPLASH_COUNT;
    this.splashData = [];

    const splashGeo = new THREE.RingGeometry(0.001, 0.007, 16);
    splashGeo.rotateX(-Math.PI / 2);

    const splashMat = new THREE.MeshBasicMaterial({
      color: 0x99ddff,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.splashInstanced = new THREE.InstancedMesh(splashGeo, splashMat, SPLASH_COUNT);
    this.splashInstanced.frustumCulled = false;
    this.splashInstanced.renderOrder = 7;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < SPLASH_COUNT; i++) {
      dummy.position.set(0, -10, 0);
      dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      this.splashInstanced.setMatrixAt(i, dummy.matrix);

      this.splashData.push({
        x: 0,
        y: 0,
        z: 0,
        age: 1.0,
        life: 0.28 + Math.random() * 0.20,
        scaleMax: 0.008 + Math.random() * 0.012,
      });
    }
    this.splashInstanced.instanceMatrix.needsUpdate = true;
    this.weatherGroup.add(this.splashInstanced);
    this._splashDummy = dummy;
  }

  initLightningFlash() {
    this.lightningLight = new THREE.DirectionalLight(0xd0e8ff, 0.0);
    this.lightningLight.position.set(0.1, 0.8, 0.2);
    this.weatherGroup.add(this.lightningLight);

    this.lightningTimer = 0.0;
    this.lightningNextFlash = 8.0 + Math.random() * 12.0;
    this.flashIntensity = 0.0;
  }

  /**
   * Changes the active weather condition
   * @param {'clear' | 'rain' | 'fog'} type
   * @param {boolean} [instant=false]
   */
  setWeather(type, instant = false) {
    if (!this.weatherTypes.includes(type)) return;

    this.targetWeather = type;
    const settings = this.gripSettings[type];

    if (instant) {
      this.currentWeather = type;
      this.transitionProgress = 1.0;
      this.currentGrip = settings.grip;
      this.currentTopSpeed = settings.topSpeed;

      if (type === 'clear') {
        this.currentFogColor.copy(this.fogColorClear);
        this.currentFogDensity = this.fogDensityClear;
        if (this.rainLines) this.rainLines.material.uniforms.uGlobalAlpha.value = 0.0;
      } else if (type === 'rain') {
        this.currentFogColor.copy(this.fogColorRain);
        this.currentFogDensity = this.fogDensityRain;
        if (this.rainLines) this.rainLines.material.uniforms.uGlobalAlpha.value = 0.85;
      } else if (type === 'fog') {
        this.currentFogColor.copy(this.fogColorFog);
        this.currentFogDensity = this.fogDensityFog;
        if (this.rainLines) this.rainLines.material.uniforms.uGlobalAlpha.value = 0.0;
      }

      this.applyFogToScene(this.currentFogColor, this.currentFogDensity);
      this.notifyListeners(type, settings);
    } else {
      this.transitionProgress = 0.0;
    }
  }

  /**
   * Cycle to next weather condition in the sequence
   */
  cycleWeather() {
    const nextIdx = (this.weatherTypes.indexOf(this.targetWeather) + 1) % this.weatherTypes.length;
    this.setWeather(this.weatherTypes[nextIdx]);
    return this.targetWeather;
  }

  applyFogToScene(color, density) {
    if (this.scene.fog) {
      this.scene.fog.color.copy(color);
      this.scene.fog.density = density;
    }
    if (this.scene.background && this.scene.background.isColor) {
      this.scene.background.copy(color);
    }
  }

  onWeatherChanged(cb) {
    this.onWeatherChangedCallbacks.push(cb);
  }

  notifyListeners(type, settings) {
    for (const cb of this.onWeatherChangedCallbacks) {
      try {
        cb(type, settings);
      } catch (e) {
        console.warn('Weather change listener error:', e);
      }
    }
  }

  /**
   * Spawn a splash ripple on the desk
   */
  spawnSplash(x, y, z) {
    for (let i = 0; i < this.splashCount; i++) {
      const sp = this.splashData[i];
      if (sp.age >= 1.0) {
        sp.x = x;
        sp.y = Math.max(0.001, y);
        sp.z = z;
        sp.age = 0.0;
        sp.life = 0.22 + Math.random() * 0.18;
        break;
      }
    }
  }

  /**
   * 60FPS update loop
   * @param {number} dt Delta time in seconds
   * @param {number} elapsedTime Total elapsed time
   * @param {object} [physicsController] Active physics controller to modulate grip
   */
  update(dt, elapsedTime, physicsController = null) {
    const clampedDt = Math.min(dt, 0.05);

    // 1. Auto-cycle timer
    if (this.autoCycleEnabled) {
      this.autoCycleTimer += clampedDt;
      if (this.autoCycleTimer >= this.autoCycleInterval) {
        this.autoCycleTimer = 0.0;
        this.cycleWeather();
      }
    }

    // 2. Smooth weather transitions
    if (this.transitionProgress < 1.0) {
      this.transitionProgress = Math.min(1.0, this.transitionProgress + clampedDt / this.transitionDuration);
      const t = this.transitionProgress;
      // Smooth cubic ease-in-out
      const smoothT = t * t * (3.0 - 2.0 * t);

      const fromSettings = this.gripSettings[this.currentWeather];
      const toSettings = this.gripSettings[this.targetWeather];

      this.currentGrip = THREE.MathUtils.lerp(fromSettings.grip, toSettings.grip, smoothT);
      this.currentTopSpeed = THREE.MathUtils.lerp(fromSettings.topSpeed, toSettings.topSpeed, smoothT);

      // Interpolate Fog Color & Density
      const fromColor = this.currentWeather === 'clear' ? this.fogColorClear :
                        this.currentWeather === 'rain'  ? this.fogColorRain  : this.fogColorFog;
      const toColor   = this.targetWeather === 'clear' ? this.fogColorClear :
                        this.targetWeather === 'rain'  ? this.fogColorRain  : this.fogColorFog;
      this.currentFogColor.lerpColors(fromColor, toColor, smoothT);

      const fromDensity = this.currentWeather === 'clear' ? this.fogDensityClear :
                          this.currentWeather === 'rain'  ? this.fogDensityRain  : this.fogDensityFog;
      const toDensity   = this.targetWeather === 'clear' ? this.fogDensityClear :
                          this.targetWeather === 'rain'  ? this.fogDensityRain  : this.fogDensityFog;
      this.currentFogDensity = THREE.MathUtils.lerp(fromDensity, toDensity, smoothT);

      this.applyFogToScene(this.currentFogColor, this.currentFogDensity);

      // Rain alpha fade
      const targetRainAlpha = this.targetWeather === 'rain' ? 0.85 : 0.0;
      const currentRainAlpha = this.rainLines.material.uniforms.uGlobalAlpha.value;
      this.rainLines.material.uniforms.uGlobalAlpha.value = THREE.MathUtils.lerp(
        currentRainAlpha,
        targetRainAlpha,
        smoothT
      );

      if (this.transitionProgress >= 1.0) {
        this.currentWeather = this.targetWeather;
        this.notifyListeners(this.currentWeather, this.gripSettings[this.currentWeather]);
      }
    }

    // 3. Sync physics grip & weather state
    if (physicsController && physicsController.state) {
      physicsController.state.gripMultiplier = this.currentGrip;
      physicsController.state.weatherType = this.currentWeather;
    }

    // 4. Update Rain Particles if active
    const rainAlpha = this.rainLines ? this.rainLines.material.uniforms.uGlobalAlpha.value : 0.0;
    if (rainAlpha > 0.01) {
      const posAttr = this.rainLines.geometry.attributes.position;
      const posArr = posAttr.array;

      for (let i = 0; i < this.rainCount; i++) {
        this.rainY[i] -= this.rainVelocities[i] * clampedDt;

        // Hit desk surface (y <= 0.002)
        if (this.rainY[i] <= 0.002) {
          if (Math.random() < 0.15 && rainAlpha > 0.4) {
            this.spawnSplash(this.rainX[i], 0.002, this.rainZ[i]);
          }
          // Recycle back up
          this.rainY[i] = 0.50 + Math.random() * 0.06;
          this.rainX[i] = -0.58 + Math.random() * 1.16;
          this.rainZ[i] = -0.36 + Math.random() * 0.72;
        }

        const i6 = i * 6;
        posArr[i6 + 0] = this.rainX[i];
        posArr[i6 + 1] = this.rainY[i];
        posArr[i6 + 2] = this.rainZ[i];

        posArr[i6 + 3] = this.rainX[i] - 0.003;
        posArr[i6 + 4] = this.rainY[i] - this.rainLengths[i];
        posArr[i6 + 5] = this.rainZ[i] + 0.001;
      }
      posAttr.needsUpdate = true;
    }

    // 5. Update Splash Ripples
    let splashesActive = false;
    for (let i = 0; i < this.splashCount; i++) {
      const sp = this.splashData[i];
      if (sp.age < 1.0) {
        sp.age += clampedDt / sp.life;
        splashesActive = true;
        if (sp.age < 1.0) {
          const s = Math.sin(sp.age * Math.PI * 0.5) * sp.scaleMax;
          this._splashDummy.position.set(sp.x, sp.y, sp.z);
          this._splashDummy.scale.set(s, s, s);
          this._splashDummy.updateMatrix();
          this.splashInstanced.setMatrixAt(i, this._splashDummy.matrix);
        } else {
          this._splashDummy.position.set(0, -10, 0);
          this._splashDummy.scale.set(0, 0, 0);
          this._splashDummy.updateMatrix();
          this.splashInstanced.setMatrixAt(i, this._splashDummy.matrix);
        }
      }
    }
    if (splashesActive) {
      this.splashInstanced.instanceMatrix.needsUpdate = true;
    }

    // 6. Occasional Atmospheric Storm Lightning Flash in Rainy weather
    if (this.currentWeather === 'rain' && rainAlpha > 0.5) {
      this.lightningTimer += clampedDt;
      if (this.lightningTimer >= this.lightningNextFlash) {
        this.flashIntensity = 1.0;
        this.lightningTimer = 0.0;
        this.lightningNextFlash = 9.0 + Math.random() * 16.0;
      }
      if (this.flashIntensity > 0.0) {
        this.flashIntensity = Math.max(0.0, this.flashIntensity - clampedDt * 4.5);
        this.lightningLight.intensity = this.flashIntensity * 0.95;
      }
    } else if (this.lightningLight.intensity > 0.0) {
      this.lightningLight.intensity = Math.max(0.0, this.lightningLight.intensity - clampedDt * 5.0);
    }
  }

  dispose() {
    if (this.weatherGroup) {
      this.scene.remove(this.weatherGroup);
      this.weatherGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }
  }
}
