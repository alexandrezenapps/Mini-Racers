import * as THREE from 'three';

/**
 * Builds the translucent, non-colliding Ghost Vehicle (1:87 HO micro-scale).
 * Features an ethereal neon-cyan holographic chassis, translucent rotating wheels,
 * glowing under-glow halo decal, and floating holographic GHOST beacon.
 */
export function buildGhostKart() {
  const kartRoot = new THREE.Group();
  kartRoot.name = 'GhostKartRoot';

  const chassisGroup = new THREE.Group();
  chassisGroup.name = 'GhostChassisBody';
  kartRoot.add(chassisGroup);

  // Ethereal Holographic Spectral Materials
  const ghostFairingMat = new THREE.MeshStandardMaterial({
    color: 0x00e5ff,
    emissive: 0x0077aa,
    emissiveIntensity: 0.85,
    roughness: 0.15,
    metalness: 0.25,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  const ghostAccentMat = new THREE.MeshStandardMaterial({
    color: 0x90f7ff,
    emissive: 0x00c8e6,
    emissiveIntensity: 1.1,
    roughness: 0.1,
    metalness: 0.1,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    toneMapped: false,
  });

  const ghostFrameMat = new THREE.MeshStandardMaterial({
    color: 0x003c54,
    emissive: 0x005577,
    emissiveIntensity: 0.4,
    roughness: 0.35,
    metalness: 0.6,
    transparent: true,
    opacity: 0.50,
    depthWrite: false,
  });

  const ghostWheelRubberMat = new THREE.MeshStandardMaterial({
    color: 0x002838,
    emissive: 0x006080,
    emissiveIntensity: 0.45,
    roughness: 0.4,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });

  const ghostRimMat = new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    emissive: 0x00c8e6,
    emissiveIntensity: 0.9,
    roughness: 0.15,
    metalness: 0.8,
    transparent: true,
    opacity: 0.70,
    depthWrite: false,
  });

  // 1. Glowing Ethereal Under-Glow Ground Halo Decal
  const haloCanvas = document.createElement('canvas');
  haloCanvas.width = 128;
  haloCanvas.height = 128;
  const hCtx = haloCanvas.getContext('2d');
  hCtx.clearRect(0, 0, 128, 128);

  const haloGrad = hCtx.createRadialGradient(64, 64, 6, 64, 64, 60);
  haloGrad.addColorStop(0.0, 'rgba(0, 240, 255, 0.75)');
  haloGrad.addColorStop(0.35, 'rgba(0, 200, 255, 0.45)');
  haloGrad.addColorStop(0.70, 'rgba(0, 140, 220, 0.18)');
  haloGrad.addColorStop(1.0, 'rgba(0, 80, 180, 0.0)');
  hCtx.fillStyle = haloGrad;
  hCtx.beginPath();
  hCtx.arc(64, 64, 60, 0, Math.PI * 2);
  hCtx.fill();

  const haloTex = new THREE.CanvasTexture(haloCanvas);
  const ghostHaloQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(0.022, 0.028),
    new THREE.MeshBasicMaterial({
      map: haloTex,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -9,
      polygonOffsetUnits: -9,
    })
  );
  ghostHaloQuad.rotation.x = -Math.PI / 2;
  ghostHaloQuad.position.set(0, 0.0008, 0);
  kartRoot.add(ghostHaloQuad);

  // 2. Chassis Floor Pan & Fairings
  const floorPan = new THREE.Mesh(
    new THREE.BoxGeometry(0.0084, 0.0008, 0.0155),
    ghostFrameMat
  );
  floorPan.position.set(0, 0.0014, 0);
  chassisGroup.add(floorPan);

  // Aerodynamic nose cone (+Z forward)
  const noseCone = new THREE.Mesh(
    new THREE.BoxGeometry(0.0088, 0.0022, 0.0046),
    ghostFairingMat
  );
  noseCone.position.set(0, 0.0023, 0.0068);
  noseCone.rotation.x = 0.22;
  chassisGroup.add(noseCone);

  // Ghost Number Badge on nose
  const noseBadge = new THREE.Mesh(
    new THREE.BoxGeometry(0.0048, 0.0004, 0.0028),
    ghostAccentMat
  );
  noseBadge.position.set(0, 0.0033, 0.0066);
  noseBadge.rotation.x = 0.22;
  chassisGroup.add(noseBadge);

  // Left & Right Side Pods
  for (const sx of [-0.0044, 0.0044]) {
    const sidePod = new THREE.Mesh(
      new THREE.BoxGeometry(0.0024, 0.0024, 0.0076),
      ghostFairingMat
    );
    sidePod.position.set(sx, 0.0024, -0.0004);
    chassisGroup.add(sidePod);
  }

  // Rear Engine Block & Wing
  const engineBlock = new THREE.Mesh(
    new THREE.BoxGeometry(0.0034, 0.0036, 0.0042),
    ghostFrameMat
  );
  engineBlock.position.set(0.0018, 0.0032, -0.0052);
  chassisGroup.add(engineBlock);

  const rearWingPillars = new THREE.Mesh(
    new THREE.BoxGeometry(0.0068, 0.0034, 0.0008),
    ghostFrameMat
  );
  rearWingPillars.position.set(0, 0.0048, -0.0072);
  chassisGroup.add(rearWingPillars);

  const rearWingBlade = new THREE.Mesh(
    new THREE.BoxGeometry(0.0098, 0.0006, 0.0032),
    ghostFairingMat
  );
  rearWingBlade.position.set(0, 0.0066, -0.0072);
  rearWingBlade.rotation.x = -0.12;
  chassisGroup.add(rearWingBlade);

  // 3. Driver Figure with Holographic Helmet
  const driverSeat = new THREE.Mesh(
    new THREE.BoxGeometry(0.0052, 0.0036, 0.0048),
    ghostFrameMat
  );
  driverSeat.position.set(0, 0.0028, -0.0018);
  chassisGroup.add(driverSeat);

  const driverTorso = new THREE.Mesh(
    new THREE.BoxGeometry(0.0046, 0.0042, 0.0032),
    ghostFairingMat
  );
  driverTorso.position.set(0, 0.0049, -0.0014);
  driverTorso.rotation.x = -0.18;
  chassisGroup.add(driverTorso);

  const helmetHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.0021, 14, 12),
    ghostFairingMat
  );
  helmetHead.position.set(0, 0.0078, -0.0008);
  chassisGroup.add(helmetHead);

  const visor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0019, 0.0019, 0.0012, 12, 1, false, 0, Math.PI * 0.9),
    ghostAccentMat
  );
  visor.rotation.x = Math.PI / 2;
  visor.rotation.y = Math.PI * 0.55;
  visor.position.set(0, 0.0078, 0.0004);
  chassisGroup.add(visor);

  // Steering Wheel
  const steerWheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.0015, 0.0003, 8, 16),
    ghostFrameMat
  );
  steerWheel.position.set(0, 0.0052, 0.0024);
  steerWheel.rotation.x = -0.68;
  chassisGroup.add(steerWheel);

  // 4. Wheels with Pivots
  const wheelMeshes = [];
  const frontPivots = [];

  const wheelGeom = new THREE.CylinderGeometry(0.0021, 0.0021, 0.0018, 14);
  wheelGeom.rotateZ(Math.PI / 2);

  const rimGeom = new THREE.CylinderGeometry(0.0014, 0.0014, 0.0019, 10);
  rimGeom.rotateZ(Math.PI / 2);

  const wheelPositions = [
    { name: 'FL', x: -0.0049, y: 0.0021, z: 0.0050, isFront: true },
    { name: 'FR', x: 0.0049, y: 0.0021, z: 0.0050, isFront: true },
    { name: 'RL', x: -0.0051, y: 0.0023, z: -0.0048, isFront: false },
    { name: 'RR', x: 0.0051, y: 0.0023, z: -0.0048, isFront: false },
  ];

  for (const wp of wheelPositions) {
    const pivot = new THREE.Group();
    pivot.position.set(wp.x, wp.y, wp.z);
    chassisGroup.add(pivot);

    const spinGroup = new THREE.Group();
    pivot.add(spinGroup);

    const tire = new THREE.Mesh(wheelGeom, ghostWheelRubberMat);
    spinGroup.add(tire);

    const rim = new THREE.Mesh(rimGeom, ghostRimMat);
    spinGroup.add(rim);

    wheelMeshes.push(spinGroup);
    if (wp.isFront) {
      frontPivots.push(pivot);
    }
  }

  // 5. Floating Holographic "GHOST" Diamond Beacon Sprite
  const beaconCanvas = document.createElement('canvas');
  beaconCanvas.width = 256;
  beaconCanvas.height = 96;
  const bCtx = beaconCanvas.getContext('2d');
  bCtx.clearRect(0, 0, 256, 96);

  // Background pill
  bCtx.fillStyle = 'rgba(0, 30, 50, 0.72)';
  bCtx.strokeStyle = '#00e5ff';
  bCtx.lineWidth = 4;
  bCtx.beginPath();
  bCtx.roundRect(14, 16, 228, 64, 32);
  bCtx.fill();
  bCtx.stroke();

  // Glow
  bCtx.font = 'bold 30px "Orbitron", sans-serif';
  bCtx.textAlign = 'center';
  bCtx.textBaseline = 'middle';
  bCtx.fillStyle = '#00e5ff';
  bCtx.shadowColor = '#00e5ff';
  bCtx.shadowBlur = 12;
  bCtx.fillText('👻 GHOST', 128, 48);

  const beaconTex = new THREE.CanvasTexture(beaconCanvas);
  beaconTex.minFilter = THREE.LinearFilter;
  const beaconSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: beaconTex,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    })
  );
  beaconSprite.scale.set(0.024, 0.009, 1);
  beaconSprite.position.set(0, 0.015, 0);
  kartRoot.add(beaconSprite);

  let currentWheelSpinAngle = 0;
  let activeGlbScene = null;

  function updateWheels(dt, speed, steerAngle = 0) {
    const r = 0.0021;
    currentWheelSpinAngle += (speed / r) * dt;

    for (const w of wheelMeshes) {
      w.rotation.x = currentWheelSpinAngle;
    }
    for (const p of frontPivots) {
      p.rotation.y = steerAngle;
    }
  }

  function updateGhostVisuals(dt, speed, steerAngle, elapsedTime) {
    // Subtle breathing float on the beacon sprite
    if (beaconSprite) {
      beaconSprite.position.y = 0.015 + Math.sin(elapsedTime * 3.5) * 0.0012;
    }
    // Subtle pulsating opacity on under-glow halo
    if (ghostHaloQuad && ghostHaloQuad.material) {
      ghostHaloQuad.material.opacity = 0.65 + Math.sin(elapsedTime * 4.0) * 0.15;
    }
  }

  function attachGlbGhost(glbScene) {
    if (!glbScene) return;
    try {
      const ghostGlb = glbScene.clone(true);
      ghostGlb.name = 'GlbGhostKart';

      ghostGlb.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = false;
          child.receiveShadow = false;
          const origName = (child.name || '').toLowerCase();
          const isWheel = origName.includes('wheel') || origName.includes('tire');
          child.material = isWheel ? ghostWheelRubberMat : ghostFairingMat;
        }
      });

      // Hide procedural body meshes if GLB attaches
      noseCone.visible = false;
      floorPan.visible = false;
      driverTorso.visible = false;
      helmetHead.visible = false;
      driverSeat.visible = false;
      visor.visible = false;
      steerWheel.visible = false;

      chassisGroup.add(ghostGlb);
      activeGlbScene = ghostGlb;
    } catch (e) {
      console.warn('GhostKart: attachGlbGhost failed', e);
    }
  }

  return {
    kartRoot,
    chassisGroup,
    beaconSprite,
    ghostHaloQuad,
    updateWheels,
    updateGhostVisuals,
    attachGlbGhost,
    materials: [ghostFairingMat, ghostAccentMat, ghostFrameMat, ghostWheelRubberMat, ghostRimMat],
  };
}
