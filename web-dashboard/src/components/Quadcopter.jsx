import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Cylinder, Box, Sphere, Cone } from '@react-three/drei';
import * as THREE from 'three';

/* ─── Neon Rotor Blade ─────────────────────────────────────────── */
function RotorBlade({ color }) {
  return (
    <group>
      <Box args={[1.5, 0.025, 0.12]}>
        <meshStandardMaterial color="#1a1a2e" roughness={0.3} />
      </Box>
      <Box args={[0.12, 0.025, 1.5]}>
        <meshStandardMaterial color="#1a1a2e" roughness={0.3} />
      </Box>
      {/* Tip glow dots */}
      <Sphere args={[0.07, 8, 8]} position={[0.75, 0, 0]}>
        <meshBasicMaterial color={color} toneMapped={false} />
      </Sphere>
      <Sphere args={[0.07, 8, 8]} position={[-0.75, 0, 0]}>
        <meshBasicMaterial color={color} toneMapped={false} />
      </Sphere>
    </group>
  );
}

/* ─── Quadcopter ───────────────────────────────────────────────── */
export function Quadcopter({ drone, isActive, hasSnapshot, accentColor = '#10B981' }) {
  const body      = useRef();
  const groupRef  = useRef();
  const r1 = useRef(), r2 = useRef(), r3 = useRef(), r4 = useRef();
  const snapRing  = useRef();
  const scanCone  = useRef();
  const payloadRef = useRef();
  const beaconRef = useRef();

  const rotorColor = isActive
    ? '#06B6D4'
    : (drone.battery < 30 ? '#F43F5E' : '#8B5CF6');
  const bodyColor = drone.alive
    ? (drone.battery < 25 ? '#450A0A' : '#1E293B')
    : '#0A0A14';

  useFrame(({ clock, delta }) => {
    if (!drone.alive) {
      if (groupRef.current && groupRef.current.position.y > 0)
        groupRef.current.position.y -= delta * 1.5;
      return;
    }

    const t = clock.elapsedTime;

    /* Smooth hover bob */
    if (groupRef.current) {
      const phase = drone.id.charCodeAt(1) || 0;
      groupRef.current.position.y = drone.y + Math.sin(t * 1.6 + phase * 0.7) * 0.35;
    }

    /* Rotor spin — faster when active */
    const spd = (isActive ? 24 : 16) * delta;
    if (r1.current) r1.current.rotation.y += spd;
    if (r2.current) r2.current.rotation.y += spd;
    if (r3.current) r3.current.rotation.y -= spd;
    if (r4.current) r4.current.rotation.y -= spd;

    /* Snapshot ring orbit */
    if (snapRing.current && hasSnapshot) {
      snapRing.current.rotation.z += delta * 1.2;
      const pulse = 0.85 + Math.sin(t * 2.5) * 0.18;
      snapRing.current.scale.set(pulse, pulse, 1);
      snapRing.current.material.opacity = 0.55 + Math.sin(t * 3) * 0.2;
    }

    /* Payload glow pulse */
    if (payloadRef.current && drone.packets?.length > 0) {
      payloadRef.current.material.opacity = 0.6 + Math.sin(t * 4 + phase) * 0.3;
    }

    /* Beacon blink */
    if (beaconRef.current) {
      beaconRef.current.intensity = 6 + Math.sin(t * 4) * 4;
    }

    /* Pitch toward target */
    if (groupRef.current && drone.target) {
      const dx = drone.target.x - drone.x;
      const dz = drone.target.z - drone.z;
      const targetYaw = Math.atan2(dx, dz);
      groupRef.current.rotation.y += (targetYaw - groupRef.current.rotation.y) * 0.08;
      const dist = Math.hypot(dx, dz);
      const pitch = dist > 3 ? 0.15 : 0;
      groupRef.current.rotation.x += (pitch - groupRef.current.rotation.x) * 0.08;
    }
  });

  const arms = [
    { pos: [1.1, 0, 1.1], ref: r1, dir: 1 },
    { pos: [-1.1, 0, 1.1], ref: r2, dir: 1 },
    { pos: [1.1, 0, -1.1], ref: r3, dir: -1 },
    { pos: [-1.1, 0, -1.1], ref: r4, dir: -1 },
  ];

  return (
    <group ref={groupRef} position={[drone.x, drone.y, drone.z]} scale={0.65}>
      {/* ── Body ─────────────────────────────────────────────── */}
      <Box ref={body} args={[1.4, 0.4, 1.4]} castShadow>
        <meshStandardMaterial
          color={bodyColor}
          roughness={0.25}
          metalness={0.85}
          emissive={isActive ? '#0C1F4A' : '#000000'}
          emissiveIntensity={isActive ? 1 : 0}
        />
      </Box>

      {/* Center LED strip */}
      <Box args={[0.1, 0.06, 1.2]} position={[0, 0.23, 0]}>
        <meshBasicMaterial color={isActive ? '#06B6D4' : (drone.battery < 30 ? '#F43F5E' : '#8B5CF6')} toneMapped={false} />
      </Box>

      {/* Beacon on top */}
      <Sphere args={[0.1, 8, 8]} position={[0, 0.32, 0]}>
        <meshBasicMaterial color={accentColor} toneMapped={false} />
      </Sphere>
      <pointLight ref={beaconRef} position={[0, 0.5, 0]} color={accentColor} intensity={8} distance={6} decay={2} />

      {/* ── Arms + Rotors ───────────────────────────────────── */}
      {arms.map((arm, i) => {
        const len = Math.hypot(arm.pos[0], arm.pos[2]);
        const angle = Math.atan2(arm.pos[2], arm.pos[0]);
        return (
          <group key={i}>
            {/* Arm */}
            <mesh
              position={[arm.pos[0] * 0.5, 0, arm.pos[2] * 0.5]}
              rotation={[Math.PI / 2, 0, angle]}
              castShadow
            >
              <cylinderGeometry args={[0.07, 0.07, len, 6]} />
              <meshStandardMaterial color="#111827" roughness={0.7} />
            </mesh>
            {/* Motor housing */}
            <mesh position={[arm.pos[0], 0.12, arm.pos[2]]} castShadow>
              <cylinderGeometry args={[0.22, 0.22, 0.28, 10]} />
              <meshStandardMaterial color="#0D1220" metalness={0.6} />
            </mesh>
            {/* Rotor */}
            <group ref={arm.ref} position={[arm.pos[0], 0.28, arm.pos[2]]}>
              <RotorBlade color={rotorColor} />
            </group>
          </group>
        );
      })}

      {/* ── Payload glow (data carrying) ────────────────────── */}
      {drone.alive && drone.packets?.length > 0 && (
        <Sphere ref={payloadRef} args={[0.25, 12, 12]} position={[0, -0.38, 0]}>
          <meshBasicMaterial
            color={isActive ? '#06B6D4' : '#F59E0B'}
            transparent
            opacity={0.8}
            toneMapped={false}
          />
        </Sphere>
      )}

      {/* ── Snapshot Orbital Ring ────────────────────────────── */}
      {hasSnapshot && drone.alive && (
        <mesh ref={snapRing} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.8, 1.98, 48]} />
          <meshBasicMaterial
            color="#8B5CF6"
            transparent
            opacity={0.65}
            side={THREE.DoubleSide}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* ── Scan Laser Cone ─────────────────────────────────── */}
      {drone.isScanning && drone.alive && (
        <group position={[0, -6, 0]} rotation={[Math.PI, 0, 0]}>
          <Cone args={[3.5, 12, 20]} position={[0, -0.5, 0]}>
            <meshBasicMaterial color="#10B981" transparent opacity={0.18} side={THREE.DoubleSide} depthWrite={false} />
          </Cone>
          {/* Scan ground dot */}
          <mesh position={[0, -12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[3.5, 24]} />
            <meshBasicMaterial color="#10B981" transparent opacity={0.3} depthWrite={false} />
          </mesh>
        </group>
      )}

      {/* ── Battery bar (3D world) ────────────────────────────── */}
      {drone.alive && (
        <group position={[0, -0.65, 0]}>
          {/* Track */}
          <Box args={[2.2, 0.07, 0.07]}>
            <meshBasicMaterial color="#0D1220" />
          </Box>
          {/* Fill */}
          <Box
            args={[Math.max(0.01, 2.2 * (drone.battery / 100)), 0.1, 0.1]}
            position={[-1.1 + (1.1 * drone.battery / 100), 0, 0.01]}
          >
            <meshBasicMaterial
              color={drone.battery > 50 ? '#10B981' : drone.battery > 25 ? '#F59E0B' : '#F43F5E'}
              toneMapped={false}
            />
          </Box>
        </group>
      )}
    </group>
  );
}
