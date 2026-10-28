import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

// The live layer over the city through his window: stars that twinkle, now and then a
// shooting star, and a plane crossing slowly with its lights blinking.
const frag = /* glsl */ `
uniform float uTime;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 uv = vUv;
  vec3 col = vec3(0.0);
  float a = 0.0;

  // stars, only in the sky above the towers
  vec2 grid = uv * vec2(46.0, 50.0);
  vec2 cell = floor(grid);
  float h = hash(cell);
  if (h > 0.9 && uv.y > 0.6) {
    vec2 c = vec2(hash(cell + 1.3), hash(cell + 7.1)) * 0.7 + 0.15;
    float d = length(fract(grid) - c);
    float size = 0.06 + hash(cell + 3.7) * 0.08;
    float tw = 0.45 + 0.55 * sin(uTime * (1.2 + hash(cell + 9.2) * 3.0) + h * 40.0);
    tw *= tw;
    float s = smoothstep(size, 0.0, d) * tw;
    // a soft cross on the brightest ones
    vec2 q = abs(fract(grid) - c);
    s += step(0.985, h) * tw * smoothstep(0.012, 0.0, min(q.x, q.y)) * smoothstep(0.35, 0.0, max(q.x, q.y)) * 0.6;
    col += vec3(0.85, 0.9, 1.0) * s;
    a += s;
  }

  // a shooting star every 11 seconds, for under a second
  float t = mod(uTime, 11.0);
  if (t < 0.9) {
    float k = t / 0.9;
    vec2 head = vec2(0.15 + k * 0.6, 0.97 - k * 0.22);
    vec2 dir = normalize(vec2(0.6, -0.22));
    vec2 rel = uv - head;
    float along = dot(rel, -dir);
    float across = abs(rel.x * dir.y - rel.y * dir.x);
    float tail = smoothstep(0.16, 0.0, along) * step(0.0, along) * smoothstep(0.003, 0.0, across);
    float fade = sin(k * 3.14159);
    col += vec3(1.0) * tail * fade;
    a += tail * fade;
  }

  // a plane crossing every 40 seconds, red and white lights out of step
  float pt = mod(uTime, 40.0) / 40.0;
  vec2 plane = vec2(-0.05 + pt * 1.1, 0.8 + pt * 0.05);
  float pd = length((uv - plane) * vec2(1.0, 1.1));
  float red = step(0.5, fract(uTime * 0.9)) * smoothstep(0.006, 0.0, pd);
  float white = step(0.85, fract(uTime * 0.9 + 0.3)) * smoothstep(0.005, 0.0, length(uv - plane - vec2(0.012, 0.0)));
  col += vec3(1.0, 0.25, 0.2) * red + vec3(1.0) * white;
  a += red + white;

  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`

export function Sky({ position, size }: { position: [number, number, number]; size: [number, number] }) {
  const mat = useRef<THREE.ShaderMaterial>(null!)
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), [])
  useFrame(({ clock }) => {
    mat.current.uniforms.uTime.value = clock.elapsedTime
  })
  return (
    <mesh position={position}>
      <planeGeometry args={size} />
      <shaderMaterial ref={mat} uniforms={uniforms} vertexShader={vert} fragmentShader={frag} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  )
}
