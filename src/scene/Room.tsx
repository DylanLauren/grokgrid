import { RoundedBox, useGLTF } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import { cityTexture, familyPoster, stickyNote } from './textures'

const DESK_Y = 0.75
// angled toward the room so the screen reads from the default view
export const MON = { w: 0.66, h: 0.38, x: 0.1, y: 1.13, z: -0.3, yaw: 0.38 }

const mat = {
  wall: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.95 }),
  floor: new THREE.MeshStandardMaterial({ color: '#0e0d0c', roughness: 0.7 }),
  desk: new THREE.MeshStandardMaterial({ color: '#1f1b17', roughness: 0.55 }),
  metal: new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.4, metalness: 0.6 }),
  black: new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: 0.35 }),
  fabric: new THREE.MeshStandardMaterial({ color: '#171717', roughness: 0.9 }),
  ceramic: new THREE.MeshPhysicalMaterial({ color: '#efeeea', roughness: 0.25, clearcoat: 0.6 }),
}

// The room modelled and lit in Blender (blender/room.py), lighting baked into its textures.
export function RoomBaked() {
  const { scene } = useGLTF('/room.glb')
  const room = useMemo(() => {
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const map = (m.material as THREE.MeshStandardMaterial).map
      if (map) map.colorSpace = THREE.SRGBColorSpace
      m.material = new THREE.MeshBasicMaterial({ map, toneMapped: false })
    })
    return scene
  }, [scene])
  return <primitive object={room} />
}

// What stays live on top of either room: the city, the poster print, the sticky note
// and the two small family bots.
export function RoomLive() {
  const city = useMemo(() => cityTexture(), [])
  const poster = useMemo(() => familyPoster(), [])
  const note = useMemo(() => stickyNote(), [])
  return (
    <group>
      <mesh position={[-0.98, 1.5, -0.895]}>
        <planeGeometry args={[0.95, 1.05]} />
        <meshBasicMaterial map={city} toneMapped={false} />
      </mesh>
      <mesh position={[0.98, 1.58, -0.874]}>
        <planeGeometry args={[0.74, 0.52]} />
        <meshBasicMaterial map={poster} toneMapped={false} color="#8a8a8a" />
      </mesh>
      <group position={[MON.x, 0, MON.z]} rotation-y={MON.yaw}>
        <mesh position={[MON.w / 2 - 0.035, MON.y - MON.h / 2 + 0.05, 0.0135]} rotation-z={0.06}>
          <planeGeometry args={[0.075, 0.075]} />
          <meshBasicMaterial map={note} toneMapped={false} color="#9a9a9a" />
        </mesh>
      </group>
      <MiniBot position={[-0.36, DESK_Y, -0.3]} color="#ff6a00" />
      <MiniBot position={[-0.25, DESK_Y, -0.36]} color="#13b8a6" squircle />
    </group>
  )
}

