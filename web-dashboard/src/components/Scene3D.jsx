import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sphere, Cylinder, Box } from '@react-three/drei';
import { Quadcopter } from './Quadcopter';
import * as THREE from 'three';

/* ─── Animated Data Beam ───────────────────────────────────────── */
function DataBeam({ start, end, color = '#FCD34D' }) {
  const ref = useRef();
  const phase = useRef(Math.random() * Math.PI * 2);
  const mid = useMemo(() => ({
    x: (start.x + end.x) / 2,
    y: Math.max(start.y, end.y) + 6,
    z: (start.z + end.z) / 2,
  }), [start, end]);
  const curve = useMemo(() =>
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(start.x, start.y, start.z),
      new THREE.Vector3(mid.x, mid.y, mid.z),
      new THREE.Vector3(end.x, end.y, end.z)
    ), [start, end, mid]);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.material.opacity = 0.5 + Math.sin(clock.elapsedTime * 4 + phase.current) * 0.25;
    }
  });

  return (
    <mesh ref={ref}>
      <tubeGeometry args={[curve, 30, 0.22, 6, false]} />
      <meshBasicMaterial color={color} transparent opacity={0.7} depthWrite={false} />
    </mesh>
  );
}

/* ─── Snapshot Ripple ──────────────────────────────────────────── */
function SnapshotRipple({ position, type }) {
  const ref   = useRef();
  const ring1 = useRef();
  const birth = useRef(null);
  const duration = type === 'initiate' ? 2.5 : 1.6;
  const color    = type === 'initiate' ? '#A78BFA' : '#FCD34D';

  useFrame(({ clock }) => {
    if (birth.current === null) birth.current = clock.elapsedTime;
    const t = Math.min((clock.elapsedTime - birth.current) / duration, 1);
    if (t >= 1) { if (ref.current) ref.current.visible = false; return; }
    const r  = t * (type === 'initiate' ? 16 : 10);
    const op = (1 - t * t) * 0.55;
    if (ref.current?.material) { ref.current.scale.set(r, r, r); ref.current.material.opacity = op; }
    if (ring1.current)          { ring1.current.scale.set(r * 0.6, r * 0.6, 1); ring1.current.material.opacity = op * 0.8; }
  });

  return (
    <group position={position}>
      <mesh ref={ref}>
        <sphereGeometry args={[1, 20, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.45} side={THREE.BackSide} depthWrite={false} />
      </mesh>
      <mesh ref={ring1} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 1.0, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ─── Partition Halo ───────────────────────────────────────────── */
function PartitionHalo({ positions, color }) {
  const ref = useRef();
  useFrame(({ clock }) => {
    if (ref.current) ref.current.material.opacity = 0.12 + Math.sin(clock.elapsedTime * 1.5) * 0.06;
  });
  if (positions.length < 2) return null;
  const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
  const cz = positions.reduce((s, p) => s + p.z, 0) / positions.length;
  const r  = Math.max(6, ...positions.map(p => Math.hypot(p.x - cx, p.z - cz)));
  return (
    <mesh ref={ref} position={[cx, 0.1, cz]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[r + 1, r + 3, 72]} />
      <meshBasicMaterial color={color} transparent opacity={0.15} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

/* ─── Ground Cracks / Rubble Grid ─────────────────────────────── */
function RubbleGround() {
  const ref = useRef();
  useFrame(({ clock }) => {
    if (ref.current) ref.current.material.opacity = 0.18 + Math.sin(clock.elapsedTime * 0.4) * 0.04;
  });
  return (
    <group>
      {/* Dirt/rubble base */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[300, 300]} />
        <meshStandardMaterial color="#3D2B1A" roughness={1} metalness={0} />
      </mesh>
      {/* Crack pattern overlay */}
      <gridHelper ref={ref} args={[220, 55, '#5C3D1E', '#4A2E12']} position={[0, 0.02, 0]} />
      {/* Rubble scatter — flat squares */}
      {Array.from({ length: 60 }, (_, i) => {
        const x = (Math.sin(i * 137.5) * 90);
        const z = (Math.cos(i * 137.5) * 90);
        const s = 1.5 + (i % 4) * 1.2;
        if (Math.hypot(x, z) < 18) return null;
        return (
          <mesh key={i} position={[x, 0.05, z]} rotation={[-Math.PI / 2, 0, i * 0.8]}>
            <planeGeometry args={[s, s]} />
            <meshStandardMaterial color={i % 3 === 0 ? '#5C3D1E' : '#6B4C2A'} roughness={1} />
          </mesh>
        );
      })}
    </group>
  );
}

/* ─── Fire / Ember Particles ───────────────────────────────────── */
function EmberParticles() {
  const ref   = useRef();
  const count = 220;
  const base  = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3]     = (Math.random() - 0.5) * 160;
      arr[i * 3 + 1] = Math.random() * 35 + 1;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 160;
    }
    return arr;
  }, []);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const pos = ref.current.geometry.attributes.position.array;
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 1] = base[i * 3 + 1] + Math.sin(clock.elapsedTime * 0.5 + i * 0.3) * 4;
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[base, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.5} color="#FCA044" transparent opacity={0.55} sizeAttenuation depthWrite={false} />
    </points>
  );
}

