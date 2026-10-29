import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { Box3, BufferGeometry, DoubleSide, Float32BufferAttribute, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Quaternion, Raycaster, Spherical, Vector3 } from 'three'
import { PHONE, ROOM_ORBIT, ROOM_VIEW, phoneGeometry, phoneView } from '../src/scene/cameraGeometry'

test('phone projects upright, without perspective skew, inside responsive header/footer margins', () => {
  assert.equal(PHONE.w / PHONE.h, 300 / 640)
  for (const [width, height] of [[320,568],[390,844],[768,1024],[900,764],[901,764],[1440,900],[1920,1080],[844,390]]) {
    const pose = phoneView(width, height), camera = new PerspectiveCamera(38, width/height, 0.02,30)
    camera.position.set(...pose.slice(0,3) as [number,number,number]);camera.lookAt(new Vector3(...pose.slice(3)));camera.updateMatrixWorld()
    const { center, up, right, normal }=phoneGeometry()
    const target=new Vector3(...pose.slice(3))
    assert.ok(camera.position.clone().sub(target).normalize().distanceTo(normal)<1e-10)
    const corners=[[-1,1],[1,1],[-1,-1],[1,-1]].map(([x,y])=>center.clone().addScaledVector(right,x*(PHONE.w+.006)/2).addScaledVector(up,y*(PHONE.h+.006)/2).project(camera))
    assert.ok(Math.abs(corners[0].x-corners[2].x)<1e-9)
    assert.ok(Math.abs(corners[1].x-corners[3].x)<1e-9)
    assert.ok(Math.abs(corners[0].y-corners[1].y)<1e-9)
    assert.ok(Math.abs(corners[2].y-corners[3].y)<1e-9)
    assert.ok(corners[0].x<corners[1].x && corners[0].y>corners[2].y)
    for(const corner of corners){
      const x=(corner.x+1)*width/2,y=(1-corner.y)*height/2
      assert.ok(x>=24 && x<=width-24,`${width}x${height} horizontal fit`)
      assert.ok(y>=Math.min(width<=900?160:120,height*.3) && y<=height-Math.min(90,height*.22),`${width}x${height} vertical fit`)
      assert.ok(corner.z>-1 && corner.z<1)
    }
  }
  assert.throws(()=>phoneView(0,900))
})

function bakedBounds() {
 const bytes=readFileSync(new URL('../public/room.glb',import.meta.url)),length=bytes.readUInt32LE(12)
 const gltf=JSON.parse(bytes.subarray(20,20+length).toString()),bin=bytes.subarray(28+length),bounds=new Map<string,Box3>()
 for(const node of gltf.nodes){
  const box=new Box3(),transform=new Matrix4().compose(new Vector3(...(node.translation??[0,0,0])),new Quaternion(...(node.rotation??[0,0,0,1])),new Vector3(...(node.scale??[1,1,1])))
  for(const primitive of gltf.meshes[node.mesh].primitives){
   const accessor=gltf.accessors[primitive.attributes.POSITION],view=gltf.bufferViews[accessor.bufferView]
   assert.equal(accessor.componentType,5126);assert.equal(accessor.type,'VEC3')
   for(let i=0;i<accessor.count;i++){const offset=(view.byteOffset??0)+(accessor.byteOffset??0)+i*(view.byteStride??12);box.expandByPoint(new Vector3(bin.readFloatLE(offset),bin.readFloatLE(offset+4),bin.readFloatLE(offset+8)).applyMatrix4(transform))}
  }
  bounds.set(node.name,box)
 }
 return bounds
}
test('entire permitted room orbit clears actual baked furniture and both walls without collision raycasts',()=>{
 const bounds=bakedBounds(),target=new Vector3(...ROOM_VIEW.slice(3))
 for(let r=0;r<=12;r++)for(let p=0;p<=18;p++)for(let a=0;a<=24;a++){
  const distance=ROOM_ORBIT.minDistance+(ROOM_ORBIT.maxDistance-ROOM_ORBIT.minDistance)*r/12
  const polar=ROOM_ORBIT.minPolarAngle+(ROOM_ORBIT.maxPolarAngle-ROOM_ORBIT.minPolarAngle)*p/18
  const azimuth=ROOM_ORBIT.minAzimuthAngle+(ROOM_ORBIT.maxAzimuthAngle-ROOM_ORBIT.minAzimuthAngle)*a/24
  const position=new Vector3().setFromSpherical(new Spherical(distance,polar,azimuth)).add(target)
  assert.ok(position.x>-1.65 && position.x<2.9 && position.z>-.85 && position.z<3.3 && position.y>.05 && position.y<2.95)
  for(const name of ['desk','chair','shelf'])assert.ok(!bounds.get(name)!.clone().expandByScalar(.04).containsPoint(position),name+' camera clearance')
 }
})

