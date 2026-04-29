import { useEffect, useRef, useState } from 'react';
import { SimulationEngine } from '../simulation/Engine';
import { Scene3D } from './Scene3D';
import {
  Activity, GitBranch, Image as ImageIcon, Layers,
  Play, Pause, RefreshCw, Radio, Wifi, Zap,
} from 'lucide-react';
import '../index.css';

/* ─── Strategy Config ──────────────────────────────────────────── */
const STRATEGIES = {
  aerosnap: {
    label: 'AeroSnap',
    sub:   'Our Protocol',
    desc:  'Adaptive snapshots + smart routing',
    accent: '#8B5CF6',
    glow:   'rgba(139,92,246,0.35)',
  },
  epidemic: {
    label: 'Epidemic',
    sub:   'Pure Flooding',
    desc:  'Send to every drone encountered',
    accent: '#3B82F6',
    glow:   'rgba(59,130,246,0.35)',
  },
  spray_wait: {
    label: 'Spray-Wait',
    sub:   'L=8 Fixed',
    desc:  'Limited copies, then wait',
    accent: '#10B981',
    glow:   'rgba(16,185,129,0.35)',
  },
  emrt: {
    label: 'EMRT',
    sub:   'Dynamic L',
    desc:  'Adapts copy count per situation',
    accent: '#F97316',
    glow:   'rgba(249,115,22,0.35)',
  },
  prophet: {
    label: 'PRoPHET',
    sub:   'Predictive',
    desc:  'Routes via encounter history',
    accent: '#F59E0B',
    glow:   'rgba(245,158,11,0.35)',
  },
  gossip: {
    label: 'Gossip',
    sub:   '70% Chance',
    desc:  'Random 70% forwarding',
    accent: '#EF4444',
    glow:   'rgba(239,68,68,0.35)',
  },
  direct: {
    label: 'Direct',
    sub:   'Carry-Only',
    desc:  'Only deliver to base directly',
    accent: '#6B7280',
    glow:   'rgba(107,114,128,0.35)',
  },
};

/* ─── Animated Number ──────────────────────────────────────────── */
function AnimNum({ value, suffix = '' }) {
  const [disp, setDisp] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    if (value === prev.current) return;
    const delta = value - prev.current;
    const steps = 12;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisp(+(prev.current + (delta * i) / steps).toFixed(1));
      if (i >= steps) { setDisp(value); prev.current = value; clearInterval(id); }
    }, 16);
    return () => clearInterval(id);
  }, [value]);
  return <>{disp}{suffix}</>;
}

/* ─── Mini Sparkline Chart ─────────────────────────────────────── */
function Sparkline({ data, color = '#10B981', height = 36 }) {
  if (data.length < 2) {
    return (
      <svg width="100%" height={height} style={{ display: 'block' }}>
        <line x1="0" y1={height / 2} x2="100%" y2={height / 2} stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="4,4" />
      </svg>
    );
  }
  const w = 240;
  const pad = 2;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = height - pad - (v / max) * (height - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  const area = `M ${data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = height - pad - (v / max) * (height - pad * 2);
    return `${x} ${y}`;
  }).join(' L ')} L ${w - pad} ${height - pad} L ${pad} ${height - pad} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`sg-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${color.replace('#','')})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {/* Latest value dot */}
      {(() => {
        const last = data[data.length - 1];
        const x = w - pad;
        const y = height - pad - (last / max) * (height - pad * 2);
        return <circle cx={x} cy={y} r="3" fill={color} />;
      })()}
    </svg>
  );
}

/* ─── Progress Bar ─────────────────────────────────────────────── */
function ProgBar({ value, max = 100, color }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="prog-track">
      <div className="prog-fill" style={{
        width: `${pct}%`,
        background: `linear-gradient(90deg, ${color}88, ${color})`,
        boxShadow: `0 0 8px ${color}66`,
      }} />
    </div>
  );
}

