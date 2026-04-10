import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { 
  OrbitControls, 
  PerspectiveCamera, 
  Grid, 
  Html,
  ContactShadows,
  Line,
} from '@react-three/drei';
import * as THREE from 'three';

const MagnetoElectricField = ({ start, end, intensity, color }: any) => {
    const groupRef = useRef<THREE.Group>(null);
    const dir = new THREE.Vector3(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    const length = dir.length();
    dir.normalize();
    const mid = new THREE.Vector3(start[0] + end[0], start[1] + end[1], start[2] + end[2]).multiplyScalar(0.5);

    useFrame(({ clock }) => {
        if (!groupRef.current) return;
        const groups = groupRef.current.children;
        const t = (clock.elapsedTime * 2.0) % 1; // Softer, slower propagation
        groups.forEach((group: any, i) => {
            const phase = (t + i / groups.length) % 1;
            const maxR = length * 0.35 + Math.pow(intensity, 0.4) * 8; // Slightly less expansive
            group.scale.set(0.1 + phase * maxR, 0.1 + phase * maxR, 1);
            
            // Softer fade logic
            const baseOp = Math.min(1, 0.2 + intensity * 2);
            const fadeProfile = Math.pow(1 - phase, 1.2); 
            const op = fadeProfile * baseOp;

            group.children.forEach((mesh: any) => {
                if (mesh.material) {
                    mesh.material.opacity = mesh.userData.isEField ? op * 0.25 : op * 0.5; // Softer opacity
                }
            });
        });
    });

    useEffect(() => {
        if (!groupRef.current) return;
        groupRef.current.position.copy(mid);
        const target = mid.clone().add(dir);
        groupRef.current.lookAt(target);
    }, [start, end]);

    if (intensity < 0.02) return null; // Only hide for virtually zero current

    return (
        <group ref={groupRef}>
            {[0, 1, 2, 3].map(i => (
                <group key={i}>
                    {/* Magnetic Field (B) - Glow rings */}
                    <mesh userData={{ isEField: false }}>
                        <ringGeometry args={[1, 1.1, 32]} />
                        <meshBasicMaterial color={color} transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                    {/* Electric Field (E) - Thinner radial lines */}
                    <mesh rotation={[0, 0, Math.PI / 4 * i]} userData={{ isEField: true }}>
                        <planeGeometry args={[2.5, 0.05]} />
                        <meshBasicMaterial color="#ff00ff" transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                </group>
            ))}
        </group>
    );
};

interface SceneProps {
  building: { width: number; height: number; depth: number };
  spda: { meshesCols: number; meshesRows: number; downs: number };
  captures: { id: string; x: number; z: number; h: number; selected?: boolean; type: 'auto' | 'manual' }[];
  loop: { 
    x: number; y: number; z: number; w: number; h: number; dist: number; 
    gaps: { id: string; type: string; size: number; label: string; offset: number; isDPS?: boolean }[];
    distWall: number;
    distSide: number;
    rotY?: number;
  };
  isSparking: boolean;
  lightningHitId: string | null;
  lightningValue: number; 
  lightningModeActive: boolean;
  onSetHitPoint: (id: string | null) => void;
  onSetGapOffset: (id: string, offset: number) => void;
  selectedGapId: string | null;
  onSetSelectedGapId: (id: string | null) => void;
  explicitDowns: { id: string, c: number, r: number }[];
  onMoveDown: (id: string, c: number, r: number) => void;
  onArrowMoveDown: (id: string, dir: number) => void;
  selectedDownId: string | null;
  onSelectDown: (id: string | null) => void;
  onClickLoop?: () => void;
  subdivision?: any;
}

const LightningStrike = ({ start, end }: { start: [number, number, number], end: [number, number, number] }) => {
    const [pts, setPts] = useState<[number, number, number][]>([start, end]);
    useFrame((state) => {
        if (state.clock.elapsedTime % 0.1 > 0.05) {
            const m: [number, number, number][] = [start];
            for (let i = 1; i < 10; i++) {
                const a = i / 10;
                m.push([
                    start[0] + (end[0]-start[0])*a + (Math.random()-0.5)*3,
                    start[1] + (end[1]-start[1])*a,
                    start[2] + (end[2]-start[2])*a + (Math.random()-0.5)*3
                ]);
            }
            m.push(end);
            setPts(m);
        }
    });
    return (
        <group>
            <Line points={pts} color="#66ccff" lineWidth={12} transparent opacity={0.6} />
            <Line points={pts} color="#ffffff" lineWidth={3} />
            <pointLight position={end} intensity={400} distance={100} color="#66ccff" />
        </group>
    );
};


const Conductor = ({ start, end, label, visible, thickness = 1, color: customColor, kc }: any) => {
    // Designer logic: Aggressive scaling to emphasize electrical physics
    const intensity = kc || 0;
    
    // Color mapping: White/Cyan (High Current) -> Deep Blue (Low Current)
    let baseColor = new THREE.Color("#001133");
    if (intensity > 0.3) {
        baseColor = new THREE.Color("#ffffff").lerp(new THREE.Color("#00ffff"), (1 - intensity));
    } else if (intensity > 0.05) {
        baseColor = new THREE.Color("#00ffff").lerp(new THREE.Color("#0055ff"), 1 - (intensity / 0.3));
    } else if (intensity > 0.005) {
        baseColor = new THREE.Color("#0055ff").lerp(new THREE.Color("#001133"), 1 - (intensity / 0.05));
    }

    const color = visible ? baseColor.getStyle() : (customColor || "#c49b63");
    
    // Use direct endpoints to avoid "ugly leftovers" (extensions) at the mesh corners/joints
    const extStart = start;
    const extEnd = end;

    // Softer scaling for thickness so it doesn't break at the joints
    const opacity = visible ? (intensity < 0.01 ? 0.1 : Math.min(1, 0.2 + intensity * 2)) : 1;
    const finalThickness = visible ? Math.max(thickness, thickness * (1 + intensity * 4)) : thickness;

    // Label only shows for reasonably significant currents to avoid visual clutter
    const showLabel = visible && label && intensity > 0.015;

    return (
        <group>
            {/* Magnetic Field Aura (Maxwell) */}
            {intensity > 0.1 && visible && (
                <Line points={[extStart, extEnd]} color="#00ffff" lineWidth={finalThickness * 2} transparent opacity={0.03 * opacity * (1 + intensity)} blending={THREE.AdditiveBlending} depthWrite={false} />
            )}

            {/* Main Current Core */}
            <Line points={[extStart, extEnd]} color={color} lineWidth={finalThickness} transparent opacity={opacity} />
            
            {/* Flutuação Magnética e Elétrica do Professor (Física real de Radiação EM) */}
            {visible && intensity > 0.05 && (
                <MagnetoElectricField start={start} end={end} intensity={intensity} color={color} />
            )}
            
            {showLabel && (
                <Html position={[(start[0]+end[0])/2, (start[1]+end[1])/2, (start[2]+end[2])/2]} center distanceFactor={25} zIndexRange={[1000, 0]}>
                    <div style={{
                        color: '#ffffff',
                        fontWeight: 900,
                        fontSize: '12px',
                        textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 5px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.8)',
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                        transform: 'translate(15px, -15px)'
                    }}>
                        {label}
                    </div>
                </Html>
            )}
        </group>
    );
};

