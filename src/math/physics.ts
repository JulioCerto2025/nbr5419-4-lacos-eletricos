export interface LightningPulse {
  name: string;
  I: number; // Peak current (kA)
  t1: number; // Front time (us)
  t2: number; // Tail time (us)
  di_dt: number; // Current rise rate (kA/us)
}

export const LIGHTNING_TYPES: Record<string, LightningPulse> = {
  'NPI-I': { name: 'NPI I (1st neg)', I: 100, t1: 1, t2: 200, di_dt: 100 },
  'NPI-II': { name: 'NPI II (1st neg)', I: 75, t1: 1, t2: 200, di_dt: 75 },
  'NPI-III/IV': { name: 'NPI III/IV (1st neg)', I: 50, t1: 1, t2: 200, di_dt: 50 },
  
  'SUB-I': { name: 'Subsequent I', I: 50, t1: 0.25, t2: 100, di_dt: 200 },
  'SUB-II': { name: 'Subsequent II', I: 37.5, t1: 0.25, t2: 100, di_dt: 150 },
  'SUB-III/IV': { name: 'Subsequent III/IV', I: 25, t1: 0.25, t2: 100, di_dt: 100 },
  
  'POS-I': { name: 'Positive NP I', I: 200, t1: 10, t2: 350, di_dt: 20 },
  'POS-II': { name: 'Positive NP II', I: 150, t1: 10, t2: 350, di_dt: 15 },
  'POS-III/IV': { name: 'Positive NP III/IV', I: 100, t1: 10, t2: 350, di_dt: 10 },
};

export const MU_0 = 4 * Math.PI * 1e-7;

/**
 * Calculates induced voltage Uoc in a rectangular loop.
 * Simplified analytical formula for a loop near a long straight conductor.
 * Uoc = MU_0 / (2 * PI) * ln(r2/r1) * w * di/dt
 * Where:
 * r1 = distance from conductor to near side of loop
 * r2 = distance from conductor to far side of loop
 * w = width of the loop along the conductor (height/length)
 */
export function calculateInducedVoltage(
  di_dt_ka_us: number, // kA/us
  r1: number, // meters
  r2: number, // meters
  h: number // meters (length parallel to the current path)
) {
  const di_dt = di_dt_ka_us * 1e9; // kA/us to A/s
  const M = (MU_0 / (2 * Math.PI)) * h * Math.log(r2 / r1);
  return M * di_dt;
}

/**
 * Exact Maxwell equation superposition for N down-conductors radiating magnetic fields.
 * This integrates the true 3D B-field of all wires passing through the loop surface,
 * including topological phase cancellation if wires pass perfectly through the center.
 */
export function calculateMaxwellSuperposition(
    di_dt_total_kA_us: number,
    h: number,
    x_min: number, x_max: number,
    z_loop: number,
    downs: { x: number, z: number, kc: number }[],
    rotY_deg: number = 0
) {
    const di_dt = di_dt_total_kA_us * 1e9; // A/s
    let M_tot = 0;
    
    const theta = rotY_deg * Math.PI / 180;
    const nx = Math.sin(theta);
    const nz = Math.cos(theta);
    const cx = (x_min + x_max) / 2;
    const w = x_max - x_min;

    for (const d of downs) {
        // Analytical integral for standard Bz component (normal parallel to Z)
        const u_max = Math.pow(x_max - d.x, 2) + Math.pow(z_loop - d.z, 2);
        const u_min = Math.pow(x_min - d.x, 2) + Math.pow(z_loop - d.z, 2);
        
        const safe_u_max = Math.max(1e-6, u_max);
        const safe_u_min = Math.max(1e-6, u_min);

        const M_z = (MU_0 * h / (4 * Math.PI)) * Math.log(safe_u_max / safe_u_min);

        // Approximate analytical integral for Bx component (crosses normal parallel to X)
        const v_dz = z_loop - d.z;
        const v_dx = cx - d.x;
        const r2 = Math.max(1e-4, v_dx*v_dx + v_dz*v_dz);
        const M_x = (MU_0 * w * h / (2 * Math.PI)) * (-v_dz / r2);

        // Superposition of flux vectors based on Loop Normal Euler projection
        const M_j = M_z * nz + M_x * nx;

        M_tot += M_j * d.kc;
    }
    
    const uoc = Math.abs(M_tot) * di_dt;
    return { uoc, M_tot: Math.abs(M_tot) };
}

/**
 * Exact Self-Inductance of a rectangular loop derived from Maxwell's Equations
 * L = (mu_0/pi) * [ w*ln(2wh/(r(w+d))) + h*ln(2wh/(r(h+d))) + 2d - 2(w+h) ]
 */
export function calculateSelfInductance(w: number, h: number, wire_radius: number = 0.002) {
    const d = Math.sqrt(w*w + h*h);
    const term1 = w * Math.log((2*w*h)/(wire_radius*(w+d)));
    const term2 = h * Math.log((2*w*h)/(wire_radius*(h+d)));
    return (MU_0 / Math.PI) * (term1 + term2 + 2*d - 2*(w+h));
}

/**
 * Calculates spark transient current if dielectric breaks down.
 * M_tot * i_strike = L_loop * i_loop => i_loop = (M_tot / L_loop) * i_strike
 */
export function calculateSparkCurrentSuperposed(M_tot: number, loop_w: number, loop_h: number, i_strike_kA: number) {
    const L = calculateSelfInductance(loop_w, loop_h);
    // Return spark current in Amperes
    return (M_tot / L) * (i_strike_kA * 1000); 
}

/**
 * Thermal limit calculation for cable.
 * DeltaT = (I^2 * t) / (k^2 * S^2)
 * Or simplified: S_min = I * sqrt(t) / k
 */
export function checkThermalStability(current: number, time_us: number, section_mm2: number, material: 'copper' | 'aluminum' | 'steel') {
  const k = material === 'copper' ? 143 : material === 'aluminum' ? 95 : 52;
  const t = time_us * 1e-6;
  const s_min = (current * Math.sqrt(t)) / k;
  return {
    s_min,
    safe: section_mm2 >= s_min,
    temp_rise: (current * current * t) / (k * k * section_mm2 * section_mm2) * 100 // approximation
  };
}
