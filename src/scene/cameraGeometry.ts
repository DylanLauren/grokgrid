import { MathUtils, Vector3 } from 'three'

export const BOT_POS: [number, number, number] = [0, 0.86, 0.64]
export const BOT_YAW = -0.45
export const PHONE = { pos: [0, -0.04, -0.42] as [number, number, number], tilt: -1.05, w: 0.074, h: 0.074 * 640 / 300 }
export const ROOM_VIEW: [number, number, number, number, number, number] = [2, 1.75, -0.35, -0.12, 0.9, 0.12]
// The requested orbit is broad; the rendered camera glides along inexpensive
// analytic limits instead of colliding with thousands of baked triangles.
export const ROOM_ORBIT = { minDistance: 1.4, maxDistance: 3.4, minPolarAngle: 0.4, maxPolarAngle: 1.3, minAzimuthAngle: -1.15, maxAzimuthAngle: 2.2 }
export function constrainRoomOrbit(azimuth: number, polar: number, distance: number) {
  const az = MathUtils.clamp(azimuth, ROOM_ORBIT.minAzimuthAngle, ROOM_ORBIT.maxAzimuthAngle)
  // Look over the chair at the rear, then smoothly allow a lower front view.
  const maxPolar = 0.82 + 0.48 * MathUtils.smoothstep(az, -0.15, 0.5)
  const phi = MathUtils.clamp(polar, ROOM_ORBIT.minPolarAngle, maxPolar)
  const dx = Math.sin(phi) * Math.sin(az), dy = Math.cos(phi), dz = Math.sin(phi) * Math.cos(az)
  let radius = MathUtils.clamp(distance, ROOM_ORBIT.minDistance, ROOM_ORBIT.maxDistance)
  // Bounds include near-plane clearance and stay in front of the shelf. Their
  // intersection varies continuously with the orbit direction.
  if (dx < 0) radius = Math.min(radius, (-1.38 - ROOM_VIEW[3]) / dx)
  if (dx > 0) radius = Math.min(radius, (2.85 - ROOM_VIEW[3]) / dx)
  if (dy > 0) radius = Math.min(radius, (2.85 - ROOM_VIEW[4]) / dy)
  if (dz < 0) radius = Math.min(radius, (-0.76 - ROOM_VIEW[5]) / dz)
  if (dz > 0) radius = Math.min(radius, (3.2 - ROOM_VIEW[5]) / dz)
  return { azimuth: az, polar: phi, distance: radius }
}
const yAxis = new Vector3(0, 1, 0)
export function phoneGeometry() {
  const center = new Vector3(...PHONE.pos).applyAxisAngle(yAxis, BOT_YAW).add(new Vector3(...BOT_POS))
  const normal = new Vector3(0, -Math.sin(PHONE.tilt), Math.cos(PHONE.tilt)).applyAxisAngle(yAxis, BOT_YAW)
  const up = new Vector3(0, Math.cos(PHONE.tilt), Math.sin(PHONE.tilt)).applyAxisAngle(yAxis, BOT_YAW)
  const right = new Vector3(1, 0, 0).applyAxisAngle(yAxis, BOT_YAW)
  // The Html screen is slightly above the physical face.
  center.addScaledVector(normal, 0.0052)
  return { center, normal, up, right }
}
export function phoneView(width: number, height: number, fov = 38): [number, number, number, number, number, number] {
  if (![width, height, fov].every(Number.isFinite) || width <= 0 || height <= 0 || fov <= 0 || fov >= 170) throw Error('Invalid camera viewport')
  const { center, normal, up } = phoneGeometry()
  const top = Math.min(width <= 900 ? 160 : 120, height * 0.3), bottom = Math.min(90, height * 0.22)
  const availableHeight = Math.max(height * 0.3, height - top - bottom - 24)
  const availableWidth = Math.max(width * 0.5, width - 64)
  const tangent = Math.tan(MathUtils.degToRad(fov) / 2)
  const distance = Math.max((PHONE.h + 0.012) / (2 * tangent * availableHeight / height), (PHONE.w + 0.012) / (2 * tangent * availableWidth / height))
  // Frame inside the unobscured area rather than under the fixed top navigation.
  const target = center.clone().addScaledVector(up, distance * tangent * (top - bottom) / height)
  const position = target.clone().addScaledVector(normal, distance)
  return [...position.toArray(), ...target.toArray()] as [number, number, number, number, number, number]
}