const getPerimeterPos = (offset: number, w: number, h: number): [number, number, number] => {
  const L = 2 * (w + h);
  let d = ((offset % 1) + 1) % 1 * L;
  if (d <= w) return [-w/2 + d, -h/2, 0];
  d -= w; if (d <= h) return [w/2, -h/2 + d, 0];
  d -= h; if (d <= w) return [w/2 - d, h/2, 0];
  d -= w; return [-w/2, h/2 - d, 0];
};

const DraggableGap = ({ gap, loopW, loopH, onDrag, onSelect, isSelected, setLockControls }: any) => {
    const [isDragging, setIsDragging] = useState(false);
    const { raycaster } = useThree();
    const groupRef = useRef<THREE.Group>(null);

    useEffect(() => {
        if (!isSelected) return;
        const h = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); onDrag(gap.offset - 0.005); }
            if (e.key === 'ArrowRight') { e.preventDefault(); onDrag(gap.offset + 0.005); }
        };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [isSelected, gap.offset, onDrag]);

    const onPointerDown = (e: any) => { e.stopPropagation(); setIsDragging(true); onSelect(gap.id); setLockControls(true); };
    const onGlobalUp = useCallback(() => { setIsDragging(false); setLockControls(false); }, [setLockControls]);

    const onPointerMove = (_e: any) => {
        if (!isDragging || !groupRef.current) return;
        const worldPos = groupRef.current.parent!.getWorldPosition(new THREE.Vector3());
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -worldPos.z);
        const target = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, target);
        const local = target.sub(worldPos);
        const L = 2 * (loopW + loopH);
        const dx = local.x, dy = local.y;
        const dB = Math.abs(dy + loopH/2), dT = Math.abs(dy - loopH/2), dR = Math.abs(dx - loopW/2), dL = Math.abs(dx + loopW/2);
        const min = Math.min(dB, dT, dR, dL);
        let d = 0;
        if (min === dB) d = THREE.MathUtils.clamp(dx + loopW/2, 0, loopW);
        else if (min === dR) d = loopW + THREE.MathUtils.clamp(dy + loopH/2, 0, loopH);
        else if (min === dT) d = loopW + loopH + THREE.MathUtils.clamp(loopW/2 - dx, 0, loopW);
        else d = loopW + loopH + loopW + THREE.MathUtils.clamp(loopH/2 - dy, 0, loopH);
        onDrag(d / L);
    };

    const [px, py, pz] = getPerimeterPos(gap.offset, loopW, loopH);

    return (
        <group ref={groupRef} position={[px, py, pz]} onPointerDown={onPointerDown} onPointerUp={onGlobalUp} onPointerMove={onPointerMove} onPointerLeave={onGlobalUp}>
            {/* Visual Gap Representation: Parallel Plates or DPS Filter */}
            {!gap.isDPS ? (
                <>
                    <mesh position={[-0.15, 0, 0]}><boxGeometry args={[0.1, 0.8, 0.8]} /><meshStandardMaterial color={isSelected ? "#00ffff" : "#ff3333"} emissive={isSelected ? "#00ffff" : "#ff0000"} emissiveIntensity={1} /></mesh>
                    <mesh position={[0.15, 0, 0]}><boxGeometry args={[0.1, 0.8, 0.8]} /><meshStandardMaterial color={isSelected ? "#00ffff" : "#ff3333"} emissive={isSelected ? "#00ffff" : "#ff0000"} emissiveIntensity={1} /></mesh>
                    {/* Glowing Core for emphasis */}
                    <mesh><sphereGeometry args={[0.3, 16, 16]} /><meshStandardMaterial color={isSelected ? "#ffffff" : "#ffaa00"} emissive={isSelected ? "#00ffff" : "#ff4400"} emissiveIntensity={isSelected ? 4 : 2} transparent opacity={0.9} /></mesh>
                </>
            ) : (
                <>
                    <mesh><boxGeometry args={[0.5, 0.8, 0.8]} /><meshStandardMaterial color="#00ffff" emissive="#00ffff" emissiveIntensity={0.5} transparent opacity={0.9}/></mesh>
                    <mesh position={[0,0,0.41]}><planeGeometry args={[0.3,0.3]} /><meshBasicMaterial color="#ffffff" side={THREE.DoubleSide}/></mesh> {/* Símbolo DPS */}
                </>
            )}
            
            {/* Interaction Hull (invisible but large for easy clicking) */}
            <mesh><sphereGeometry args={[1.0, 16, 16]} /><meshBasicMaterial visible={false} /></mesh>

            {/* High-visibility HTML Overlay Label */}
            <Html position={[0, 0.8, 0]} center distanceFactor={25} zIndexRange={[1000, 0]}>
                <div style={{
                    color: isSelected ? '#00ffff' : (gap.isDPS ? '#00ffff' : '#ff5555'),
                    fontWeight: 900,
                    fontSize: '12px',
                    textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    padding: '2px 8px',
                    border: `1.5px solid ${isSelected ? '#00ffff' : (gap.isDPS ? '#00cccc' : '#ff3333')}`,
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    borderRadius: '6px',
                    boxShadow: isSelected ? '0 0 10px rgba(0, 255, 255, 0.5)' : (gap.isDPS ? '0 0 10px rgba(0, 255, 255, 0.3)' : 'none')
                }}>
                    {gap.isDPS ? `🛡️ ${gap.label} (DPS ATIVO)` : `⚡ ${gap.label} - ${gap.size}mm`}
                </div>
            </Html>
        </group>
    );
};