/* ─── Smoke Columns ────────────────────────────────────────────── */
function SmokeColumn({ position }) {
  const ref   = useRef();
  const count = 40;
  const base  = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3]     = position[0] + (Math.random() - 0.5) * 8;
      arr[i * 3 + 1] = position[1] + Math.random() * 30;
      arr[i * 3 + 2] = position[2] + (Math.random() - 0.5) * 8;
    }
    return arr;
  }, []);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const pos = ref.current.geometry.attributes.position.array;
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 1] = base[i * 3 + 1] + ((clock.elapsedTime * 3 + i * 2) % 30);
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[base, 3]} />
      </bufferGeometry>
      <pointsMaterial size={3.5} color="#6B4226" transparent opacity={0.28} sizeAttenuation depthWrite={false} />
    </points>
  );
}

/* ─── Fire Flicker ─────────────────────────────────────────────── */
function FireLight({ position }) {
  const ref  = useRef();
  const seed = useRef(Math.random() * 10);
  useFrame(({ clock }) => {
    if (ref.current) {
      const t = clock.elapsedTime + seed.current;
      ref.current.intensity = 80 + Math.sin(t * 7) * 35 + Math.sin(t * 3.2) * 20;
    }
  });
  return <pointLight ref={ref} position={position} color="#FF6B1A" intensity={90} distance={40} decay={2} />;
}

/* ─── Damaged Buildings ────────────────────────────────────────── */
function DamagedCity() {
  const buildings = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 80; i++) {
      const x = (Math.sin(i * 73.1 + 1) * 90) + (Math.sin(i * 19.3) * 20);
      const z = (Math.cos(i * 73.1 + 1) * 90) + (Math.cos(i * 19.3) * 20);
      if (Math.hypot(x, z) < 22) continue;
      const h       = 3 + (i % 7) * 2.5;
      const w       = 2.5 + (i % 5) * 1.2;
      const d       = 2.5 + (i % 4) * 1.4;
      const tilted  = i % 4 === 0;
      const cracked = i % 3 === 0;
      arr.push({
        pos: [x, h / 2, z],
        args: [w, h, d],
        rot: [
          tilted ? (i % 2 === 0 ? 0.18 : -0.12) : 0,
          (i * 0.4) % (Math.PI * 2),
          tilted ? (i % 2 === 0 ? 0.1 : -0.15) : 0,
        ],
        color: cracked ? '#5C5044' : '#7A6A5A',
        emissive: i % 7 === 0,
      });
    }
    return arr;
  }, []);

  return (
    <group>
      {buildings.map((b, i) => (
        <Box key={i} args={b.args} position={b.pos} rotation={b.rot} castShadow receiveShadow>
          <meshStandardMaterial
            color={b.color}
            roughness={0.95}
            emissive={b.emissive ? '#FF4500' : '#000'}
            emissiveIntensity={b.emissive ? 0.25 : 0}
          />
        </Box>
      ))}
    </group>
  );
}

