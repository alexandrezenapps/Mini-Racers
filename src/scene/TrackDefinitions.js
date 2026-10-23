import * as THREE from 'three';

export const CIRCUITS = [
  {
    id: 'circuit_1',
    name: 'Circuit 1 : Desk Coaster (Classique)',
    shortName: 'Circuit 1',
    levelLabel: 'NIVEAU 1 · CLASSIQUE',
    difficulty: 'Découverte',
    turnsCount: 6,
    badgeColor: '#00e8ff',
    description: 'Le circuit original fluide et spectaculaire autour des objets du bureau.',
    features: ['Grandes boucles fluides', 'Hélice du Chat 360°', 'Tire-bouchon de la Lampe'],
  },
  {
    id: 'circuit_2',
    name: 'Circuit 2 : Grand Prix Pro (Expert)',
    shortName: 'Circuit 2',
    levelLabel: 'NIVEAU 2 · EXPERT',
    difficulty: 'Niveau Supérieur',
    turnsCount: 19,
    badgeColor: '#ff9d00',
    description: 'Niveau au-dessus ultra technique avec 19 virages : chicanes serrées, double épingle et slalom.',
    features: ['19 virages techniques', 'Slalom du tapis de souris', 'Double épingle du chat', 'Chicane des stands'],
  },
];

export const CIRCUIT_2_CONTROL_POINTS = [
  // Sector 1: S-Bends des Écrans & Sky Climb (Montée BoYata avec chicanes S)
  [-0.505, 0.052, 0.155, 12.0, 1],
  [-0.525, 0.095, 0.080, 16.0, 1],
  [-0.460, 0.135, 0.015, -14.0, 1],
  [-0.510, 0.165, -0.045, 18.0, 1],
  [-0.465, 0.188, -0.085, 15.0, 1],
  [-0.395, 0.175, -0.055, -12.0, 1],
  [-0.335, 0.135, -0.010, -8.0, 1],
  [-0.265, 0.115, -0.065, 14.0, 1],

  // Sector 2: L'Épingle du Chat (Double Épingle technique)
  [-0.215, 0.110, -0.115, 24.0, 2],
  [-0.175, 0.095, -0.165, 26.0, 2],
  [-0.125, 0.080, -0.175, 24.0, 2],
  [-0.095, 0.068, -0.125, 12.0, 2],
  [-0.125, 0.055, -0.075, -22.0, 2],
  [-0.185, 0.045, -0.065, -24.0, 2],
  [-0.225, 0.038, -0.115, 20.0, 2],
  [-0.180, 0.030, -0.170, 22.0, 2],
  [-0.120, 0.026, -0.165, 15.0, 2],

  // Sector 3: Chicane du Microphone & Boom-Arm Ridge
  [-0.075, 0.024, -0.085, 8.0, 3],
  [-0.025, 0.026, -0.030, -14.0, 3],
  [0.035, 0.048, -0.065, 16.0, 3],
  [0.095, 0.085, -0.040, -10.0, 3],
  [0.155, 0.125, -0.085, 8.0, 3],
  [0.225, 0.168, -0.145, 12.0, 3],

  // Sector 4: Double Épingle & Corkscrew de la Lampe
  [0.285, 0.190, -0.135, 22.0, 4],
  [0.355, 0.178, -0.172, 24.0, 4],
  [0.420, 0.155, -0.135, 22.0, 4],
  [0.405, 0.132, -0.055, 18.0, 4],
  [0.340, 0.112, -0.025, -16.0, 4],
  [0.285, 0.095, -0.075, 20.0, 4],
  [0.320, 0.075, -0.155, 22.0, 4],
  [0.395, 0.058, -0.145, 22.0, 4],
  [0.425, 0.042, -0.075, 18.0, 4],

  // Sector 5: Slalom Technique du Tapis de Souris (4 virages serrés)
  [0.428, 0.028, 0.010, 16.0, 5],
  [0.435, 0.020, 0.085, 22.0, 5],
  [0.380, 0.022, 0.155, -22.0, 5],
  [0.315, 0.024, 0.105, 22.0, 5],
  [0.260, 0.026, 0.175, -18.0, 5],
  [0.325, 0.028, 0.235, 14.0, 5],
  [0.245, 0.033, 0.255, 6.0, 5],

  // Sector 6: Ligne Droite des Stands & Chicane Finale
  [0.160, 0.035, 0.255, 0.0, 6],
  [0.080, 0.035, 0.255, 0.0, 6],
  [0.000, 0.035, 0.255, 0.0, 6], // Ligne d'arrivée / Start Gantry
  [-0.100, 0.035, 0.255, 0.0, 6],
  [-0.200, 0.035, 0.255, 0.0, 6],
  [-0.280, 0.035, 0.255, 0.0, 6],
  [-0.340, 0.035, 0.265, -12.0, 6], // Chicane finale
  [-0.400, 0.035, 0.240, 14.0, 6],
  [-0.460, 0.036, 0.220, 8.0, 6],
];

