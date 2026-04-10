import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Scene } from './components/Scene';
import { LIGHTNING_TYPES, calculateMaxwellSuperposition, calculateSparkCurrentSuperposed } from './math/physics';
import { calculateMeshSubdivision, getDownConductorNodes } from './math/subdivision';
import { 
  Zap, Box, Radio, 
  Layers, Trash2, X,
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Capture { id: string; x: number; z: number; h: number; type: 'auto' | 'manual' }
interface Gap { id: string; type: string; size: number; label: string; offset: number; isDPS?: any }
interface Loop { x: number; y: number; z: number; w: number; h: number; distWall: number; distSide: number; rotY?: number; gaps: Gap[]; material: string }

const CompactSlider = ({ label, value, min, max, step, onChange, unit = '', disabled }: any) => {
    const [localVal, setLocalVal] = useState(value.toString());

    // Sync from parent if changed externally (e.g., arrow controls)
    useEffect(() => {
        if (parseFloat(localVal) !== value) {
            setLocalVal(value.toString());
        }
    }, [value]);

    const submitVal = (valStr: string) => {
        if (valStr === '') { setLocalVal(value.toString()); return; }
        const parsed = parseFloat(valStr);
        if (!isNaN(parsed)) {
            const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, parsed));
            onChange(clamped);
            setLocalVal(clamped.toString()); // Re-sync to clamped immediately
        } else {
            setLocalVal(value.toString());
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (disabled) return;
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            onChange(Math.min(max ?? Infinity, value + step));
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            onChange(Math.max(min ?? -Infinity, value - step));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            submitVal(localVal);
        }
    };

    return (
        <div className={`flex justify-between items-center p-1.5 px-2 border border-white/5 rounded-md transition-colors group ${disabled ? 'opacity-40 cursor-not-allowed bg-transparent' : 'bg-black/40 hover:bg-white/5'}`}>
            <label className="text-[10px] text-white/50 font-bold uppercase tracking-wide w-16 shrink-0 text-left">{label}</label>
            <div className="flex items-center gap-1 shrink-0">
                <input 
                    type="number" 
                    value={localVal} 
                    onKeyDown={handleKeyDown}
                    onChange={e => setLocalVal(e.target.value)} 
                    onBlur={() => submitVal(localVal)}
                    disabled={disabled}
                    className="w-14 bg-black border border-white/10 rounded py-0.5 px-1 text-[11px] font-black text-primary text-center outline-none group-hover:border-primary/50 focus:border-primary transition-colors disabled:opacity-50" 
                />
                <span className="text-[9px] text-white/30 uppercase font-black w-3 text-left">
                    {unit || ''}
                </span>
            </div>
        </div>
    );
};

