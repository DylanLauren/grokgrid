import { CameraControls, ContactShadows, Environment, Html, Lightformer, RoundedBox } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import type { Feed, Live } from '../data/types'
import { PhoneScreen } from '../ui/PhoneScreen'
import { Bot, type Mood } from './Bot'
import { MON, Room, RoomBaked, RoomLive } from './Room'
import { Props } from './Props'
import { MonitorScreen } from '../ui/MonitorScreen'

export type View = 'third' | 'phone'

const BOT_POS: [number, number, number] = [0, 0.86, 0.64]
const PHONE = { pos: [0, -0.04, -0.42] as [number, number, number], tilt: -1.05, w: 0.074, h: 0.158 }

// he sits turned a little toward the room so the default view catches his face
const BOT_YAW = -0.45

// a point given relative to the bot, in world space
function fromBot(x: number, y: number, z: number): [number, number, number] {
  const c = Math.cos(BOT_YAW)
  const s = Math.sin(BOT_YAW)
  return [BOT_POS[0] + x * c + z * s, BOT_POS[1] + y, BOT_POS[2] - x * s + z * c]
}

const VIEWS: Record<View, [number, number, number, number, number, number]> = {
  third: [2.0, 1.75, -0.35, -0.12, 0.9, 0.12],
  phone: [...fromBot(0.02, 0.28, -0.28), ...fromBot(0, -0.04, -0.42)],
}

const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function useMood(feed: Feed): Mood {
  const [mood, setMood] = useState<Mood>('idle')
  const last = feed.calls[0]
  const seen = useRef(last?.id)
  useEffect(() => {
    if (!last || last.id === seen.current) return
    seen.current = last.id
    setMood('tap')
    const after: Mood = last.side === 'buy' ? 'buy' : last.pnlUsd >= 0 ? 'win' : 'loss'
    const a = setTimeout(() => setMood(after), 700)
    const b = setTimeout(() => setMood('idle'), 3800)
    return () => {
      clearTimeout(a)
      clearTimeout(b)
    }
  }, [last])
  return mood
}

// drei's Html loses its first render when the canvas target settles a frame late,
// so screens mount one tick after the canvas.
function Later({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(t)
  }, [])
  return ready ? <>{children}</> : null
}

// Anything in the room between the camera and him pushes the camera in front of it,
// so looking around never ends behind a chair, a shelf or a wall.
function Rig({ view, colliders }: { view: View; colliders: THREE.Object3D[] }) {
  const ref = useRef<CameraControls>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.colliderMeshes = colliders
  }, [colliders])
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const [px, py, pz, tx, ty, tz] = VIEWS[view]
    c.setLookAt(px, py, pz, tx, ty, tz, !reduced)
    // a phone held up close fills a narrow screen sooner
    c.zoomTo(view === 'phone' ? (innerWidth < 700 ? 0.85 : 1.3) : 1, !reduced)
    c.enabled = view === 'third'
  }, [view])
  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={0.7}
      maxDistance={3.2}
      minPolarAngle={0.35}
      maxPolarAngle={1.52}
      minAzimuthAngle={-1.05}
      maxAzimuthAngle={2.2}
      smoothTime={0.6}
      dollySpeed={0.4}
    />
  )
}

interface SceneProps {
  feed: Feed
  live: Live
  view: View
  paused: boolean // a page is open over the room, so it stops drawing
  onPhone: () => void
}