/* ─── Algorithm Comparison Bars ────────────────────────────────── */
function AlgoComparison({ current, data }) {
  const metrics = [
    { key: 'ddr',      label: 'Data Delivered',  suffix: '%',  max: 100 },
    { key: 'overhead', label: 'Network Load',     suffix: 'x',  max: 20, lower_is_better: true },
  ];
  return (
    <div className="algo-compare">
      {metrics.map(m => (
        <div key={m.key} className="compare-row">
          <div className="compare-label">{m.label}</div>
          <div className="compare-bars">
            {Object.entries(data).map(([key, val]) => {
              const s = STRATEGIES[key];
              const v = parseFloat(val[m.key]) || 0;
              const pct = Math.min(100, (v / m.max) * 100);
              return (
                <div key={key} className={`cbar-wrap ${key === current ? 'cbar-active' : ''}`}>
                  <div className="cbar-track">
                    <div className="cbar-fill" style={{
                      width: `${pct}%`,
                      background: s.accent,
                      opacity: key === current ? 1 : 0.45,
                    }} />
                  </div>
                  <span className="cbar-val" style={{ color: key === current ? s.accent : 'var(--text-3)' }}>
                    {v.toFixed(1)}{m.suffix}
                  </span>
                  <span className="cbar-key" style={{ color: key === current ? s.accent : 'var(--text-3)' }}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Dashboard UI ─────────────────────────────────────────────── */
export function DashboardUI() {
  const [engine, setEngine]   = useState(() => new SimulationEngine(14, 'aerosnap', 0.003));
  const [gs, setGs]           = useState(() => engine.getState());
  const [paused, setPaused]   = useState(false);
  const [strategy, setStrategy] = useState('aerosnap');
  const [history, setHistory] = useState([]);
  const [algoSnap, setAlgoSnap] = useState({});
  const lastSnapTick = useRef(0);

  /* subscribe to engine */
  useEffect(() => {
    setGs(engine.getState());
    setHistory([]);
    const unsub = engine.subscribe(() => setGs(engine.getState()));
    return unsub;
  }, [engine]);

  /* tick loop */
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => engine.step(), 80);
    return () => clearInterval(id);
  }, [engine, paused]);

  /* collect delivery rate history every 15 ticks */
  useEffect(() => {
    const t = gs.metrics.time ?? 0;
    if (t - lastSnapTick.current >= 15) {
      lastSnapTick.current = t;
      const val = parseFloat(gs.metrics.survivability) || 0;
      setHistory(h => [...h.slice(-60), val]);
    }
  }, [gs.metrics.time]);

  /* collect per-algo snapshot for comparison */
  useEffect(() => {
    const t = gs.metrics.time ?? 0;
    if (t > 0 && t % 50 === 0) {
      setAlgoSnap(prev => ({
        ...prev,
        [strategy]: {
          ddr:      parseFloat(gs.metrics.survivability) || 0,
          overhead: parseFloat(gs.metrics.overhead) || 0,
        },
      }));
    }
  }, [gs.metrics.time, strategy]);

  const switchStrategy = (key) => {
    setStrategy(key);
    const e = new SimulationEngine(14, key, 0.003);
    setEngine(e);
    setGs(e.getState());
    setPaused(false);
    setHistory([]);
  };

  const m   = gs.metrics;
  const cfg = STRATEGIES[strategy];

  const survivabilityPct = parseFloat(m.survivability) || 0;
  const aliveDrones = gs.drones.filter(d => d.alive);
  const batteryAvg = aliveDrones.length > 0
    ? +(aliveDrones.reduce((s, d) => s + d.battery, 0) / aliveDrones.length).toFixed(1)
    : 0;
  const totalData   = m.totalPackets || 1;
  const inTransit   = Math.max(0, totalData - (m.delivered || 0));

  return (
    <div className="dashboard-root">
      <div className="scanlines" />

      {/* 3-D scene */}
      <div className="canvas-layer">
        <Scene3D
          gameState={{
            drones:           gs.drones,
            activeEncounters: gs.activeEncounters || [],
            snapshotRipples:  gs.snapshotRipples || [],
            partitions:       gs.partitions || [],
          }}
          accentColor={cfg.accent}
        />
      </div>

      {/* HUD overlay */}
      <div className="hud-layer">

        {/* ══ TOP BAR ═══════════════════════════════════════════════ */}
        <div className="glass topbar">
          <div className="brand">
            <div className="brand-icon">
              <Radio size={18} />
            </div>
            <div className="brand-text">
              <h1>AEROSNAP</h1>
              <p>Disaster Relief Drone Swarm · Data Recovery Simulation</p>
            </div>
          </div>

          <div className="strategy-switcher">
            {Object.entries(STRATEGIES).map(([key, s]) => (
              <button
                key={key}
                className={`strat-btn ${strategy === key ? 'active' : ''}`}
                style={strategy === key ? {
                  color: s.accent,
                  borderColor: s.accent + '60',
                  background: s.accent + '18',
                  boxShadow: `0 0 18px ${s.glow}`,
                } : {}}
                onClick={() => switchStrategy(key)}
                title={s.desc}
              >
                {s.label}
                <span className="strat-sub">{s.sub}</span>
              </button>
            ))}
          </div>

          <div className="controls-group">
            <div className="status-pill">
              <span className="status-dot" />
              T+{m.time ?? 0} ticks
            </div>
            <div className="topbar-sep" />
            <button className="ctrl-btn" onClick={() => setPaused(!paused)}>
              {paused ? <Play size={14} /> : <Pause size={14} />}
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button className="ctrl-btn danger" onClick={() => switchStrategy(strategy)}>
              <RefreshCw size={14} /> Reset
            </button>
          </div>
        </div>

        {/* ══ LEFT PANEL — Telemetry ═════════════════════════════════ */}
        <div className="glass panel-left">
          <p className="panel-title">Mission Telemetry</p>
          <p className="panel-subtitle" style={{ color: cfg.accent }}>
            {cfg.label} — {cfg.desc}
          </p>

          {/* Data Recovery Rate */}
          <div className="metric-card">
            <div className="metric-head">
              <div>
                <div className="metric-label">Data Recovery Rate</div>
                <div className="metric-explain">% of disaster images safely delivered to base</div>
              </div>
              <span className="metric-icon-wrap icon-green"><ImageIcon size={13} /></span>
            </div>
            <div className="metric-value grad-green">
              <AnimNum value={survivabilityPct} suffix="%" />
            </div>
            <ProgBar value={survivabilityPct} color="#10B981" />
            <div className="metric-footer">
              <span>{m.delivered || 0} delivered</span>
              <span>{inTransit} in-flight</span>
              <span style={{ color: '#94A3B8' }}>{totalData} total</span>
            </div>
            <div className="chart-wrap">
              <div className="chart-label">Recovery over time</div>
              <Sparkline data={history} color="#10B981" height={38} />
            </div>
          </div>

          {/* Swarm Status */}
          <div className="metric-card">
            <div className="metric-head">
              <div>
                <div className="metric-label">Swarm Status</div>
                <div className="metric-explain">How many drones are still operational</div>
              </div>
              <span className="metric-icon-wrap icon-rose"><Zap size={13} /></span>
            </div>
            <div className="metric-value" style={{ color: m.aliveNodes > 7 ? '#10B981' : m.aliveNodes > 4 ? '#F59E0B' : '#F43F5E' }}>
              <AnimNum value={m.aliveNodes} />
              <span className="metric-unit"> / {m.totalNodes} drones</span>
            </div>
            <ProgBar value={m.aliveNodes} max={m.totalNodes} color={m.aliveNodes > 7 ? '#10B981' : m.aliveNodes > 4 ? '#F59E0B' : '#F43F5E'} />
            <div className="metric-footer">
              <span style={{ color: '#F43F5E' }}>{(m.totalNodes - m.aliveNodes)} lost to disaster</span>
              <span style={{ color: '#10B981' }}>{m.aliveNodes} active</span>
            </div>
          </div>

          {/* Battery */}
          <div className="metric-card">
            <div className="metric-head">
              <div>
                <div className="metric-label">Average Battery</div>
                <div className="metric-explain">Remaining power across all active drones</div>
              </div>
              <span className="metric-icon-wrap icon-amber"><Activity size={13} /></span>
            </div>
            <div className="metric-value grad-cyan">
              <AnimNum value={batteryAvg} suffix="%" />
            </div>
            <ProgBar value={batteryAvg} color={batteryAvg > 50 ? '#10B981' : batteryAvg > 25 ? '#F59E0B' : '#F43F5E'} />
            <div className="metric-footer">
              <span>{m.aliveNodes} active drones</span>
            </div>
          </div>

          {/* Network Load */}
          <div className="metric-card">
            <div className="metric-head">
              <div>
                <div className="metric-label">Network Load</div>
                <div className="metric-explain">Transmissions needed per image delivered (lower = better)</div>
              </div>
              <span className="metric-icon-wrap icon-cyan"><Radio size={13} /></span>
            </div>
            <div className="metric-value" style={{ color: '#67E8F9' }}>
              <AnimNum value={parseFloat(m.overhead) || 0} />
              <span className="metric-unit"> tx/img</span>
            </div>
            <div className="metric-footer">
              <span>Total transmissions: {m.transmissions}</span>
            </div>
          </div>

          {/* AeroSnap-exclusive */}
          {strategy === 'aerosnap' && (
            <>
              <div className="metric-card purple-accent">
                <div className="metric-head">
                  <div>
                    <div className="metric-label">Snapshot Convergence</div>
                    <div className="metric-explain">How much of the swarm has shared state awareness</div>
                  </div>
                  <span className="metric-icon-wrap icon-purple"><Layers size={13} /></span>
                </div>
                <div className="metric-value grad-purple">
                  <AnimNum value={m.convergence || 0} suffix="%" />
                </div>
                <ProgBar value={m.convergence || 0} color="#8B5CF6" />
              </div>

              <div className="metric-card purple-accent">
                <div className="metric-head">
                  <div>
                    <div className="metric-label">Network Partitions</div>
                    <div className="metric-explain">Isolated drone groups that can't reach each other</div>
                  </div>
                  <span className="metric-icon-wrap icon-purple"><GitBranch size={13} /></span>
                </div>
                <div className="metric-value grad-purple" style={{ fontSize: '1.6rem' }}>
                  <AnimNum value={m.partitionCount || 0} />
                  <span className="metric-unit"> clusters</span>
                </div>
                <div className="metric-footer">
                  <span>Markers sent: {m.markersSent || 0}</span>
                  <span>Snapshots: {m.snapshotCount || 0}</span>
                </div>
              </div>
            </>
          )}

          {/* EMRT-exclusive */}
          {strategy === 'emrt' && (
            <div className="metric-card" style={{ borderColor: '#F9731660' }}>
              <div className="metric-head">
                <div>
                  <div className="metric-label">Dynamic Copy Count (L)</div>
                  <div className="metric-explain">EMRT adapts how many copies to send based on conditions</div>
                </div>
                <span className="metric-icon-wrap" style={{ background: '#F9731620' }}>
                  <Layers size={13} style={{ color: '#F97316' }} />
                </span>
              </div>
              <div className="metric-value" style={{ color: '#F97316' }}>
                {m.emrtAvgL != null ? m.emrtAvgL : '—'}
                <span className="metric-unit"> avg L</span>
              </div>
              <ProgBar value={m.emrtAvgL != null ? parseFloat(m.emrtAvgL) : 0} max={10} color="#F97316" />
              <div className="metric-footer">
                <span>Fixed baseline: L=8</span>
                <span>{m.emrtSamples || 0} decisions</span>
              </div>
            </div>
          )}
        </div>

        {/* ══ RIGHT PANEL ════════════════════════════════════════════ */}
        <div className="glass panel-right">
          {/* Legend */}
          <div className="legend-section">
            <p className="panel-title">What You're Seeing</p>
            <div className="legend-grid">
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#3B82F6' }} />
                <span>Drone (carrying data)</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#F59E0B' }} />
                <span>Data beam (sharing)</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: cfg.accent }} />
                <span>Mission base (delivery point)</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#EF4444' }} />
                <span>Disaster zones (red circles)</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#6B7280' }} />
                <span>Offline / crashed drone</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#8B5CF6' }} />
                <span>AeroSnap snapshot pulse</span>
              </div>
            </div>
          </div>

          <div className="panel-divider" />

          {/* Activity Logs */}
          <p className="panel-title" style={{ marginTop: 4 }}>Live Activity Log</p>
          <div className="logs-scroll">
            {gs.logs.map(log => (
              <div key={log.id} className={`log-row ${log.type}`}>
                <span className="log-ts">T+{String(log.time).padStart(4, '0')}</span>
                <span className="log-msg">{log.msg}</span>
              </div>
            ))}
          </div>

          {/* Algorithm Comparison */}
          {Object.keys(algoSnap).length > 1 && (
            <>
              <div className="panel-divider" />
              <p className="panel-title">Algorithm Comparison</p>
              <p className="panel-explain">Live scores collected so far this session</p>
              <AlgoComparison current={strategy} data={algoSnap} />
            </>
          )}
        </div>

        {/* ══ BOTTOM — Recovered Intel Feed ══════════════════════════ */}
        <div className="glass panel-feed">
          <div className="feed-label-wrap">
            <span className="feed-label">Recovered</span>
            <span className="feed-label">Intel</span>
          </div>

          {gs.recoveredImages.length === 0 ? (
            <span className="feed-empty">Waiting for drones to return disaster images to base…</span>
          ) : (
            gs.recoveredImages.slice().reverse().slice(0, 18).map((img, i) => {
              const seed = parseInt(img.id.replace(/\D/g, '') || '0');
              const h1   = (seed * 37) % 360;
              const h2   = (seed * 73 + 120) % 360;
              return (
                <div key={i} className="intel-card">
                  <div className="intel-thumb">
                    <div
                      className="intel-thumb-inner"
                      style={{ background: `linear-gradient(135deg, hsl(${h1},50%,28%), hsl(${h2},60%,16%))` }}
                    />
                    <Wifi size={16} style={{ color: '#fff', opacity: 0.55, position: 'relative', zIndex: 1 }} />
                  </div>
                  <div className="intel-info">
                    <div className="intel-id">{img.id}</div>
                    <div className="intel-pri">Priority {img.priority}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

      </div>
    </div>
  );
}
