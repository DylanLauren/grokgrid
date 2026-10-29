import { CameraControls, CameraControlsImpl, ContactShadows, Environment, Html, Lightformer, RoundedBox } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import type { Feed, Live } from '../data/types'
import { PhoneScreen } from '../ui/PhoneScreen'
import { Bot, type Mood } from './Bot'
import { MON, Room, RoomBaked, RoomLive } from './Room'
import { Props } from './Props'
import { MonitorScreen } from '../ui/MonitorScreen'
import { BOT_POS, BOT_YAW, PHONE, ROOM_ORBIT, ROOM_VIEW, phoneView } from './cameraGeometry'

export type View = 'third' | 'phone'

const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function useMood(feed: Feed): Mood {
  const [mood, setMood] = useState<Mood>('idle')
  const last = feed.calls[0]
  const seen = useRef(last?.id)
  useEffect(() => {
    if (!last || last.id === seen.current) return
    seen.current = last.id
    setMood('tap')
    const after: Mood = last.side === 'buy' ? 'buy' : last.pnlUsd === null ? 'idle' : last.pnlUsd >= 0 ? 'win' : 'loss'
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

// A fixed target and bounded orbit avoid crossing the shell or furniture without
// four expensive raycasts through baked geometry on every animation frame.
function Rig({ view }: { view: View }) {
  const ref = useRef<CameraControls>(null)
  const previous = useRef<View | null>(null)
  const { width, height } = useThree((state) => state.size)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    if (view === 'third' && previous.current === view) return
    const wasPhone = previous.current === 'phone'
    previous.current = view
    c.stop()
    c.colliderMeshes = []
    Object.assign(c, view === 'third' ? ROOM_ORBIT : {
      minDistance: 0.05, maxDistance: 4, minPolarAngle: 0.01,
      maxPolarAngle: Math.PI - 0.01, minAzimuthAngle: -Infinity, maxAzimuthAngle: Infinity,
    })
    c.enabled = view === 'third'
    // Resize only reframes the phone, preserving a visitor's chosen room angle.
    const pose = view === 'phone' ? phoneView(width, height) : ROOM_VIEW
    void c.zoomTo(1, false)
    void c.setLookAt(...pose, !reduced && (view === 'phone' || wasPhone))
  }, [view, width, height])
  const action = CameraControlsImpl.ACTION
  return (
    <CameraControls
      ref={ref}
      makeDefault
      {...ROOM_ORBIT}
      mouseButtons={{ left: action.ROTATE, middle: action.NONE, right: action.NONE, wheel: action.DOLLY }}
      touches={{ one: action.TOUCH_ROTATE, two: action.TOUCH_DOLLY, three: action.NONE }}
      dollyToCursor={false}
      infinityDolly={false}
      smoothTime={0.32}
      draggingSmoothTime={0.12}
      dollySpeed={0.35}
      azimuthRotateSpeed={0.65}
      polarRotateSpeed={0.65}
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
  const [hover, setHover] = useState(false)
  useEffect(() => {
    document.body.style.cursor = hover && view === 'third' ? 'pointer' : ''
  }, [hover, view])

  return (
    <Canvas
      frameloop={paused ? 'never' : 'always'}
      shadows
      dpr={[1, 2]}
      camera={{ position: ROOM_VIEW.slice(0, 3) as [number, number, number], fov: 38, near: 0.02, far: 30 }}
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
          <RoomBaked />
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

      <Bot ref={bot} mood={mood} position={BOT_POS} yaw={BOT_YAW} steady={view === 'phone'}>
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
            occlude={view === 'phone' ? false : [bot]}
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
      <Rig view={view} />
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