function bakedChair() {
 const bytes=readFileSync(new URL('../public/room.glb',import.meta.url)),length=bytes.readUInt32LE(12)
 const gltf=JSON.parse(bytes.subarray(20,20+length).toString()),bin=bytes.subarray(28+length)
 const node=gltf.nodes.find((n:{name:string})=>n.name==='chair'),primitive=gltf.meshes[node.mesh].primitives[0]
 const accessor=gltf.accessors[primitive.attributes.POSITION],view=gltf.bufferViews[accessor.bufferView],positions:number[]=[]
 for(let i=0;i<accessor.count;i++){const offset=(view.byteOffset??0)+(accessor.byteOffset??0)+i*(view.byteStride??12);positions.push(bin.readFloatLE(offset),bin.readFloatLE(offset+4),bin.readFloatLE(offset+8))}
 const index=gltf.accessors[primitive.indices],indexView=gltf.bufferViews[index.bufferView],indices:number[]=[]
 assert.ok([5123,5125].includes(index.componentType))
 for(let i=0;i<index.count;i++){const offset=(indexView.byteOffset??0)+(index.byteOffset??0)+i*(index.componentType===5125?4:2);indices.push(index.componentType===5125?bin.readUInt32LE(offset):bin.readUInt16LE(offset))}
 const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setIndex(indices)
 const chair=new Mesh(geometry,new MeshBasicMaterial({side:DoubleSide}))
 chair.position.fromArray(node.translation??[0,0,0]);chair.quaternion.fromArray(node.rotation??[0,0,0,1]);chair.scale.fromArray(node.scale??[1,1,1]);chair.updateMatrixWorld()
 return chair
}
test('room orbit keeps the actual chair out of the sightlines to the bot and held phone',()=>{
 const chair=bakedChair(),target=new Vector3(...ROOM_VIEW.slice(3))
 const subjects=[new Vector3(0,.72,.64),new Vector3(-.16,.86,.64),new Vector3(.16,.86,.64),new Vector3(0,.86,.64),new Vector3(0,1.04,.64),phoneGeometry().center]
 const obstructed=(position:Vector3,subject:Vector3)=>{const direction=subject.clone().sub(position);return new Raycaster(position,direction.clone().normalize(),.02,direction.length()-.02).intersectObject(chair).length>0}
 // Regression: the old low rear-left view put the chair in front of the bot.
 const former=new Vector3().setFromSpherical(new Spherical(2.6,1.35,-.45)).add(target)
 assert.ok(subjects.some(subject=>obstructed(former,subject)))
 for(let r=0;r<=6;r++)for(let p=0;p<=12;p++)for(let a=0;a<=20;a++){
  const distance=ROOM_ORBIT.minDistance+(ROOM_ORBIT.maxDistance-ROOM_ORBIT.minDistance)*r/6
  const polar=ROOM_ORBIT.minPolarAngle+(ROOM_ORBIT.maxPolarAngle-ROOM_ORBIT.minPolarAngle)*p/12
  const azimuth=ROOM_ORBIT.minAzimuthAngle+(ROOM_ORBIT.maxAzimuthAngle-ROOM_ORBIT.minAzimuthAngle)*a/20
  const position=new Vector3().setFromSpherical(new Spherical(distance,polar,azimuth)).add(target)
  for(const subject of subjects)assert.ok(!obstructed(position,subject),`chair obstruction at ${distance},${polar},${azimuth}`)
 }
 const initial=new Spherical().setFromVector3(new Vector3(...ROOM_VIEW.slice(0,3)).sub(target))
 assert.ok(initial.phi>=ROOM_ORBIT.minPolarAngle&&initial.phi<=ROOM_ORBIT.maxPolarAngle)
 assert.ok(initial.theta>=ROOM_ORBIT.minAzimuthAngle&&initial.theta<=ROOM_ORBIT.maxAzimuthAngle)
 chair.geometry.dispose();chair.material.dispose()
})