export function Scene({ feed, live, view, paused, onPhone }: SceneProps) {
  const mood = useMood(feed)
  const bot = useRef<THREE.Group>(null!)
  const [colliders, setColliders] = useState<THREE.Object3D[]>([])
  const [hover, setHover] = useState(false)
  useEffect(() => {
    document.body.style.cursor = hover && view === 'third' ? 'pointer' : ''
  }, [hover, view])

  return (
    <Canvas
      frameloop={paused ? 'never' : 'always'}
      shadows
      dpr={[1, 2]}
      camera={{ position: VIEWS.third.slice(0, 3) as [number, number, number], fov: 38, near: 0.02, far: 30 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      onCreated={({ scene }) => {
        scene.background = new THREE.Color('#0a0a0a')
        scene.fog = new THREE.Fog('#0a0a0a', 3.5, 7.5)
      }}
    >
      <ambientLight intensity={0.12} />
      <hemisphereLight args={['#9fb0ff', '#1a120a', 0.18]} />
      {/* desk lamp */}
      <spotLight
        position={[-0.45, 1.16, -0.15]}
        angle={0.85}
        penumbra={0.9}
        intensity={5}
        distance={3}
        decay={1.6}
        color="#ffd4a3"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
      {/* monitor spill */}
      <pointLight position={[0.06, 1.12, -0.12]} intensity={0.9} distance={1.6} decay={2} color="#d8e0ff" />
      {/* moon through the window */}
      <directionalLight position={[-3, 3, -1]} intensity={0.35} color="#8ea6ff" />
      {/* rim from behind the camera so the white sphere reads against the dark */}
      <pointLight position={[1.4, 1.8, 1.8]} intensity={0.6} distance={5} color="#ffffff" />

      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.2} color="#ffd9b0" position={[-1.5, 2, 0]} scale={[2, 1, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#a9b8ff" position={[-1, 1.5, -2]} scale={[1.5, 1.5, 1]} />
        <Lightformer form="rect" intensity={1.6} color="#ffffff" position={[2, 2.5, 2]} scale={[3, 1, 1]} />
        <Lightformer form="ring" intensity={0.8} color="#ffffff" position={[0, 4, 0]} scale={2} />
      </Environment>

      <KeepFallback fallback={<Room />}>
        <Suspense fallback={<Room />}>
          <RoomBaked onReady={setColliders} />
        </Suspense>
      </KeepFallback>
      <RoomLive />
      <Props />
      <group position={[MON.x, 0, MON.z]} rotation-y={MON.yaw}>
        <Later>
          <Html
            transform
            occlude={[bot]}
            distanceFactor={(MON.w * 400) / 760}
            position={[0, MON.y, 0.0135]}
            zIndexRange={[10, 0]}
            pointerEvents="none"
          >
            <MonitorScreen feed={feed} live={live} />
          </Html>
        </Later>
      </group>

      <Bot ref={bot} mood={mood} position={BOT_POS} yaw={BOT_YAW}>
        <group
          position={PHONE.pos}
          rotation-x={PHONE.tilt}
          onClick={(e) => {
            e.stopPropagation()
            onPhone()
          }}
          onPointerOver={() => setHover(true)}
          onPointerOut={() => setHover(false)}
        >
          <RoundedBox args={[PHONE.w + 0.006, PHONE.h + 0.006, 0.009]} radius={0.009} smoothness={6} castShadow>
            <meshStandardMaterial color="#1b1c1f" roughness={0.3} metalness={0.5} />
          </RoundedBox>
          <Later>
          <Html
            transform
            distanceFactor={(PHONE.w * 400) / 300}
            position={[0, 0, 0.0052]}
            occlude={[bot]}
            zIndexRange={[20, 10]}
            pointerEvents="none"
          >
            <PhoneScreen feed={feed} live={live} watching={view === 'phone' && !paused} />
          </Html>
          </Later>
          <pointLight position={[0, 0, 0.05]} intensity={0.25} distance={0.45} color="#c9ffe0" />
        </group>
        <Later>
          <Html position={[-0.06, 0.03, -0.42]} center zIndexRange={[30, 20]}>
            <button className={`watch ${hover ? 'hot' : ''} ${view === 'third' && !paused ? '' : 'gone'}`} onClick={onPhone} tabIndex={view === 'third' ? 0 : -1}>
              <span className="watch-line" />
              <span className="watch-pill">Watch me trade!</span>
            </button>
          </Html>
        </Later>
      </Bot>

      <ContactShadows position={[0, 0.001, 0.3]} opacity={0.55} scale={4} blur={2.6} far={1.2} />
      <Rig view={view} colliders={colliders} />
    </Canvas>
  )
}

// If room.glb fails to load, keep the plain room instead of an empty scene.
class KeepFallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