// Plain stand-in shown while room.glb loads, or if it fails.
export function Room() {
  return (
    <group>
      {/* shell */}
      <mesh rotation-x={-Math.PI / 2} material={mat.floor} receiveShadow>
        <planeGeometry args={[6, 6]} />
      </mesh>
      <mesh position={[0, 1.5, -0.9]} material={mat.wall} receiveShadow>
        <planeGeometry args={[6, 3]} />
      </mesh>
      <mesh position={[-1.7, 1.5, 1]} rotation-y={Math.PI / 2} material={mat.wall} receiveShadow>
        <planeGeometry args={[4, 3]} />
      </mesh>

      {/* window */}
      <group position={[-0.98, 1.5, -0.895]}>
        {[[-0.49, 0, 0.03, 1.11], [0.49, 0, 0.03, 1.11], [0, 0.54, 1.01, 0.03], [0, -0.54, 1.01, 0.03], [0, 0, 0.018, 1.05], [0, 0.1, 0.95, 0.018]].map(([x, y, w, h], i) => (
          <mesh key={i} position={[x, y, 0.012]} material={mat.black}>
            <boxGeometry args={[w, h, 0.03]} />
          </mesh>
        ))}
        <mesh position={[0, -0.58, 0.06]} material={mat.black}>
          <boxGeometry args={[1.05, 0.03, 0.12]} />
        </mesh>
      </group>

      {/* poster of the bot family */}
      <group position={[0.98, 1.58, -0.885]}>
        <mesh material={mat.black}>
          <boxGeometry args={[0.78, 0.56, 0.02]} />
        </mesh>
      </group>

      {/* desk */}
      <RoundedBox args={[1.7, 0.045, 0.8]} radius={0.012} position={[0, DESK_Y - 0.0225, -0.07]} material={mat.desk} castShadow receiveShadow />
      {[[-0.8, -0.42], [0.8, -0.42], [-0.8, 0.28], [0.8, 0.28]].map(([x, z], i) => (
        <mesh key={i} position={[x, DESK_Y / 2, z]} material={mat.metal} castShadow>
          <boxGeometry args={[0.035, DESK_Y - 0.04, 0.035]} />
        </mesh>
      ))}

      {/* monitor */}
      <group position={[MON.x, 0, MON.z]} rotation-y={MON.yaw}>
        <mesh position={[0, DESK_Y + 0.005, 0.02]} material={mat.metal} castShadow>
          <boxGeometry args={[0.24, 0.01, 0.16]} />
        </mesh>
        <mesh position={[0, DESK_Y + 0.15, -0.02]} material={mat.metal} castShadow>
          <boxGeometry args={[0.05, 0.3, 0.02]} />
        </mesh>
        <RoundedBox args={[MON.w + 0.03, MON.h + 0.03, 0.025]} radius={0.008} position={[0, MON.y, 0]} material={mat.black} castShadow />
      </group>

      {/* keyboard */}
      <RoundedBox args={[0.42, 0.018, 0.13]} radius={0.006} position={[0.32, DESK_Y + 0.009, -0.02]} rotation-y={-0.12} material={mat.black} castShadow />

      {/* lamp */}
      <group position={[-0.62, DESK_Y, -0.24]}>
        <mesh position={[0, 0.01, 0]} material={mat.black} castShadow>
          <cylinderGeometry args={[0.08, 0.09, 0.02, 40]} />
        </mesh>
        <mesh position={[0.05, 0.22, 0.03]} rotation-z={-0.25} material={mat.black}>
          <cylinderGeometry args={[0.008, 0.008, 0.44, 12]} />
        </mesh>
        <mesh position={[0.16, 0.42, 0.08]} rotation={[0.3, 0, 1.1]} material={mat.black}>
          <coneGeometry args={[0.07, 0.12, 40, 1, true]} />
        </mesh>
        <mesh position={[0.17, 0.4, 0.09]}>
          <sphereGeometry args={[0.025, 16, 12]} />
          <meshBasicMaterial color="#fff2dc" toneMapped={false} />
        </mesh>
      </group>

      {/* mug */}
      <group position={[0.62, DESK_Y, 0.12]}>
        <mesh position={[0, 0.05, 0]} material={mat.ceramic} castShadow>
          <cylinderGeometry args={[0.04, 0.036, 0.1, 40]} />
        </mesh>
        <mesh position={[0.045, 0.055, 0]} material={mat.ceramic}>
          <torusGeometry args={[0.022, 0.007, 12, 24]} />
        </mesh>
      </group>


      {/* chair */}
      <group position={[0, 0, 0.8]}>
        <RoundedBox args={[0.56, 0.07, 0.52]} radius={0.03} position={[0, 0.5, 0]} material={mat.fabric} castShadow receiveShadow />
        <RoundedBox args={[0.54, 0.62, 0.06]} radius={0.03} position={[0, 0.88, 0.32]} rotation-x={-0.08} material={mat.fabric} castShadow />
        <mesh position={[0, 0.25, 0]} material={mat.metal}>
          <cylinderGeometry args={[0.025, 0.025, 0.45, 16]} />
        </mesh>
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[Math.cos((i / 5) * Math.PI * 2) * 0.16, 0.04, Math.sin((i / 5) * Math.PI * 2) * 0.16]} rotation-y={-(i / 5) * Math.PI * 2} material={mat.metal}>
            <boxGeometry args={[0.32, 0.025, 0.04]} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

function MiniBot({ position, color, squircle }: { position: [number, number, number]; color: string; squircle?: boolean }) {
  const m = useMemo(() => new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.8 }), [color])
  const eye = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff' }), [])
  const s = 0.055
  return (
    <group position={[position[0], position[1] + s, position[2]]} rotation-y={0.4}>
      {squircle ? (
        <RoundedBox args={[s * 1.9, s * 1.8, s * 1.7]} radius={s * 0.6} smoothness={6} material={m} castShadow />
      ) : (
        <mesh material={m} castShadow>
          <sphereGeometry args={[s, 40, 30]} />
        </mesh>
      )}
      {[-1, 1].map((k) => (
        <mesh key={k} position={[k * s * 0.33, s * 0.15, s * (squircle ? 0.86 : 0.93)]} rotation-z={-0.2} material={eye}>
          <capsuleGeometry args={[s * 0.1, s * 0.28, 4, 12]} />
        </mesh>
      ))}
    </group>
  )
}
