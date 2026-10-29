import { useFrame } from '@react-three/fiber'
import { forwardRef, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'

export type Mood = 'idle' | 'tap' | 'buy' | 'win' | 'loss'

const R = 0.32
const EYE_TILT = -0.47 // the eyes lean the same way they do on the @bot avatar

// Two pill eyes sat flush on the sphere. Built once and reused by every bot.
function useEyeGeometry() {
  return useMemo(() => {
    const k = R / 0.42
    const g = new THREE.CapsuleGeometry(0.046 * k, 0.115 * k, 8, 24)
    g.scale(1, 1, 0.42)
    return g
  }, [])
}

function eyeTransform(x: number, y: number) {
  const dir = new THREE.Vector3(x, y, 1).normalize()
  const pos = dir.clone().multiplyScalar(R * 0.985)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir)
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), EYE_TILT))
  return { pos, q }
}

interface Props {
  mood: Mood
  position: [number, number, number]
  yaw?: number
  steady?: boolean // keep the held phone on its fixed camera target while watching
  children?: ReactNode // what he holds, placed between the hands
}

export const Bot = forwardRef<THREE.Group, Props>(function Bot({ mood, position, yaw = 0, steady = false, children }, ref) {
  const motion = useRef<THREE.Group>(null!)
  const body = useRef<THREE.Group>(null!)
  const look = useRef<THREE.Group>(null!)
  const eyes = useRef<THREE.Group>(null!)
  const hands = useRef<THREE.Group>(null!)
  const eyeGeo = useEyeGeometry()
  const left = useMemo(() => eyeTransform(-0.2, 0.13), [])
  const right = useMemo(() => eyeTransform(0.2, 0.17), [])
  const state = useRef({
    nextBlink: 2,
    blink: 0,
    glance: 0,
    nextGlance: 6,
    moodT: 0,
    lastMood: mood,
  })

  const skin = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#f4f4f2',
        roughness: 0.32,
        clearcoat: 1,
        clearcoatRoughness: 0.18,
        sheen: 0.4,
        sheenColor: new THREE.Color('#ffffff'),
      }),
    [],
  )
  const ink = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#050505',
        roughness: 0.25,
        metalness: 0,
      }),
    [],
  )

  useFrame((_, dt) => {
    const s = state.current
    const t = performance.now() / 1000
    if (s.lastMood !== mood) {
      s.lastMood = mood
      s.moodT = 0
    }
    s.moodT += dt

    // look: mostly down at the phone, now and then up at the monitor
    s.nextGlance -= dt
    if (s.nextGlance < 0) {
      s.glance = s.glance ? 0 : 1
      s.nextGlance = s.glance ? 1.6 + Math.random() : 5 + Math.random() * 6
    }
    const upAtMonitor = s.glance && mood === 'idle'
    const targetX = upAtMonitor ? 0.08 : -0.3
    const targetY = upAtMonitor ? -0.12 : Math.sin(t * 0.4) * 0.05
    look.current.rotation.x = THREE.MathUtils.damp(look.current.rotation.x, targetX, 5, dt)
    look.current.rotation.y = THREE.MathUtils.damp(look.current.rotation.y, targetY, 5, dt)

    // Body, hands and phone rise together; the resting pose never sinks into the seat.
    let y = (1 + Math.sin(t * 1.6)) * 0.004
    let squash = 1
    if (mood === 'win') {
      const hop = Math.abs(Math.sin(s.moodT * 7)) * Math.exp(-s.moodT * 1.2)
      y += hop * 0.09
      squash = 1 - hop * 0.05
    } else if (mood === 'buy') {
      y += Math.sin(s.moodT * 10) * Math.exp(-s.moodT * 3) * 0.02
    }
    motion.current.position.y = steady ? 0 : Math.max(0, y)
    // A disappointed head tilt replaces the old downward stretch through the chair.
    body.current.rotation.z = THREE.MathUtils.damp(body.current.rotation.z, mood === 'loss' ? -0.08 : 0, 5, dt)
    body.current.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash))

    // eyes: blink every few seconds, narrow on a loss, widen on a win
    s.nextBlink -= dt
    if (s.nextBlink < 0) {
      s.blink = 0.14
      s.nextBlink = 2.5 + Math.random() * 4
    }
    s.blink = Math.max(0, s.blink - dt)
    const blinkK = s.blink > 0 ? Math.abs(Math.cos((s.blink / 0.14) * Math.PI)) * 0.9 + 0.1 : 1
    const moodK = mood === 'loss' ? 0.55 : mood === 'win' ? 1.12 : 1
    const ey = THREE.MathUtils.damp(eyes.current.scale.y, moodK, 8, dt)
    eyes.current.scale.y = ey
    eyes.current.children.forEach((e) => (e.scale.y = blinkK))

    // thumbs: a quick double tap when it trades
    const tapping = mood === 'tap' || (mood === 'buy' && s.moodT < 0.6)
    const tap = tapping ? Math.max(0, Math.sin(t * 22)) * 0.012 : 0
    hands.current.children[1].position.y = -0.075 - tap
  })

  return (
    <group ref={ref} position={position} rotation-y={yaw}>
      <group ref={motion}>
        {/* In phone view the camera represents his eyes, so his own head stays out of shot. */}
        <group ref={body} visible={!steady}>
          <mesh material={skin} castShadow receiveShadow>
            <sphereGeometry args={[R, 96, 64]} />
          </mesh>
          <group ref={look}>
            {/* face the desk (-z), where the phone and monitor are */}
            <group rotation-y={Math.PI}>
              <group ref={eyes}>
                <mesh geometry={eyeGeo} material={ink} position={left.pos} quaternion={left.q} />
                <mesh geometry={eyeGeo} material={ink} position={right.pos} quaternion={right.q} />
              </group>
            </group>
          </group>
        </group>
        {/* two floating pebble hands, the only addition to the mascot, so he can hold a phone */}
        <group ref={hands}>
          <mesh material={skin} position={[-0.07, -0.085, -0.37]} castShadow>
            <sphereGeometry args={[0.03, 32, 24]} />
          </mesh>
          <mesh material={skin} position={[0.07, -0.075, -0.37]} castShadow>
            <sphereGeometry args={[0.03, 32, 24]} />
          </mesh>
        </group>
        {children}
      </group>
    </group>
  )
})