/* ─── Base Station ─────────────────────────────────────────────── */
function BaseStation({ accentColor = '#10B981' }) {
  const beaconRef = useRef();
  const ringRef   = useRef();

  useFrame(({ clock }) => {
    if (beaconRef.current) {
      beaconRef.current.intensity = 500 + Math.sin(clock.elapsedTime * 2) * 150;
    }
    if (ringRef.current) {
      ringRef.current.rotation.y += 0.01;
      ringRef.current.material.opacity = 0.45 + Math.sin(clock.elapsedTime * 2) * 0.2;
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* Landing pad */}
      <Cylinder args={[11, 13, 2, 48]} position={[0, 1, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#4A3728" roughness={0.6} metalness={0.5} />
      </Cylinder>
      {/* Bright runway ring */}
      <Cylinder args={[10.5, 10.5, 0.2, 48]} position={[0, 2.1, 0]}>
        <meshBasicMaterial color={accentColor} toneMapped={false} />
      </Cylinder>
      {/* Cross markings */}
      <mesh position={[0, 2.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.2, 20]} />
        <meshBasicMaterial color={accentColor} toneMapped={false} />
      </mesh>
      <mesh position={[0, 2.2, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
        <planeGeometry args={[1.2, 20]} />
        <meshBasicMaterial color={accentColor} toneMapped={false} />
      </mesh>
      {/* Tower */}
      <Cylinder args={[1.5, 2.5, 28, 12]} position={[0, 14, 0]} castShadow>
        <meshStandardMaterial color="#5A4A3A" metalness={0.7} roughness={0.3} />
      </Cylinder>
      {/* Beacon */}
      <pointLight ref={beaconRef} position={[0, 30, 0]} color={accentColor} distance={100} decay={2} castShadow />
      <Sphere args={[2, 20, 20]} position={[0, 30, 0]}>
        <meshBasicMaterial color={accentColor} toneMapped={false} />
      </Sphere>
      {/* Rotating ring */}
      <mesh ref={ringRef} position={[0, 20, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[8, 10, 64]} />
        <meshBasicMaterial color={accentColor} transparent opacity={0.45} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ─── Disaster Zone Markers ────────────────────────────────────── */
function DisasterZones() {
  const zones = useMemo(() => [
    { pos: [-38, 0, 32], r: 19, color: '#EF4444', label: 'Zone A' },
    { pos: [42, 0, -28], r: 23, color: '#F97316', label: 'Zone B' },
    { pos: [-22, 0, -42], r: 15, color: '#EF4444', label: 'Zone C' },
    { pos: [32, 0, 36],  r: 21, color: '#F97316', label: 'Zone D' },
    { pos: [-48, 0, -12], r: 11, color: '#DC2626', label: 'Zone E' },
  ], []);

  return (
    <group>
      {zones.map((z, i) => (
        <group key={i}>
          {/* Filled hazard circle */}
          <mesh position={[z.pos[0], 0.02, z.pos[2]]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[z.r, 48]} />
            <meshBasicMaterial color={z.color} transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          {/* Bold outer ring */}
          <mesh position={[z.pos[0], 0.04, z.pos[2]]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[z.r - 0.8, z.r, 64]} />
            <meshBasicMaterial color={z.color} transparent opacity={0.55} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          {/* Inner ring */}
          <mesh position={[z.pos[0], 0.05, z.pos[2]]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[z.r * 0.45, z.r * 0.55, 32]} />
            <meshBasicMaterial color={z.color} transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ─── Main Scene ───────────────────────────────────────────────── */
const PARTITION_COLORS = ['#A78BFA','#FCD34D','#F59E0B','#EF4444','#34D399','#EC4899','#6366F1','#14B8A6'];

export function Scene3D({ gameState, accentColor = '#10B981' }) {
  const { drones = [], activeEncounters = [], snapshotRipples = [], partitions = [] } = gameState || {};

  return (
    <Canvas
      shadows
      camera={{ position: [70, 55, 70], fov: 42 }}
      gl={{ antialias: true, alpha: false }}
    >
      {/* ── Atmosphere — dusty disaster sky ─────────────────────── */}
      <fog attach="fog" args={['#4A2E10', 90, 240]} />
      <color attach="background" args={['#2C1A08']} />

      {/* Ambient — warm hazy daylight */}
      <ambientLight intensity={0.75} color="#FFA855" />

      {/* Sun — harsh afternoon light casting hard shadows */}
      <directionalLight
        position={[60, 90, 40]}
        intensity={2.2}
        color="#FFD580"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={1}
        shadow-camera-far={300}
        shadow-camera-left={-120}
        shadow-camera-right={120}
        shadow-camera-top={120}
        shadow-camera-bottom={-120}
      />

      {/* Back-fill — ambient bounce from ground */}
      <directionalLight position={[-40, 10, -60]} intensity={0.5} color="#E8963A" />

      {/* Fire lights */}
      <FireLight position={[-40, 4, 30]} />
      <FireLight position={[42, 4, -28]} />
      <FireLight position={[-22, 4, -42]} />
      <FireLight position={[32, 4, 36]} />
      <FireLight position={[-50, 4, -12]} />

      <EmberParticles />

      {/* Smoke columns above fire zones */}
      <SmokeColumn position={[-40, 0, 30]} />
      <SmokeColumn position={[42, 0, -28]} />
      <SmokeColumn position={[-22, 0, -42]} />
      <SmokeColumn position={[32, 0, 36]} />

      <RubbleGround />
      <DisasterZones />
      <DamagedCity />
      <BaseStation accentColor={accentColor} />

      {/* ── Partition Halos ─────────────────────────────────────── */}
      {partitions.map((partition, idx) => {
        if (partition.length < 2) return null;
        const pos = partition.map(id => {
          const d = drones.find(dd => dd.id === id);
          return d ? { x: d.x, z: d.z } : null;
        }).filter(Boolean);
        return (
          <PartitionHalo
            key={`ph-${idx}`}
            positions={pos}
            color={PARTITION_COLORS[idx % PARTITION_COLORS.length]}
          />
        );
      })}

      {/* ── Drones ──────────────────────────────────────────────── */}
      {drones.map(drone => (
        <Quadcopter
          key={drone.id}
          drone={drone}
          isActive={activeEncounters.some(p => p.includes(drone.id))}
          hasSnapshot={drone.snapshot !== null}
          accentColor={accentColor}
        />
      ))}

      {/* ── Data Beams ──────────────────────────────────────────── */}
      {activeEncounters.map((pair, i) => {
        const a = drones.find(d => d.id === pair[0]);
        const b = drones.find(d => d.id === pair[1]);
        if (a && b) return <DataBeam key={`beam-${i}`} start={a} end={b} color={accentColor} />;
        return null;
      })}

      {/* ── Snapshot Ripples ────────────────────────────────────── */}
      {snapshotRipples.map(r => (
        <SnapshotRipple key={r.id} position={[r.x, r.y ?? 8, r.z]} type={r.type} />
      ))}

      <OrbitControls
        makeDefault
        minPolarAngle={0.1}
        maxPolarAngle={Math.PI / 2 - 0.05}
        maxDistance={140}
        minDistance={12}
        enablePan={false}
        enableDamping
        dampingFactor={0.06}
      />
    </Canvas>
  );
}
