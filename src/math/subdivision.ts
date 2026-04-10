/**
 * EXPERT SPDA NODAL SOLVER
 * This module implements a full Nodal Analysis using an iterative Gauss-Seidel solver
 * to find the physically correct current distribution (Kirchhoff's Laws) in the SPDA mesh.
 */

export interface SubdivisionPath {
    from: [number, number];
    to: [number, number];
    kc: number;
}

export function getDownConductorNodes(cols: number, rows: number, nDowns: number) {
    const isDownMap = new Map<string, boolean>();
    const downs: {c: number, r: number}[] = [];

    const addDown = (c: number, r: number) => {
        const key = `${c}-${r}`;
        if (!isDownMap.has(key)) {
            isDownMap.set(key, true);
            downs.push({c, r});
        }
    };

    // 1. A NBR 5419-3: Obriga priorizar as quinas para descidas SEMPRE
    if (nDowns >= 1) addDown(0, 0);
    if (nDowns >= 2) addDown(cols, 0);
    if (nDowns >= 3) addDown(cols, rows);
    if (nDowns >= 4) addDown(0, rows);

    // 2. Distribuir o restante (se nDowns > 4) pelo perímetro uniformemente
    let remNeeded = Math.max(0, nDowns - downs.length);
    if (remNeeded > 0) {
        const remainingPerimeter = [];
        for (let c = 1; c < cols; c++) remainingPerimeter.push({c, r: 0});
        for (let r = 1; r < rows; r++) remainingPerimeter.push({c: cols, r});
        for (let c = cols - 1; c > 0; c--) remainingPerimeter.push({c, r: rows});
        for (let r = rows - 1; r > 0; r--) remainingPerimeter.push({c: 0, r});

        if (remainingPerimeter.length > 0) {
            const step = remainingPerimeter.length / remNeeded;
            for (let i = 0; i < remNeeded; i++) {
                const idx = Math.floor(i * step + step / 2) % remainingPerimeter.length;
                const p = remainingPerimeter[idx];
                addDown(p.c, p.r);
            }
        }
    }

    return downs;
}

export function calculateMeshSubdivision(
    hitCol: number,
    hitRow: number,
    cols: number,
    rows: number,
    downNodes: {c: number, r: number}[]
) {
    const nodes: { c: number, r: number, isDown: boolean }[] = [];
    const isDownMap = new Map<string, boolean>();
    downNodes.forEach(d => isDownMap.set(`${d.c}-${d.r}`, true));

    for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
            nodes.push({ c, r, isDown: !!isDownMap.get(`${c}-${r}`) });
        }
    }

    const n = nodes.length;
    const getNodeIdx = (c: number, r: number) => r * (cols + 1) + c;
    
    // Potentials V at each node
    let V = new Float64Array(n).fill(0);
    
    // Iterative Solver (Gauss-Seidel) for Nodal Analysis (KCL)
    const iterations = 800; // Increase iterations for better convergence check
    const I_inj = 1.0;

    for (let it = 0; it < iterations; it++) {
        const nextV = new Float64Array(V);
        for (let i = 0; i < n; i++) {
            const node = nodes[i];
            
            let sumV = 0;
            let count = 0;
            const neighbors = [
                [node.c + 1, node.r], [node.c - 1, node.r], 
                [node.c, node.r + 1], [node.c, node.r - 1]
            ];
            
            for (const [nc, nr] of neighbors) {
                if (nc >= 0 && nc <= cols && nr >= 0 && nr <= rows) {
                    sumV += V[getNodeIdx(nc, nr)];
                    count++;
                }
            }
            
            const inj = (node.c === hitCol && node.r === hitRow) ? I_inj : 0;
            
            if (node.isDown) {
                // Connection to ground: V_node = (sumV_neighs + I_inj) / (count + 1) [where +1 is the ground path]
                nextV[i] = (sumV + inj) / (count + 1); 
            } else {
                nextV[i] = (sumV + inj) / count;
            }
        }
        V = nextV;
    }

    // Now calculate branch currents I = (V1 - V2) / R
    const paths: SubdivisionPath[] = [];
    for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
            const idx = getNodeIdx(c, r);
            const neighs = [[c + 1, r], [c, r + 1]]; // Only positive to avoid double counting
            for (const [nc, nr] of neighs) {
                if (nc <= cols && nr <= rows) {
                    const nIdx = getNodeIdx(nc, nr);
                    const I_branch = Math.abs(V[idx] - V[nIdx]);
                    if (I_branch > 0.001) {
                        // Direction: from higher to lower potential
                        if (V[idx] > V[nIdx]) {
                            paths.push({ from: [c, r], to: [nc, nr], kc: I_branch });
                        } else {
                            paths.push({ from: [nc, nr], to: [c, r], kc: I_branch });
                        }
                    }
                }
            }
        }
    }

    // Calculate kc for each down conductor (current flowing to ground)
    const downCurrents = [];
    let maxKc = 0;
    let totalGroundCurrent = 0;
    
    for (let i = 0; i < n; i++) {
        const node = nodes[i];
        if (node.isDown) {
            const kc = V[i]; // I_ground = V_node / R_ground (R_ground = 1)
            downCurrents.push({ c: node.c, r: node.r, kc });
            totalGroundCurrent += kc;
            if (kc > maxKc) maxKc = kc;
        }
    }
    
    // Normalize slightly if numerical errors (total should exactly equal I_inj = 1.0)
    // Gauss-Seidel might have 0.9999 due to finite iterations
    if (totalGroundCurrent > 0) {
        downCurrents.forEach(d => { d.kc = d.kc / totalGroundCurrent; });
        maxKc = maxKc / totalGroundCurrent;
        paths.forEach(p => { p.kc = p.kc / totalGroundCurrent; });
    }

    return { paths, downCurrents, minKc: maxKc };
}