const DraggableDownNode = ({ p, isActive, dkc, dkA, setLockControls, onMove, mc, mr, bw, bd, bh, isSelected, onSelect, disabled }: any) => {
    const [isDragging, setIsDragging] = useState(false);
    const { raycaster } = useThree();

    const onPointerDown = (e: any) => { 
        if (disabled) return;
        e.stopPropagation(); setIsDragging(true); setLockControls(true); onSelect(p.id); 
    };
    const onGlobalUp = useCallback(() => { setIsDragging(false); setLockControls(false); }, [setLockControls]);

    const onPointerMove = (_e: any) => {
        if (!isDragging || disabled) return;
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(bh));
        const target = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, target);

        let clampedX = Math.max(-bw/2, Math.min(bw/2, target.x));
        let clampedZ = Math.max(-bd/2, Math.min(bd/2, target.z));
        const dL = Math.abs(clampedX - (-bw/2)), dR = Math.abs(clampedX - bw/2);
        const dT = Math.abs(clampedZ - (-bd/2)), dB = Math.abs(clampedZ - bd/2);
        const minEdge = Math.min(dL, dR, dT, dB);
        if (minEdge === dL) clampedX = -bw/2;
        else if (minEdge === dR) clampedX = bw/2;
        else if (minEdge === dT) clampedZ = -bd/2;
        else clampedZ = bd/2;

        let fc = (clampedX - (-bw/2)) / (bw/mc);
        let fr = (clampedZ - (-bd/2)) / (bd/mr);

        if (Math.abs(fc - Math.round(fc)) < 0.25) fc = Math.round(fc);
        if (Math.abs(fr - Math.round(fr)) < 0.25) fr = Math.round(fr);

        if (fc !== p.c || fr !== p.r) onMove(p.id, fc, fr);
    };

    const ringOffset = 1.2;
    const ringY = -0.5;
    let groundEnd: [number, number, number] = [p.x, ringY, p.z];
    
    if (Math.abs(p.z) >= bd/2 - 0.01) groundEnd = [p.x, ringY, Math.sign(p.z) * (bd/2 + ringOffset)];
    else if (Math.abs(p.x) >= bw/2 - 0.01) groundEnd = [Math.sign(p.x) * (bw/2 + ringOffset), ringY, p.z];

    return (
        <group onPointerDown={disabled ? undefined : onPointerDown} onPointerUp={onGlobalUp} onPointerMove={onPointerMove} onPointerLeave={onGlobalUp}>
            {/* Hitbox Invisível para arrastar a descida */}
            <mesh position={[p.x, bh/2, p.z]} onPointerOver={() => {if (!disabled) document.body.style.cursor='ew-resize'}} onPointerOut={() => document.body.style.cursor='auto'}><boxGeometry args={[2, bh, 2]} /><meshBasicMaterial visible={false}/></mesh>
            <Conductor start={[p.x, bh, p.z]} end={[p.x, 0, p.z]} label={isActive ? `${dkA.toFixed(1)}kA (${(dkc*100).toFixed(1)}%)` : ""} visible={isActive || isSelected} thickness={isSelected ? 4 : 3} kc={isActive ? dkc : (isSelected ? 0.05 : null)} color={isSelected ? "#00aaff" : undefined} />
            <Line points={[[p.x, 0, p.z], [p.x, ringY, p.z]]} color={isSelected ? "#00aaff" : "#444"} lineWidth={isSelected ? 3 : 2} />
            <Conductor start={[p.x, ringY, p.z]} end={groundEnd} visible={isActive || isSelected} thickness={isSelected ? 4 : 3} color={isSelected ? "#00aaff" : "#444"} />
        </group>
    );
};