function App() {
  const [building, setBuilding] = useState({ width: 25, height: 12, depth: 15, level: 'III' });
  const [spda, setSpda] = useState({ 
    meshRows: 4, meshCols: 4, downs: 6,
    autoCapHeight: 2.5,
    showCaptors: true,
    autoCapMode: 'all-vertices' as 'none' | 'corners' | 'all-vertices' | 'perimeter'
  });
  
  const [lightningKey, setLightningKey] = useState('NPI-I');
  const [lightningHitId, setLightningHitId] = useState<string | null>(null);
  const [simulationActive, setSimulationActive] = useState(false);
  const [selectedGapId, setSelectedGapId] = useState<string | null>(null);
  const [showLoopEditor, setShowLoopEditor] = useState(false);
  const [openSection, setOpenSection] = useState<number>(4);

  const AccordionItem = useCallback(({ num, icon: Icon, title, children }: any) => {
      const isOpen = openSection === num;
      return (
          <div className="mb-3">
              <div 
                  onClick={() => setOpenSection(isOpen ? 0 : num)} 
                  className={`w-full flex items-center justify-between p-4 rounded-xl cursor-pointer transition-all duration-500 ease-out border ${isOpen ? 'bg-[#181510] border-primary/30 shadow-[0_8px_30px_rgba(196,155,99,0.12)]' : 'bg-[#0f0f0f] border-white/5 hover:bg-[#161616] hover:border-white/10'}`}
              >
                  <div className="flex items-center gap-4">
                      <div className={`flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-500 ${isOpen ? 'bg-primary/10 text-primary shadow-inner scale-110' : 'bg-white/5 text-white/30'}`}>
                          <Icon size={18} strokeWidth={isOpen ? 2.5 : 2} />
                      </div>
                      <span className={`text-[12px] font-bold tracking-wide uppercase transition-colors duration-500 ${isOpen ? 'text-white drop-shadow-md' : 'text-white/60'}`}>{num}. {title}</span>
                  </div>
                  <div className={`transition-transform duration-500 ease-in-out flex items-center justify-center w-7 h-7 rounded-full ${isOpen ? 'bg-primary/10 text-primary rotate-180' : 'bg-transparent text-white/20'}`}>
                      <ChevronDown size={14} strokeWidth={3} />
                  </div>
              </div>
              <AnimatePresence>
                  {isOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1, marginTop: '8px' }} exit={{ height: 0, opacity: 0, marginTop: 0 }} className="overflow-hidden px-1">
                          <div className="py-2">
                              {children}
                          </div>
                      </motion.div>
                  )}
              </AnimatePresence>
          </div>
      );
  }, [openSection]);
  
  const [manualCapures] = useState<Capture[]>([]);
  const lightning = LIGHTNING_TYPES[lightningKey] || LIGHTNING_TYPES['NPI-I'];

  // --- MOTOR NBR 5419-3: Auto-dimensionamento Físico ---
  const prevLevelRef = useRef(building.level);
  
  useEffect(() => {
      let downDist = 15;
      let meshSize = 15;
      let newLightingKeyBase = 'NPIII';
      
      if (building.level === 'I') {
          downDist = 10; meshSize = 5; newLightingKeyBase = 'NPI';
      } else if (building.level === 'II') {
          downDist = 10; meshSize = 10; newLightingKeyBase = 'NPII';
      } else if (building.level === 'III') {
          downDist = 15; meshSize = 15; newLightingKeyBase = 'NPIII';
      } else if (building.level === 'IV') {
          downDist = 20; meshSize = 20; newLightingKeyBase = 'NPIII';
      }

      setLightningKey(prev => {
          if (!prev.startsWith(newLightingKeyBase + '-')) {
              const waveSuffix = prev.split('-')[1] || 'I';
              return `${newLightingKeyBase}-${waveSuffix}`;
          }
          return prev;
      });

      const perimeter = 2 * (building.width + building.depth);
      const reqDowns = Math.max(4, Math.ceil(perimeter / downDist));
      
      const reqCols = Math.max(1, Math.ceil(building.width / meshSize));
      const reqRows = Math.max(1, Math.ceil(building.depth / meshSize));

      const levelChanged = prevLevelRef.current !== building.level;
      prevLevelRef.current = building.level;

      setSpda(prev => {
          if (levelChanged) {
              return {
                  ...prev,
                  downs: reqDowns,
                  meshCols: reqCols,
                  meshRows: reqRows
              };
          }
          if (prev.downs >= reqDowns && prev.meshCols >= reqCols && prev.meshRows >= reqRows) return prev;
          return {
              ...prev,
              downs: reqDowns > prev.downs ? reqDowns : prev.downs,
              meshCols: reqCols > prev.meshCols ? reqCols : prev.meshCols,
              meshRows: reqRows > prev.meshRows ? reqRows : prev.meshRows
          }
      });
  }, [building.width, building.depth, building.level]);


  const [loop, setLoop] = useState<Loop>({ 
    x: 0, y: 3.5, z: 0, w: 4, h: 2.5, 
    distWall: 1.5,  // S1: Parallel distance
    distSide: 2.0,  // S2: Perpendicular distance
    rotY: 0,
    gaps: [{ id: 'g1', type: 'socket', size: 3, label: 'GAP 1', offset: 0.5, isDPS: false }],
    material: 'copper'
  });

  const [selectedDownId, setSelectedDownId] = useState<string | null>(null);
  const [movedDowns, setMovedDowns] = useState<Record<string, {c: number, r: number}>>({});
  
  useEffect(() => {
     setMovedDowns({});
     setSelectedDownId(null);
  }, [spda.meshCols, spda.meshRows, spda.downs]);

  const explicitDowns = useMemo(() => {
     const defaultNodes = getDownConductorNodes(spda.meshCols, spda.meshRows, spda.downs);
     return defaultNodes.map((n, i) => {
         const id = `dn-${i}`;
         if (movedDowns[id]) return { c: movedDowns[id].c, r: movedDowns[id].r, id };
         return { c: n.c, r: n.r, id };
     });
  }, [spda.meshCols, spda.meshRows, spda.downs, movedDowns]);

  const handleArrowMoveDown = useCallback((id: string | null, dir: number) => {
    if (!id) return;
    setMovedDowns(prev => {
        const d = prev[id] || explicitDowns.find(curr => curr.id === id);
        if (!d) return prev;
        const mc = Math.max(1, spda.meshCols), mr = Math.max(1, spda.meshRows);
        let nc = d.c, nr = d.r;
        if (dir === -1) { // Left-ish navigation
            if (nc > 0) nc--; else if (nr > 0) { nr--; nc = mc; }
        } else { // Right-ish navigation
            if (nc < mc) nc++; else if (nr < mr) { nr++; nc = 0; }
        }
        return { ...prev, [id]: { c: nc, r: nr } };
    });
  }, [explicitDowns, spda.meshCols, spda.meshRows]);

  const updateGap = useCallback((id: string, updates: any) => {
    setLoop(prev => ({
        ...prev,
        gaps: prev.gaps.map(g => g.id === id ? { ...g, ...updates } : g)
    }));
  }, []);

  const allCaptures = useMemo(() => {
    const caps: Capture[] = [...manualCapures];
    const r = Math.max(1, spda.meshRows), c = Math.max(1, spda.meshCols);
    if (spda.autoCapMode !== 'none') {
        for (let i = 0; i <= c; i++) {
            for (let j = 0; j <= r; j++) {
                const isC = (i === 0 || i === c) && (j === 0 || j === r);
                const isP = (i === 0 || i === c) || (j === 0 || j === r);
                const add = (spda.autoCapMode === 'all-vertices') || (spda.autoCapMode === 'corners' && isC) || (spda.autoCapMode === 'perimeter' && isP);
                if (add) caps.push({ 
                    id: `auto-${i}-${j}`, 
                    x: -building.width/2 + i * (building.width/c), 
                    z: -building.depth/2 + j * (building.depth/r), 
                    h: spda.showCaptors ? spda.autoCapHeight : 0, 
                    type: 'auto' 
                });
            }
        }
    }
    return caps;
  }, [building, spda, manualCapures]);

  const subdivision = useMemo(() => {
    if (!lightningHitId) return null;
    const parts = lightningHitId.split('-');
    if (parts[0] !== 'auto') return null;
    const c = parseInt(parts[1]), r = parseInt(parts[2]);
    
    return calculateMeshSubdivision(c, r, spda.meshCols, spda.meshRows, explicitDowns);
  }, [lightningHitId, spda.meshCols, spda.meshRows, explicitDowns]);

  const results = useMemo(() => {
    const n = Math.max(1, spda.downs);
    let kc = 1 / n;
    
    if (subdivision) {
        const frontEdges = subdivision.paths.filter(p => p.to[1] === spda.meshRows && p.from[1] === spda.meshRows);
        if (frontEdges.length > 0) {
            const loopX = -building.width/2 + loop.distWall + loop.w/2;
            let bestPath = frontEdges[0];
            let minDist = Infinity;
            frontEdges.forEach(p => {
                const px = -building.width/2 + (p.from[0] + p.to[0])/2 * (building.width / spda.meshCols);
                const d = Math.abs(px - loopX);
                if (d < minDist) { minDist = d; bestPath = p; }
            });
            kc = bestPath.kc * 0.5;
        } else {
             const hitParts = lightningHitId?.split('-');
             if (hitParts && hitParts[2] === spda.meshRows.toString()) {
                 kc = 0.5;
             }
        }
    }
    
    kc = Math.max(kc, 1/n);
    const i_branch = lightning.I * kc;

    const downs3D = (subdivision?.downCurrents || []).map(d => ({
        x: -building.width/2 + d.c * (building.width / spda.meshCols),
        z: -building.depth/2 + d.r * (building.depth / spda.meshRows),
        kc: d.kc
    }));

    const loop_x_min = -building.width/2 + loop.distSide;
    const loop_x_max = loop_x_min + loop.w;
    const loop_z = building.depth/2 - loop.distWall;

    const { uoc, M_tot } = calculateMaxwellSuperposition(
        lightning.di_dt, 
        Math.max(0.1, loop.h), 
        loop_x_min, loop_x_max, 
        loop_z, 
        downs3D,
        loop.rotY || 0
    );

    const gapsArr = loop.gaps as any[];
    const totalGap = gapsArr.filter(g => !g.isDPS).reduce((sum, g) => sum + g.size, 0);
    const u_safe = totalGap * 3000;
    const hasActiveDPS = gapsArr.some(g => g.isDPS);
    const isSparking = !hasActiveDPS && totalGap > 0 && uoc > u_safe;
    const isLoopClosed = hasActiveDPS || isSparking || totalGap === 0;
    
    const loop_current_A = calculateSparkCurrentSuperposed(M_tot, loop.w, Math.max(0.1, loop.h), lightning.I);

    return { uoc, isSparking, i_branch, kc, u_safe, totalGap, loop_current_A, isLoopClosed, hasActiveDPS };
  }, [lightning, spda, loop, subdivision, building.width, lightningHitId]);

  const isLocked = simulationActive || !!lightningHitId;

  return (
    <div className="app-container">

      <aside className="sidebar custom-scrollbar">

        <AccordionItem num={1} icon={Box} title="Edificação">
                <div className="flex flex-col gap-2">
                    <div className="input-group mb-1">
                        <label className="text-white/50 text-[9px] uppercase tracking-wider mb-1 block">Nível de Proteção (NP)</label>
                        <select value={building.level} onChange={e => setBuilding({...building, level: e.target.value as any})} className="w-full text-xs font-bold" disabled={isLocked}>
                            <option value="I">NP I (Malha 5m / Desc. 10m)</option>
                            <option value="II">NP II (Malha 10m / Desc. 10m)</option>
                            <option value="III">NP III (Malha 15m / Desc. 15m)</option>
                            <option value="IV">NP IV (Malha 20m / Desc. 20m)</option>
                        </select>
                    </div>
                    <CompactSlider label="Larg. X" value={building.width} min={5} max={100} step={1} unit="m" onChange={(v:any) => setBuilding({...building, width: v})} disabled={isLocked} />
                    <CompactSlider label="Comp. Z" value={building.depth} min={5} max={100} step={1} unit="m" onChange={(v:any) => setBuilding({...building, depth: v})} disabled={isLocked} />
                    <CompactSlider label="Altura Y" value={building.height} min={3} max={100} step={1} unit="m" onChange={(v:any) => setBuilding({...building, height: v})} disabled={isLocked} />
                    
                    <div className="mt-4 pt-4 border-t border-white/10 flex flex-col gap-3">
                         <div className="flex items-center justify-between bg-black/20 p-2.5 rounded-lg border border-white/5">
                             <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">Captores</span>
                             <div 
                                onClick={() => setSpda({...spda, showCaptors: !spda.showCaptors})} 
                                className={`cursor-pointer text-[9px] px-3 py-1.5 rounded-md font-black transition-all ${spda.showCaptors ? 'bg-success text-black shadow-[0_0_15px_rgba(34,197,94,0.3)]' : 'bg-danger text-white'} ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                             >
                                {spda.showCaptors ? 'ATIVOS' : 'INATIVOS'}
                             </div>
                         </div>
                         <div className={`transition-all duration-500 ${!spda.showCaptors ? 'opacity-30 pointer-events-none grayscale' : 'opacity-100'}`}>
                             <div className="input-group mb-2">
                                 <label className="text-white/50 text-[9px] uppercase tracking-wider mb-1 block">Distribuição</label>
                                 <select value={spda.autoCapMode} onChange={e => setSpda({...spda, autoCapMode: e.target.value as any})} className="w-full text-xs font-bold" disabled={!spda.showCaptors || isLocked}>
                                     <option value="none">Manual Livre</option>
                                     <option value="corners">Apenas Quinas</option>
                                     <option value="all-vertices">Total (Grid)</option>
                                 </select>
                             </div>
                             <CompactSlider label="Cotas" value={spda.autoCapHeight} min={0.5} max={10} step={0.5} unit="m" onChange={(v:any) => setSpda({...spda, autoCapHeight: v})} disabled={isLocked} />
                         </div>
                    </div>
                </div>
            </AccordionItem>

            <AccordionItem num={2} icon={Zap} title="Imp. NBR5419">
            <div className="control-card !mb-0 !p-3">
                <div className="flex flex-col gap-4">
                    {[ 
                        { title: 'Nível I', baseKey: 'NPI', levels: ['I'] },
                        { title: 'Nível II', baseKey: 'NPII', levels: ['II'] },
                        { title: 'Nível III/IV', baseKey: 'NPIII', levels: ['III', 'IV'] } 
                    ].filter(g => g.levels.includes(building.level)).map(g => (
                        <div key={g.title} className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-black uppercase text-white/40 tracking-widest">{g.title}</span>
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { id: 'I', label: 'Posit.', sub: '10/350μs' },
                                    { id: 'II', label: 'Negat.', sub: '1/200μs' },
                                    { id: 'III', label: 'Subs.', sub: '0.25/100μs' }
                                ].map(btn => {
                                    const isSel = lightningKey === `${g.baseKey}-${btn.id}`;
                                    return (
                                        <motion.div 
                                            key={btn.id}
                                            onClick={() => { setLightningKey(`${g.baseKey}-${btn.id}`); setLightningHitId(null); }}
                                            whileHover={{ scale: 1.02 }}
                                            whileTap={{ scale: 0.95 }}
                                            animate={isSel ? { 
                                                boxShadow: ["0 0 0px rgba(196,155,99,0)", "0 0 15px rgba(196,155,99,0.3)", "0 0 0px rgba(196,155,99,0)"],
                                                scale: 1.05
                                            } : {}}
                                            transition={isSel ? { repeat: Infinity, duration: 2 } : {}}
                                            className={`cursor-pointer flex items-center justify-center p-2 rounded-xl border transition-all duration-300 ${isSel ? 'bg-primary/20 border-primary text-white z-10' : 'bg-[#0a0a0a] text-white/40 border-white/5 hover:border-white/20'}`}
                                        >
                                            <span className={`text-[9px] font-black uppercase tracking-tight ${isSel ? 'text-primary' : ''}`}>{btn.label}</span>
                                        </motion.div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    
                    <div 
                        onClick={() => {
                            setSimulationActive(!simulationActive);
                            if (lightningHitId) setLightningHitId(null);
                        }}
                        className={`cursor-pointer text-[10px] mt-1 p-2.5 rounded-lg border text-center font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all duration-300 ${simulationActive ? 'bg-danger border-danger text-white shadow-[0_0_15px_rgba(239,68,68,0.3)]' : 'bg-primary/10 border-primary/20 text-primary hover:bg-primary/20 text-primary/80'}`}
                    >
                        <Zap size={14} className={simulationActive ? "animate-pulse" : ""}/> {simulationActive ? "PRONTO PARA DISPARO" : "INJETAR"}
                    </div>
                </div>
            </div>
        </AccordionItem>

        <section className="mt-8 border-t border-white/10 pt-6">
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-center bg-black/40 p-3 rounded border border-white/5">
                <span className="text-[9px] font-bold text-white/70 uppercase">Estado SPDA</span>
                <span className={`text-[11px] font-black uppercase tracking-widest ${results.isSparking ? 'text-danger' : 'text-success'}`}>{results.isSparking ? 'Crítico' : 'Seguro'}</span>
              </div>
              <div 
                onClick={() => {
                    setSimulationActive(!simulationActive);
                    if (lightningHitId) setLightningHitId(null);
                }}
                className={`cursor-pointer p-4 rounded-xl font-black text-[11px] uppercase shadow-lg flex flex-col items-center justify-center gap-2 transition-all duration-500 border ${simulationActive ? 'bg-danger border-danger text-white shadow-[0_0_30px_rgba(239,68,68,0.4)] scale-105' : 'bg-primary/20 border-primary/40 text-primary hover:bg-primary/30'}`}
              >
                  <div className="flex items-center gap-2">
                    {simulationActive ? <Zap size={18} className="animate-bounce"/> : <Radio size={18}/>}
                    <span>{simulationActive ? 'MODO INJEÇÃO: ATIVO' : 'ATIVAR MODO INJEÇÃO'}</span>
                  </div>
                  <span className="text-[8px] opacity-60 font-medium tracking-tighter">
                      {simulationActive ? 'CLIQUE NO PRÉDIO PARA DISPARAR' : 'CLIQUE PARA CARREGAR CAPTORES'}
                  </span>
              </div>
            </div>
        </section>
      </aside>

      <main className="main-view h-full w-full">

        <Scene building={building} spda={{ meshesCols: spda.meshCols, meshesRows: spda.meshRows, downs: spda.downs }} loop={{...loop, dist: 0.1} as any} isSparking={results.isSparking} captures={allCaptures} lightningHitId={lightningHitId} lightningValue={lightning.I} lightningModeActive={simulationActive} explicitDowns={explicitDowns} onMoveDown={(id,c,r) => setMovedDowns(prev => ({...prev, [id]: {c, r}}))} onArrowMoveDown={handleArrowMoveDown} selectedDownId={selectedDownId} onSelectDown={setSelectedDownId} onSetHitPoint={id => simulationActive && setLightningHitId(id)} onSetGapOffset={(id, off) => updateGap(id, {offset: off})} selectedGapId={selectedGapId} onSetSelectedGapId={(id) => { setSelectedGapId(id); if(id) setShowLoopEditor(true); }} subdivision={subdivision} onClickLoop={() => setShowLoopEditor(true)} />
        
        {showLoopEditor && (
            <motion.div drag dragMomentum={false} initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="loop-toolpalet">
                <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-2">
                    <div className="flex items-center gap-2">
                        <Layers size={14} className="text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Edição do Laço Pro</span>
                    </div>
                    <button onClick={() => setShowLoopEditor(false)} className="text-white/40 hover:text-white transition-all"><X size={16} /></button>
                </div>

                <div className="flex flex-col gap-2 mb-4">
                    <CompactSlider label="Largura L1" value={loop.w} min={0.1} max={building.width} step={0.1} unit="m" onChange={(v:any) => setLoop({...loop, w: v})} />
                    <CompactSlider label="Altura L2" value={loop.h} min={0.1} max={building.height} step={0.1} unit="m" onChange={(v:any) => setLoop({...loop, h: v})} />
                    <CompactSlider label="Elevação H" value={loop.y} min={0} max={building.height} step={0.1} unit="m" onChange={(v:any) => setLoop({...loop, y: v})} />
                    <CompactSlider label="S1 (Descida até Parede)" value={loop.distWall} min={0.1} max={building.width/2} step={0.1} unit="m" onChange={(v:any) => setLoop({...loop, distWall: v})} />
                    <CompactSlider label="S2 (Pilares Laterais)" value={loop.distSide} min={0.1} max={building.depth/2} step={0.1} unit="m" onChange={(v:any) => setLoop({...loop, distSide: v})} />
                    <CompactSlider label="Rotação Eixo Y" value={loop.rotY} min={-90} max={90} step={1} unit="°" onChange={(v:any) => setLoop({...loop, rotY: v})} />
                </div>

                <div className="pt-2 border-t border-white/10">
                    <div className="text-[9px] uppercase font-black text-primary mb-2">Pontos de Ruptura (Gaps)</div>
                    <div className="flex flex-col gap-2 max-h-[180px] overflow-y-auto pr-1 custom-scrollbar">
                        {loop.gaps.map(gap => (
                            <div key={gap.id} onClick={() => setSelectedGapId(gap.id)} className={`p-2 rounded-lg border transition-all cursor-pointer ${selectedGapId === gap.id ? 'bg-primary/10 border-primary shadow-[0_0_15px_rgba(196,155,99,0.2)]' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
                                <div className="flex justify-between items-center mb-2"><span className="text-[9px] font-black uppercase text-primary tracking-wider">{gap.label}</span><button onClick={(e) => { e.stopPropagation(); setLoop({...loop, gaps: loop.gaps.filter(g => g.id !== gap.id)}); }} className="text-danger hover:scale-125 transition-all"><Trash2 size={12} /></button></div>
                                <div className={`transition-opacity duration-300 ${gap.isDPS ? 'opacity-30 pointer-events-none grayscale' : 'opacity-100'}`}>
                                    <CompactSlider label="Abertura" value={gap.isDPS ? 0 : gap.size} min={0.1} max={5000} step={0.1} unit="mm" onChange={(v:any) => updateGap(gap.id, { size: v })} />
                                </div>
                                <CompactSlider label="Posição" value={gap.offset} min={0} max={1} step={0.001} onChange={(v:any) => updateGap(gap.id, { offset: v })} />
                                <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2">
                                    <label className="text-[9px] font-bold text-white/70 uppercase flex items-center gap-1 cursor-pointer hover:text-white transition-colors">
                                        <input type="checkbox" checked={gap.isDPS || false} onChange={e => updateGap(gap.id, { isDPS: e.target.checked })} className="accent-primary w-3 h-3 cursor-pointer" />
                                        Atuar como DPS (Chave fechada)
                                    </label>
                                </div>
                            </div>
                        ))}
                    </div>
                        <button onClick={() => { const id=`g-${Date.now()}`; setLoop({...loop, gaps: [...loop.gaps, { id, type:'socket', size:3, label:`GAP ${loop.gaps.length + 1}`, offset:0.5, isDPS: false}]}); setSelectedGapId(id); }} className="w-full py-2 mt-2 bg-primary/10 border border-primary/20 rounded text-primary text-[9px] font-black uppercase">ADICIONAR GAP</button>
                    </div>
                <div className="mt-4 pt-2 border-t border-white/10 text-[8px] text-center text-text-dim italic">Arraste esta janela para qualquer lugar</div>
            </motion.div>
        )}
        <div className="results-grid lg:grid-cols-4">
            <div className={`metric-card ${results.isLoopClosed ? 'border-l-4 border-l-danger bg-danger/5' : ''}`}><span className="metric-label">{results.isLoopClosed ? 'Corrente Induzida' : 'Tensão Induzida'}</span><span className={`metric-value ${results.isLoopClosed ? 'text-danger' : ''}`}>{results.isLoopClosed ? (results.loop_current_A/1000).toFixed(2) + ' kA' : (results.uoc / 1000).toFixed(2) + ' kV'}</span><span className="text-[8px] uppercase font-bold mt-1 text-text-dim">{results.isLoopClosed ? (results.hasActiveDPS ? 'Laço Fechado por DPS' : 'Laço em Centelhamento') : 'Cálculo NBR Anexo C'}</span></div>
            <div className="metric-card"><span className="metric-label">kc Efetivo</span><span className="metric-value text-primary">{results.kc.toFixed(3)}</span><span className="text-[8px] uppercase font-bold mt-1 text-text-dim">Fator de Subdivisão Real</span></div>
            <div className={`metric-card border-l-4 ${results.isSparking ? 'border-l-danger' : (results.hasActiveDPS ? 'border-l-primary' : 'border-l-success')}`}><span className="metric-label">Status Dielétrico</span><span className={`metric-value ${results.isSparking ? 'text-danger' : (results.hasActiveDPS ? 'text-primary' : 'text-success')}`}>{results.isSparking ? 'Falha (Arco)' : (results.hasActiveDPS ? 'DPS Atuou' : 'Seguro')}</span><span className="text-[8px] uppercase font-bold mt-1 text-text-dim">Rigidez vs Indução</span></div>
            <div className="metric-card accent"><span className="metric-label">Gaps (Soma Livre)</span><span className="metric-value">{results.totalGap.toFixed(1)} mm</span><span className="text-[8px] uppercase font-bold mt-1 text-text-dim">U_isolação global: {(results.u_safe / 1000).toFixed(1)} kV</span></div>
        </div>
      </main>
    </div>
  );
}

export default App;