export const CIRCUIT_2_SECTORS = [
  { id: 1, name: 'S-Bends des Écrans & Sky Climb' },
  { id: 2, name: "L'Épingle du Chat & Switchback" },
  { id: 3, name: 'Chicane du Microphone & Crête' },
  { id: 4, name: 'Double Épingle de la Lampe' },
  { id: 5, name: 'Slalom Technique du Tapis de Souris' },
  { id: 6, name: 'Ligne Droite des Stands & Chicane Finale' },
];

/**
 * Builds a C2 continuous 720-sample spline representation for Circuit 2
 * matching the exact structure required by KartPhysicsController and CoasterTrackBuilder.
 */
export function buildCircuit2SplineData() {
  const controlPoints = CIRCUIT_2_CONTROL_POINTS;
  const numCp = controlPoints.length;
  const points = controlPoints.map((cp) => new THREE.Vector3(cp[0], cp[1], cp[2]));
  const banks = controlPoints.map((cp) => cp[3]);
  const sectors = controlPoints.map((cp) => cp[4]);

  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal', 0.5);

  const numSamples = 720;
  const rawPositions = [];
  const rawTangents = [];
  const rawRights = [];
  const rawNormals = [];
  const rawBanks = [];
  const rawSectors = [];

  const _upRef = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < numSamples; i++) {
    const t = i / numSamples;
    const pos = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();

    // Map t to control point index for bank and sector
    const cpIndexF = t * numCp;
    const cp0 = Math.floor(cpIndexF) % numCp;
    const cp1 = (cp0 + 1) % numCp;
    const frac = cpIndexF - Math.floor(cpIndexF);

    const bankDeg = THREE.MathUtils.lerp(banks[cp0], banks[cp1], frac);
    const sectorId = frac < 0.5 ? sectors[cp0] : sectors[cp1];

    // Compute robust right-handed orthonormal frame
    const up = Math.abs(tangent.y) > 0.94 ? new THREE.Vector3(0, 0, 1) : _upRef;
    const rightRaw = new THREE.Vector3().crossVectors(tangent, up).normalize();
    const normalRaw = new THREE.Vector3().crossVectors(rightRaw, tangent).normalize();

    // Rotate frame by banking angle
    const bankRad = (bankDeg * Math.PI) / 180;
    const cosB = Math.cos(bankRad);
    const sinB = Math.sin(bankRad);

    const right = new THREE.Vector3()
      .copy(rightRaw)
      .multiplyScalar(cosB)
      .addScaledVector(normalRaw, sinB)
      .normalize();

    const normal = new THREE.Vector3().crossVectors(right, tangent).normalize();

    rawPositions.push([pos.x, pos.y, pos.z]);
    rawTangents.push([tangent.x, tangent.y, tangent.z]);
    rawRights.push([right.x, right.y, right.z]);
    rawNormals.push([normal.x, normal.y, normal.z]);
    rawBanks.push(bankDeg);
    rawSectors.push(sectorId);
  }

  // Cumulative arc lengths
  const arcLengths = new Float32Array(numSamples);
  arcLengths[0] = 0;
  for (let i = 1; i < numSamples; i++) {
    const p0 = rawPositions[i - 1];
    const p1 = rawPositions[i];
    arcLengths[i] = arcLengths[i - 1] + Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  }
  const lastP = rawPositions[numSamples - 1];
  const firstP = rawPositions[0];
  const totalLength = arcLengths[numSamples - 1] + Math.hypot(firstP[0] - lastP[0], firstP[1] - lastP[1], firstP[2] - lastP[2]);

  const samples = [];
  for (let i = 0; i < numSamples; i++) {
    samples.push({
      index: i,
      t: i / numSamples,
      sector: rawSectors[i],
      position: rawPositions[i],
      tangent: rawTangents[i],
      right: rawRights[i],
      normal: rawNormals[i],
      bank_deg: rawBanks[i],
      arc_length_m: arcLengths[i],
    });
  }

  return {
    name: 'Grand Prix Pro (Circuit 2 - Expert 19 Virages)',
    is_closed_periodic_loop: true,
    track_width_m: 0.022,
    curb_width_m: 0.0025,
    rail_height_m: 0.0035,
    total_length_m: totalLength,
    scale_equivalent_length_m: totalLength * 87.0,
    num_control_points: numCp,
    num_samples: numSamples,
    sectors: CIRCUIT_2_SECTORS,
    control_points: controlPoints,
    samples,
  };
}

let cachedCircuit2Spline = null;

export function getTrackSplineForCircuit(circuitId, baseCircuit1Spline) {
  if (circuitId === 'circuit_2') {
    if (!cachedCircuit2Spline) {
      cachedCircuit2Spline = buildCircuit2SplineData();
    }
    return cachedCircuit2Spline;
  }
  return baseCircuit1Spline;
}