const SPDACore = (props: SceneProps & { setLockControls: (v: boolean) => void }) => {
    const bw = props.building.width, bh = props.building.height, bd = props.building.depth;
    const mc = Math.max(1, props.spda.meshesCols), mr = Math.max(1, props.spda.meshesRows);
    const isActive = !!props.lightningHitId;
    const isLocked = props.lightningModeActive || isActive;

    useEffect(() => {
        if (!props.selectedDownId || isLocked) return;
        const h = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); props.onArrowMoveDown(props.selectedDownId, -1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); props.onArrowMoveDown(props.selectedDownId, 1); }
        };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [props.selectedDownId, props.onArrowMoveDown]);

    const downsPositions = useMemo(() => {
        return (props.explicitDowns || []).map(p => {
            const x = -(bw/2) + p.c * (bw/mc);
            const z = -(bd/2) + p.r * (bd/mr);
            return { x, z, c: p.c, r: p.r, id: p.id };
        });
    }, [props.explicitDowns, bw, bd, mc, mr]);


    return (
        <group>
            <mesh position={[0, bh/2, 0]}><boxGeometry args={[bw, bh, bd]} /><meshStandardMaterial color="#444" transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} /></mesh>
            <Line points={[[-bw/2-1.2, -0.5, -bd/2-1.2], [bw/2+1.2, -0.5, -bd/2-1.2], [bw/2+1.2, -0.5, bd/2+1.2], [-bw/2-1.2, -0.5, bd/2+1.2], [-bw/2-1.2, -0.5, -bd/2-1.2]]} color="#444" lineWidth={5} />
            
            {/* Mesh visualization */}
            {Array.from({length: mc+1}).map((_, i) => (<Conductor key={`xm-${i}`} start={[-(bw/2)+(i*(bw/mc)), bh, -bd/2]} end={[-(bw/2)+(i*(bw/mc)), bh, bd/2]} visible={false} thickness={1} />))}
            {Array.from({length: mr+1}).map((_, j) => (<Conductor key={`zm-${j}`} start={[-bw/2, bh, -(bd/2)+(j*(bd/mr))]} end={[bw/2, bh, -(bd/2)+(j*(bd/mr))]} visible={false} thickness={1} />))}

            {/* Active Current Subdivision Rendering (Expert Physicist Model) */}
            {props.subdivision?.paths.map((p: any, idx: number) => {
                const s = [-(bw/2)+p.from[0]*(bw/mc), bh, -(bd/2)+p.from[1]*(bd/mr)];
                const e = [-(bw/2)+p.to[0]*(bw/mc), bh, -(bd/2)+p.to[1]*(bd/mr)];
                const iVal = p.kc * props.lightningValue;
                const label = `${iVal.toFixed(1)}kA (${(p.kc*100).toFixed(0)}%)`;
                return <Conductor key={`sub-${idx}`} start={s} end={e} label={label} visible={true} kc={p.kc} thickness={2} />;
            })}

            {downsPositions.map((p: any) => {
                const isActive = !!props.lightningHitId;
                let dkc = 1 / props.spda.downs;
                if (isActive && props.subdivision?.downCurrents) {
                    const matchedDown = props.subdivision.downCurrents.find((d: any) => d.c === p.c && d.r === p.r);
                    if (matchedDown) dkc = matchedDown.kc;
                }
                const dkA = dkc * props.lightningValue;
                
                return (
                    <DraggableDownNode 
                        key={p.id} p={p} isActive={isActive} dkc={dkc} dkA={dkA}
                        setLockControls={props.setLockControls} onMove={props.onMoveDown}
                        mc={mc} mr={mr} bw={bw} bd={bd} bh={bh}
                        isSelected={props.selectedDownId === p.id} onSelect={props.onSelectDown}
                        disabled={isLocked}
                    />
                );
            })}
            {props.captures.map((cap: any) => {
                const isHit = cap.id === props.lightningHitId, active = props.lightningModeActive;
                const h = cap.h || 0;
                return (
                    <group key={cap.id} position={[cap.x, bh, cap.z]}>
                        <mesh onClick={(e) => { e.stopPropagation(); if(active) props.onSetHitPoint(cap.id); }} onPointerOver={() => { if(active) document.body.style.cursor='crosshair'; }} onPointerOut={() => { document.body.style.cursor='auto'; }}>
                            <cylinderGeometry args={[0.5, 0.5, h > 0 ? h + 1 : 0.8, 8]} />
                            <meshBasicMaterial visible={false} />
                        </mesh>
                        {h > 0 && <mesh position={[0, h/2, 0]}><cylinderGeometry args={[0.02, 0.05, h, 8]} /><meshStandardMaterial color={isHit ? "#fff" : (active ? "#ffdd00" : "#999")} emissive={isHit ? "#fff" : (active ? "#ffdd00" : "#555")} emissiveIntensity={isHit ? 30 : 0}/></mesh>}
                        {isHit && <LightningStrike start={[0, 70, 0]} end={[0, h, 0]} />}
                    </group>
                );
            })}

            {/* Mesh Node Hit Targets (Stealth Tech: Invisible hitboxes) */}
            {props.lightningModeActive && Array.from({length: mc+1}).map((_, i) => (
                Array.from({length: mr+1}).map((_, j) => {
                    const id = `node-${i}-${j}`;
                    const x = -(bw/2) + (i*(bw/mc));
                    const z = -(bd/2) + (j*(bd/mr));
                    const isHit = props.lightningHitId === id;
                    return (
                        <group key={id} position={[x, bh + 0.05, z]}>
                            <mesh onClick={(e) => { e.stopPropagation(); props.onSetHitPoint(id); }} onPointerOver={() => { document.body.style.cursor='crosshair'; }} onPointerOut={() => { document.body.style.cursor='auto'; }}>
                                <sphereGeometry args={[0.8, 16, 16]} />
                                <meshBasicMaterial visible={false} />
                            </mesh>
                            {isHit && <LightningStrike start={[0, 70, 0]} end={[0, 0, 0]} />}
                        </group>
                    );
                })
            ))}
            {/* Loop de Vítima (Instalação Interna) */}
            <group 
                position={[-(bw/2) + props.loop.distSide + props.loop.w/2, props.loop.y + props.loop.h/2, (bd/2) - props.loop.distWall]}
                rotation={[0, (props.loop.rotY || 0) * Math.PI / 180, 0]}
                onClick={(e) => { e.stopPropagation(); props.onClickLoop?.(); }}
                onPointerOver={() => document.body.style.cursor = 'pointer'}
                onPointerOut={() => document.body.style.cursor = 'auto'}
            >
                <mesh>
                    <boxGeometry args={[props.loop.w, props.loop.h, 0.05]} />
                    <meshStandardMaterial color={props.isSparking ? "#ff0000" : (props.loop.gaps.some(g=>g.isDPS) ? "#00ffff" : "#ff6600")} emissive={props.isSparking ? "#ff0000" : (props.loop.gaps.some(g=>g.isDPS) ? "#00ffff" : "#ff6600")} emissiveIntensity={props.isSparking ? 2 : 0.2} transparent opacity={0.6} />
                </mesh>
                <Line points={[[-props.loop.w/2, -props.loop.h/2, 0], [props.loop.w/2, -props.loop.h/2, 0], [props.loop.w/2, props.loop.h/2, 0], [-props.loop.w/2, props.loop.h/2, 0], [-props.loop.w/2, -props.loop.h/2, 0]]} color={props.isSparking ? "#ff0000" : (props.loop.gaps.some(g=>g.isDPS) ? "#00ffff" : "#ff6600")} lineWidth={4} />
                
                {/* Visualizadores de Gaps/Pontos de Ruptura completos e interativos */}
                {props.loop.gaps.map((gap: any) => (
                    <DraggableGap 
                        key={gap.id} 
                        gap={gap} 
                        loopW={props.loop.w} 
                        loopH={props.loop.h} 
                        onDrag={(off: number) => props.onSetGapOffset(gap.id, off)}
                        onSelect={props.onSetSelectedGapId} 
                        isSelected={props.selectedGapId === gap.id} 
                        setLockControls={props.setLockControls} 
                    />
                ))}
            </group>
        </group>
    );
};

export const Scene = (props: SceneProps) => {
  const [lockControls, setLockControls] = useState(false);
  const max = Math.max(props.building.width, props.building.height, props.building.depth, 10);
  return (
    <div style={{ width: '100%', height: '100%', background: '#050505' }}>
        <Canvas gl={{ antialias: true }} camera={{ position: [max*1.5, max*1.2, max*1.5], fov: 40 }} onPointerMissed={() => props.onSelectDown?.(null)}>
            <PerspectiveCamera makeDefault position={[max*1.5, max*1.2, max*1.5]} fov={40} />
            <OrbitControls enableDamping dampingFactor={0.05} enabled={!lockControls} />
            <ambientLight intensity={1.5} />
            <pointLight position={[max, max, max]} intensity={2.5} />
            <SPDACore {...props} setLockControls={setLockControls} />
            <Grid infiniteGrid sectionSize={5} sectionThickness={1.5} sectionColor="#333" cellColor="#111" position={[0, -0.01, 0]} />
            <ContactShadows scale={max*4} blur={3} opacity={0.65} far={max} />
        </Canvas>
    </div>
  );
};
