import { RoundedBox, Sparkles } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

// Small things in his room that keep moving: steam off the coffee, a lava lamp,
// a clock on real time, dust in the lamp light, and the two little bots on the desk.

const DESK_Y = 0.75

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`

const steamFrag = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 uv = vUv;
  float wob = (noise(vec2(uv.y * 3.0 - uTime * 0.6, 1.7)) - 0.5) * 0.35 * uv.y;
  float x = abs(uv.x - 0.5 - wob) * 2.0;
  float body = smoothstep(0.55 + uv.y * 0.35, 0.0, x);
  float n = noise(vec2(uv.x * 4.0, uv.y * 5.0 - uTime * 0.9));
  float a = body * n * smoothstep(0.0, 0.18, uv.y) * smoothstep(1.0, 0.35, uv.y) * 0.5;
  gl_FragColor = vec4(vec3(0.92), a);
}`

const lavaFrag = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 uv = vUv * vec2(1.0, 2.6);
  float f = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 c = vec2(0.5 + sin(uTime * 0.21 + fi * 1.7) * 0.18, 1.3 + sin(uTime * (0.13 + fi * 0.031) + fi * 2.1) * 1.05);
    f += (0.022 + fi * 0.004) / dot(uv - c, uv - c);
  }
  float blob = smoothstep(0.9, 1.1, f);
  vec3 liquid = mix(vec3(0.22, 0.05, 0.3), vec3(0.45, 0.12, 0.5), vUv.y);
  vec3 wax = mix(vec3(1.0, 0.42, 0.1), vec3(1.0, 0.75, 0.25), blob * vUv.y);
  gl_FragColor = vec4(mix(liquid, wax, blob), 1.0);
}`

function Steam() {
  const mat = useRef<THREE.ShaderMaterial>(null!)
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), [])
  const ref = useRef<THREE.Group>(null!)
  useFrame(({ clock, camera }) => {
    mat.current.uniforms.uTime.value = clock.elapsedTime
    // always turned to the camera, like a wisp would read from anywhere
    ref.current.rotation.y = Math.atan2(camera.position.x - 0.62, camera.position.z - 0.12)
  })
  return (
    <group ref={ref} position={[0.62, DESK_Y + 0.21, 0.12]}>
      <mesh>
        <planeGeometry args={[0.1, 0.24]} />
        <shaderMaterial ref={mat} uniforms={uniforms} vertexShader={vert} fragmentShader={steamFrag} transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function LavaLamp() {
  const mat = useRef<THREE.ShaderMaterial>(null!)
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), [])
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2b2b2e', metalness: 0.8, roughness: 0.35 }), [])
  useFrame(({ clock }) => {
    mat.current.uniforms.uTime.value = clock.elapsedTime
  })
  return (
    <group position={[-0.68, 0.935, -0.845]} scale={0.85}>
      <mesh position={[0, 0.045, 0]} material={metal} castShadow>
        <cylinderGeometry args={[0.03, 0.05, 0.09, 32]} />
      </mesh>
      <mesh position={[0, 0.16, 0]}>
        <cylinderGeometry args={[0.022, 0.034, 0.14, 32, 1, true]} />
        <shaderMaterial ref={mat} uniforms={uniforms} vertexShader={vert} fragmentShader={lavaFrag} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.25, 0]} material={metal}>
        <cylinderGeometry args={[0.012, 0.022, 0.04, 32]} />
      </mesh>
      <pointLight position={[0, 0.16, 0.05]} intensity={0.35} distance={0.7} color="#ff7a2a" />
    </group>
  )
}

function WallClock() {
  const hour = useRef<THREE.Group>(null!)
  const min = useRef<THREE.Group>(null!)
  const sec = useRef<THREE.Group>(null!)
  const face = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e9e7e2', roughness: 0.6 }), [])
  const ink = useMemo(() => new THREE.MeshBasicMaterial({ color: '#111' }), [])
  const rim = useMemo(() => new THREE.MeshStandardMaterial({ color: '#0d0d0d', roughness: 0.4 }), [])
  useFrame(() => {
    const d = new Date()
    const s = d.getSeconds() + d.getMilliseconds() / 1000
    const m = d.getMinutes() + s / 60
    const h = (d.getHours() % 12) + m / 60
    sec.current.rotation.z = -(s / 60) * Math.PI * 2
    min.current.rotation.z = -(m / 60) * Math.PI * 2
    hour.current.rotation.z = -(h / 12) * Math.PI * 2
  })
  const red = useMemo(() => new THREE.MeshBasicMaterial({ color: '#e5484d' }), [])
  // each hand turns about the centre pin, so the mesh sits half its length up
  const hand = (ref: React.RefObject<THREE.Group>, len: number, w: number, z: number, m = ink) => (
    <group ref={ref}>
      <mesh position={[0, len / 2 - 0.008, z]} material={m}>
        <planeGeometry args={[w, len]} />
      </mesh>
    </group>
  )
  return (
    <group position={[0.02, 1.74, -0.89]}>
      <mesh rotation-x={Math.PI / 2} material={rim}>
        <cylinderGeometry args={[0.105, 0.105, 0.025, 48]} />
      </mesh>
      <mesh position={[0, 0, 0.013]} material={face}>
        <circleGeometry args={[0.094, 48]} />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={i} position={[Math.sin((i / 12) * Math.PI * 2) * 0.08, Math.cos((i / 12) * Math.PI * 2) * 0.08, 0.014]} rotation-z={-(i / 12) * Math.PI * 2} material={ink}>
          <planeGeometry args={[i % 3 ? 0.003 : 0.006, i % 3 ? 0.01 : 0.016]} />
        </mesh>
      ))}
      {hand(hour, 0.05, 0.006, 0.015)}
      {hand(min, 0.072, 0.004, 0.016)}
      {hand(sec, 0.08, 0.0015, 0.017, red)}
      <mesh position={[0, 0, 0.018]} material={ink}>
        <circleGeometry args={[0.005, 16]} />
      </mesh>
    </group>
  )
}

// The two little bots on the desk breathe, blink, and now and then turn to look at him.
function MiniBot({ position, color, squircle, phase }: { position: [number, number, number]; color: string; squircle?: boolean; phase: number }) {
  const m = useMemo(() => new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.8 }), [color])
  const eye = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff' }), [])
  const root = useRef<THREE.Group>(null!)
  const eyes = useRef<THREE.Group>(null!)
  const st = useRef({ blink: 0, next: 2 + phase, look: 0, nextLook: 4 + phase * 2 })
  const s = 0.055
  const halfHeight = squircle ? s * 0.9 : s
  useFrame((_, dt) => {
    const t = performance.now() / 1000 + phase * 3
    const k = st.current
    // Breathe around the resting height so neither shape floats above the desk.
    const breath = 1 + Math.sin(t * 1.3) * 0.025
    root.current.scale.y = breath
    root.current.position.y = position[1] + halfHeight * breath
    k.next -= dt
    if (k.next < 0) {
      k.blink = 0.15
      k.next = 2.5 + Math.random() * 4
    }
    k.blink = Math.max(0, k.blink - dt)
    eyes.current.scale.y = k.blink > 0 ? 0.15 : 1
    k.nextLook -= dt
    if (k.nextLook < 0) {
      k.look = k.look ? 0 : 1
      k.nextLook = k.look ? 2 : 5 + Math.random() * 5
    }
    // looking at him means turning toward the bot's chair (+x, +z from here)
    root.current.rotation.y = THREE.MathUtils.damp(root.current.rotation.y, k.look ? 1.1 : 0.4, 4, dt)
  })
  return (
    <group ref={root} position={[position[0], position[1] + halfHeight, position[2]]} rotation-y={0.4}>
      {squircle ? (
        <RoundedBox args={[s * 1.9, s * 1.8, s * 1.7]} radius={s * 0.6} smoothness={6} material={m} castShadow />
      ) : (
        <mesh material={m} castShadow>
          <sphereGeometry args={[s, 40, 30]} />
        </mesh>
      )}
      <group ref={eyes} position={[0, s * 0.15, 0]}>
        {[-1, 1].map((k) => (
          <mesh key={k} position={[k * s * 0.33, 0, s * (squircle ? 0.86 : 0.93)]} rotation-z={-0.2} material={eye}>
            <capsuleGeometry args={[s * 0.1, s * 0.28, 4, 12]} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

export function Props() {
  return (
    <group>
      <Steam />
      <LavaLamp />
      <WallClock />
      <MiniBot position={[-0.36, DESK_Y, -0.3]} color="#ff6a00" phase={0} />
      <MiniBot position={[-0.25, DESK_Y, -0.36]} color="#13b8a6" squircle phase={1.3} />
      {/* dust drifting through the lamp light */}
      <Sparkles count={26} scale={[0.4, 0.35, 0.4]} position={[-0.3, 0.95, -0.02]} size={1.1} speed={0.12} opacity={0.35} color="#ffe2bd" noise={0.6} />
    </group>
  )
}
