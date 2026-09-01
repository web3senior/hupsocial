/**
 * @file lib/galleryScene.js
 * @description A first-person room for browsing a collection: white walls, an island wall in
 * the middle, 24 hanging slots at eye height, and a doorway at each end that the caller turns
 * into the previous and next page of tokens. Plain three.js with no React — CollectionGallery
 * loads this module with a dynamic import, so three.js never ships to a page that doesn't
 * open the room.
 *
 * The scene owns walking, looking, collision, aiming and the frame loop. The caller owns the
 * data: it hangs pieces into slots, writes the door signs, and answers `onDoor` by either
 * moving the visitor into the next room or bouncing them back.
 */

import * as THREE from 'three'
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js'

export const SLOTS_PER_ROOM = 24

// --- Room dimensions (metres) ---
const ROOM_W = 28
const ROOM_D = 18
const ROOM_H = 5
const HX = ROOM_W / 2
const HZ = ROOM_D / 2
const WALL_T = 0.24
const DOOR_HALF = 1.0
const ALCOVE_DEPTH = 2.4
const EYE = 1.65
const PLAYER_R = 0.36
const FLOOR_W = ROOM_W + (WALL_T + ALCOVE_DEPTH) * 2 + 1
// Past this x the visitor is inside an alcove and has committed to the door
const DOOR_TRIGGER = HX + WALL_T + ALCOVE_DEPTH - 0.85
// A placeholder hangs square until the artwork's own aspect is known
const PLACEHOLDER_SIZE = 1.4
const AIM_RANGE = 7
const LOOK_SPEED = 0.0017
// How quickly the view settles on where the input is pointing it — the softness of a turn
const LOOK_DAMPING = 18
const WALK_SPEED = 2.8
const HURRY_SPEED = 4.8
const WALK_DAMPING = 6
// A frame can't advance the walk further than this — keeps slow devices from tunnelling
// through walls without making them crawl (a wall is 0.24 m thick, the visitor 0.36 m wide)
const MAX_FRAME_DT = 0.1
// The chain's emblem, extruded from its logo and floated above each doorway
const EMBLEM_SIZE = 1.3

// Where the 24 pieces hang, facing into the room: six along each long wall, two on each
// end wall either side of its door, and four on each face of the island
const SLOTS = (() => {
  const slots = []
  const longWallXs = [-10.5, -6.3, -2.1, 2.1, 6.3, 10.5]
  for (const x of longWallXs) slots.push({ x, z: -HZ, rotY: 0 })
  for (const x of longWallXs) slots.push({ x, z: HZ, rotY: Math.PI })
  for (const z of [-5.2, 5.2]) slots.push({ x: -HX, z, rotY: Math.PI / 2 })
  for (const z of [-5.2, 5.2]) slots.push({ x: HX, z, rotY: -Math.PI / 2 })
  for (const x of [-4.5, -1.5, 1.5, 4.5]) slots.push({ x, z: 0.2, rotY: 0 })
  for (const x of [-4.5, -1.5, 1.5, 4.5]) slots.push({ x, z: -0.2, rotY: Math.PI })
  return slots
})()

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text
  let trimmed = text
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) trimmed = trimmed.slice(0, -1)
  return `${trimmed}…`
}

// A title shrinks before it is cut: "The whole collection" should read whole on a sign
function fitFont(ctx, text, maxWidth, weight, size, minSize) {
  let px = size
  ctx.font = `${weight} ${px}px ${FONT}`
  while (px > minSize && ctx.measureText(text).width > maxWidth) {
    px -= 4
    ctx.font = `${weight} ${px}px ${FONT}`
  }
}

function makePlaque({ title, subtitle, price }) {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 256
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#faf8f3'
  ctx.fillRect(0, 0, 512, 256)
  ctx.fillStyle = '#c9a86a'
  ctx.fillRect(0, 0, 8, 256)
  ctx.fillStyle = '#111214'
  ctx.font = `600 40px ${FONT}`
  ctx.fillText(fitText(ctx, title || '', 440), 36, 92)
  ctx.fillStyle = '#6f6a60'
  ctx.font = `500 24px ${FONT}`
  ctx.fillText(fitText(ctx, subtitle || '', 440), 36, 142)
  ctx.fillStyle = price ? '#111214' : '#8a8479'
  ctx.font = `600 30px ${FONT}`
  ctx.fillText(price || 'Not listed', 36, 204)
  return c
}

function makeSign(lines) {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 720
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#16171a'
  ctx.fillRect(0, 0, 512, 720)
  ctx.strokeStyle = 'rgba(201,168,106,0.5)'
  ctx.lineWidth = 3
  ctx.strokeRect(28, 28, 456, 664)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#c9a86a'
  ctx.font = `600 24px ${FONT}`
  ctx.fillText(fitText(ctx, lines[0] || '', 420), 256, 250)
  ctx.fillStyle = '#f3f1ec'
  fitFont(ctx, lines[1] || '', 430, 600, 78, 46)
  ctx.fillText(fitText(ctx, lines[1] || '', 430), 256, 370)
  ctx.fillStyle = '#9aa0aa'
  ctx.font = `400 28px ${FONT}`
  ctx.fillText(fitText(ctx, lines[2] || '', 420), 256, 440)
  ctx.fillStyle = '#c9a86a'
  ctx.font = `500 110px ${FONT}`
  ctx.fillText(lines[3] || '', 256, 590)
  return c
}

function makeFloorTexture() {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 512
  const ctx = c.getContext('2d')
  const rng = mulberry32(42)
  const planks = 8
  const ph = 512 / planks
  for (let i = 0; i < planks; i++) {
    const offset = rng() * 512
    // Segments start two plank-lengths left of the edge so no seed offset leaves a gap
    for (let seg = -2; seg < 3; seg++) {
      const x = seg * 300 + offset
      const l = Math.round(34 + rng() * 10)
      const sat = Math.round(30 + rng() * 10)
      ctx.fillStyle = `hsl(28, ${sat}%, ${l}%)`
      ctx.fillRect(x, i * ph, 300, ph)
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      ctx.fillRect(x, i * ph, 2, ph)
    }
    ctx.fillStyle = 'rgba(0,0,0,0.22)'
    ctx.fillRect(0, i * ph, 512, 2)
    for (let g = 0; g < 26; g++) {
      ctx.fillStyle = `rgba(0,0,0,${0.03 + rng() * 0.05})`
      ctx.fillRect(rng() * 512, i * ph + rng() * ph, 60 + rng() * 200, 1)
    }
  }
  return c
}

function disposeObject(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose()
    if (obj.material) {
      if (obj.material.map) obj.material.map.dispose()
      obj.material.dispose()
    }
  })
}

/**
 * Builds the room on a canvas and starts its frame loop.
 * @param {HTMLCanvasElement} canvas Sized by CSS to its container; the renderer follows it.
 * @param {Object} options
 * @param {HTMLCanvasElement} [options.mapCanvas] Minimap surface, redrawn every other frame.
 * @param {Function} [options.onAim] Called with the aimed slot index, or -1, when it changes.
 * @param {Function} [options.onOpen] Called with a slot index when the visitor activates it.
 * @param {Function} [options.onDoor] Called with 'next' or 'prev' when a doorway is crossed.
 * The caller answers with `enter()` or `bounce()`; the door stays latched until then.
 * @param {boolean} [options.reducedMotion=false] Snaps the view to the input instead of easing.
 * @param {boolean} [options.isTouch=false] Aiming follows taps rather than the crosshair.
 */
export function createGalleryScene(canvas, { mapCanvas, onAim, onOpen, onDoor, reducedMotion = false, isTouch = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.18
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const maxAniso = renderer.capabilities.getMaxAnisotropy()

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#f3f1ec')

  // Near plane as far out as the visitor's collision radius allows: depth precision at the
  // walls comes from it, and nothing ever gets closer than PLAYER_R
  const camera = new THREE.PerspectiveCamera(64, 1, 0.15, 80)
  camera.rotation.order = 'YXZ'

  // --- Lights: a soft ambient wash, warm ceiling points, and one key light for shadows ---
  scene.add(new THREE.HemisphereLight('#fffdf7', '#d3cabe', 1.1))
  for (const x of [-9, 0, 9]) {
    for (const z of [-4.6, 4.6]) {
      const light = new THREE.PointLight('#fff4e2', 11, 0, 2)
      light.position.set(x, ROOM_H - 0.45, z)
      scene.add(light)
    }
  }
  const key = new THREE.DirectionalLight('#fff6e8', 1.1)
  key.position.set(6, 9, 4)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.left = -20
  key.shadow.camera.right = 20
  key.shadow.camera.top = 20
  key.shadow.camera.bottom = -20
  key.shadow.camera.near = 1
  key.shadow.camera.far = 40
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.03
  key.shadow.radius = 4
  scene.add(key)
  scene.add(key.target)

  // --- Materials ---
  const wallMat = new THREE.MeshLambertMaterial({ color: '#f3f1ec' })
  const ceilingMat = new THREE.MeshLambertMaterial({ color: '#ffffff' })
  const trimMat = new THREE.MeshLambertMaterial({ color: '#2b2d31' })
  const benchMat = new THREE.MeshLambertMaterial({ color: '#3a3128' })
  const stripMat = new THREE.MeshBasicMaterial({ color: '#fff8ea' })
  const matBoardMat = new THREE.MeshLambertMaterial({ color: '#f8f6f1' })
  const placeholderMat = new THREE.MeshLambertMaterial({ color: '#e4e0d8' })

  const floorTex = new THREE.CanvasTexture(makeFloorTexture())
  floorTex.colorSpace = THREE.SRGBColorSpace
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping
  floorTex.repeat.set(9, 5)
  floorTex.anisotropy = maxAniso
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.82, metalness: 0 })

  const colliders = []
  // Everything receives the key light's shadow; only furniture casts one, since the outer
  // walls sit between that light and the room and would darken the whole floor
  const addBox = (x1, x2, z1, z2, y1, y2, material, solid = true, casts = false) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x2 - x1, y2 - y1, z2 - z1), material)
    mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2)
    mesh.receiveShadow = true
    mesh.castShadow = casts
    scene.add(mesh)
    if (solid) colliders.push({ x1, x2, z1, z2 })
    return mesh
  }

  // --- Floor & ceiling ---
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_W, ROOM_D), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_W, ROOM_D), ceilingMat)
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.y = ROOM_H
  scene.add(ceiling)

  // --- Walls, doorways and their alcoves ---
  addBox(-HX - WALL_T, HX + WALL_T, -HZ - WALL_T, -HZ, 0, ROOM_H, wallMat)
  addBox(-HX - WALL_T, HX + WALL_T, HZ, HZ + WALL_T, 0, ROOM_H, wallMat)
  for (const side of [1, -1]) {
    const inner = side * HX
    const outer = side * (HX + WALL_T)
    const [x1, x2] = side > 0 ? [inner, outer] : [outer, inner]
    addBox(x1, x2, -HZ - WALL_T, -DOOR_HALF, 0, ROOM_H, wallMat)
    addBox(x1, x2, DOOR_HALF, HZ + WALL_T, 0, ROOM_H, wallMat)
    addBox(x1, x2, -DOOR_HALF, DOOR_HALF, 3.1, ROOM_H, wallMat, false)
    const ax1 = side > 0 ? outer : outer - ALCOVE_DEPTH
    const ax2 = side > 0 ? outer + ALCOVE_DEPTH : outer
    addBox(ax1, ax2, -DOOR_HALF - WALL_T, -DOOR_HALF, 0, ROOM_H, wallMat)
    addBox(ax1, ax2, DOOR_HALF, DOOR_HALF + WALL_T, 0, ROOM_H, wallMat)
    const bx1 = side > 0 ? ax2 : ax1 - WALL_T
    const bx2 = side > 0 ? ax2 + WALL_T : ax1
    addBox(bx1, bx2, -DOOR_HALF - WALL_T, DOOR_HALF + WALL_T, 0, ROOM_H, wallMat)
    // Jambs stand 4 cm proud of the opening and the head 6 cm below the lintel, so no trim
    // face shares a plane with the wall it sits on — coplanar faces shimmer
    addBox(x1 - 0.02, x2 + 0.02, -DOOR_HALF - 0.08, -DOOR_HALF + 0.04, 0, 3.1, trimMat, false)
    addBox(x1 - 0.02, x2 + 0.02, DOOR_HALF - 0.04, DOOR_HALF + 0.08, 0, 3.1, trimMat, false)
    addBox(x1 - 0.02, x2 + 0.02, -DOOR_HALF - 0.08, DOOR_HALF + 0.08, 3.04, 3.18, trimMat, false)
  }
  addBox(-6, 6, -0.2, 0.2, 0, 4.2, wallMat, true, true)
  addBox(-6.03, 6.03, -0.23, 0.23, 4.2, 4.3, trimMat, false)
  addBox(-HX, HX, -HZ, -HZ + 0.03, 0, 0.12, trimMat, false)
  addBox(-HX, HX, HZ - 0.03, HZ, 0, 0.12, trimMat, false)
  addBox(-6.03, 6.03, -0.23, 0.23, 0, 0.12, trimMat, false)
  for (const z of [-4.6, 4.6]) {
    addBox(-11, 11, z - 0.07, z + 0.07, ROOM_H - 0.06, ROOM_H - 0.02, stripMat, false)
  }
  for (const z of [-5.2, 5.2]) {
    addBox(-1.1, 1.1, z - 0.28, z + 0.28, 0.38, 0.46, benchMat, true, true)
    addBox(-0.95, -0.85, z - 0.2, z + 0.2, 0, 0.38, benchMat, false, true)
    addBox(0.85, 0.95, z - 0.2, z + 0.2, 0, 0.38, benchMat, false, true)
  }

  // --- Door signs ---
  const signGeo = new THREE.PlaneGeometry(1.6, 2.25)
  const signEast = new THREE.Mesh(signGeo, new THREE.MeshBasicMaterial({ toneMapped: false }))
  signEast.position.set(HX + WALL_T + ALCOVE_DEPTH - 0.01, 1.7, 0)
  signEast.rotation.y = -Math.PI / 2
  scene.add(signEast)
  const signWest = new THREE.Mesh(signGeo, new THREE.MeshBasicMaterial({ toneMapped: false }))
  signWest.position.set(-HX - WALL_T - ALCOVE_DEPTH + 0.01, 1.7, 0)
  signWest.rotation.y = Math.PI / 2
  scene.add(signWest)

  const paintSign = (mesh, lines) => {
    if (mesh.material.map) mesh.material.map.dispose()
    const tex = new THREE.CanvasTexture(makeSign(lines))
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = maxAniso
    mesh.material.map = tex
    mesh.material.needsUpdate = true
  }

  // --- Chain emblem: the logo's own SVG, extruded and floated above each doorway ---
  let emblems = []
  const disposeEmblems = () => {
    for (const { holder } of emblems) {
      scene.remove(holder)
      disposeObject(holder)
    }
    emblems = []
  }

  const setEmblem = (svgText, { color = '#c9a86a' } = {}) => {
    disposeEmblems()
    if (!svgText) return
    let parsed
    try {
      parsed = new SVGLoader().parse(svgText)
    } catch {
      return
    }

    const art = new THREE.Group()
    parsed.paths.forEach((path, i) => {
      const fill = path.userData?.style?.fill
      if (!fill || fill === 'none') return
      const shapes = SVGLoader.createShapes(path)
      if (!shapes.length) return
      // Later paths sit on earlier ones in the drawing, so each stands a little prouder —
      // a badge's mark reads as relief instead of fighting the badge for the same surface
      const geometry = new THREE.ExtrudeGeometry(shapes, { depth: 3 + i * 0.8, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.35, bevelSegments: 3 })
      const tint = new THREE.Color(fill === 'currentColor' ? color : fill)
      const material = new THREE.MeshStandardMaterial({ color: tint, metalness: 0.3, roughness: 0.42, emissive: tint, emissiveIntensity: 0.12 })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = true
      art.add(mesh)
    })
    if (!art.children.length) return

    // Centre on the drawing's own bounds; SVG units are y-down, so the holder flips y while
    // bringing the longer side to EMBLEM_SIZE metres
    const bounds = new THREE.Box3().setFromObject(art)
    const size = bounds.getSize(new THREE.Vector3())
    const centre = bounds.getCenter(new THREE.Vector3())
    art.position.set(-centre.x, -centre.y, -centre.z)
    const s = EMBLEM_SIZE / Math.max(size.x, size.y, 1)

    for (const side of [1, -1]) {
      const holder = new THREE.Group()
      holder.add(side > 0 ? art : art.clone())
      holder.scale.set(s, -s, s)
      holder.position.set(side * (HX - 0.85), 4.08, 0)
      const base = side > 0 ? -Math.PI / 2 : Math.PI / 2
      holder.rotation.y = base
      scene.add(holder)
      emblems.push({ holder, base })
    }
  }

  // --- Hanging slots ---
  const textureLoader = new THREE.TextureLoader()
  textureLoader.setCrossOrigin('anonymous')
  const slotState = SLOTS.map(() => ({ version: 0, group: null, frameMat: null }))
  let hitMeshes = []

  // A room asks for 24 images at once; a few at a time keeps the proxy (and whichever host
  // sits behind it) from being hit by the whole wall in one burst
  const MAX_LOADS = 4
  const RETRY_DELAY_MS = 2500
  const loadQueue = []
  let loadsInFlight = 0
  const pumpLoads = () => {
    while (loadsInFlight < MAX_LOADS && loadQueue.length > 0) {
      const job = loadQueue.shift()
      if (job.stale()) continue
      loadsInFlight += 1
      const settle = () => {
        loadsInFlight -= 1
        pumpLoads()
      }
      textureLoader.load(
        job.url,
        (texture) => {
          settle()
          job.onLoad(texture)
        },
        undefined,
        () => {
          settle()
          // Hosts behind the proxy drop the odd request under a burst; one more try, later
          if (job.retries > 0 && !job.stale()) {
            setTimeout(() => {
              if (job.stale() || destroyed) return
              loadQueue.push({ ...job, retries: job.retries - 1 })
              pumpLoads()
            }, RETRY_DELAY_MS)
          }
        },
      )
    }
  }
  const queueLoad = (url, stale, onLoad) => {
    loadQueue.push({ url, stale, onLoad, retries: 1 })
    pumpLoads()
  }

  const rebuildHitList = () => {
    hitMeshes = []
    for (const state of slotState) {
      if (state.group) hitMeshes.push(...state.group.children.filter((child) => child.userData.hit))
    }
  }

  const buildPiece = (index, { width, height, texture, title, subtitle, price }) => {
    const slot = SLOTS[index]
    const state = slotState[index]
    if (state.group) {
      scene.remove(state.group)
      disposeObject(state.group)
    }

    const group = new THREE.Group()
    const frameMat = new THREE.MeshLambertMaterial({ color: '#2b2d31' })
    const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.16, height + 0.16, 0.07), frameMat)
    frame.position.z = 0.035
    frame.castShadow = true
    frame.userData.hit = true
    frame.userData.slot = index
    group.add(frame)

    const board = new THREE.Mesh(new THREE.BoxGeometry(width + 0.06, height + 0.06, 0.02), matBoardMat)
    board.position.z = 0.075
    group.add(board)

    const picture = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      texture ? new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }) : placeholderMat,
    )
    picture.position.z = 0.086
    picture.userData.hit = true
    picture.userData.slot = index
    group.add(picture)

    const plaqueTex = new THREE.CanvasTexture(makePlaque({ title, subtitle, price }))
    plaqueTex.colorSpace = THREE.SRGBColorSpace
    plaqueTex.anisotropy = maxAniso
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), new THREE.MeshBasicMaterial({ map: plaqueTex, toneMapped: false }))
    plaque.position.set(width / 2 + 0.36, -height / 2 + 0.18, 0.006)
    group.add(plaque)

    group.position.set(slot.x, EYE - 0.05, slot.z)
    group.rotation.y = slot.rotY
    scene.add(group)

    state.group = group
    state.frameMat = frameMat
    if (hovered === index) frameMat.emissive.set('#3d3218')
    rebuildHitList()
  }

  /**
   * Hangs a piece in a slot, replacing whatever was there. The placeholder goes up at once;
   * the artwork swaps in at its own aspect once it has loaded. A load that fails keeps the
   * placeholder, so a dead image never leaves a hole in the wall.
   */
  const hang = (index, { imageUrl, title, subtitle, price } = {}) => {
    if (index < 0 || index >= SLOTS.length) return
    const state = slotState[index]
    const version = ++state.version
    buildPiece(index, { width: PLACEHOLDER_SIZE, height: PLACEHOLDER_SIZE, texture: null, title, subtitle, price })
    if (!imageUrl) return

    const stale = () => state.version !== version || destroyed
    queueLoad(imageUrl, stale, (texture) => {
      if (stale()) {
        texture.dispose()
        return
      }
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = maxAniso
      const image = texture.image
      const aspect = image && image.width && image.height ? image.width / image.height : 1
      // About 1.5 m on the long side, like a mid-size gallery piece
      const long = 1.5
      const width = aspect >= 1 ? long : long * aspect
      const height = aspect >= 1 ? long / aspect : long
      buildPiece(index, { width, height, texture, title, subtitle, price })
    })
  }

  const clear = () => {
    for (let i = 0; i < slotState.length; i++) {
      const state = slotState[i]
      state.version += 1
      if (state.group) {
        scene.remove(state.group)
        disposeObject(state.group)
        state.group = null
        state.frameMat = null
      }
    }
    hitMeshes = []
    setHovered(-1)
  }

  // --- Visitor ---
  const pos = new THREE.Vector3(-11.5, EYE, 5.4)
  // Input steers the target; the camera eases toward it each frame, which is what makes a
  // turn feel soft rather than bolted to the mouse
  let targetYaw = -Math.PI / 2 + 0.35
  let targetPitch = 0
  let yaw = targetYaw
  let pitch = targetPitch
  const vel = new THREE.Vector3()
  const keys = new Set()
  const joy = { x: 0, y: 0 }
  let paused = true
  let doorLatched = false
  let destroyed = false

  const collides = (px, pz) => {
    for (const b of colliders) {
      if (px + PLAYER_R > b.x1 && px - PLAYER_R < b.x2 && pz + PLAYER_R > b.z1 && pz - PLAYER_R < b.z2) return true
    }
    return false
  }

  const move = (dx, dz) => {
    if (!collides(pos.x + dx, pos.z)) pos.x += dx
    if (!collides(pos.x, pos.z + dz)) pos.z += dz
  }

  const clampPitch = (value) => Math.max(-1.25, Math.min(1.25, value))

  const enter = (side) => {
    pos.x = side === 'west' ? -(HX + WALL_T + 0.9) : HX + WALL_T + 0.9
    pos.z = 0
    targetYaw = side === 'west' ? -Math.PI / 2 : Math.PI / 2
    targetPitch = 0
    yaw = targetYaw
    pitch = targetPitch
    vel.set(0, 0, 0)
    // The visitor arrives inside the alcove; the door they came through stays quiet until
    // they have stepped into the room, so backing up can't bounce them between rooms
    doorLatched = true
    setHovered(-1)
  }

  const bounce = (side) => {
    pos.x = side === 'east' ? DOOR_TRIGGER - 0.6 : -DOOR_TRIGGER + 0.6
    pos.z = 0
    vel.set(0, 0, 0)
    doorLatched = false
  }

  const checkDoors = () => {
    if (doorLatched) {
      if (Math.abs(pos.x) < HX) doorLatched = false
      return
    }
    if (pos.x > DOOR_TRIGGER) {
      doorLatched = true
      if (onDoor) onDoor('next')
      else bounce('east')
    } else if (pos.x < -DOOR_TRIGGER) {
      doorLatched = true
      if (onDoor) onDoor('prev')
      else bounce('west')
    }
  }

  // --- Aiming ---
  const raycaster = new THREE.Raycaster()
  const aim = new THREE.Vector2()
  let hovered = -1

  const pickAt = (nx, ny, maxDist = AIM_RANGE) => {
    aim.set(nx, ny)
    raycaster.setFromCamera(aim, camera)
    raycaster.far = maxDist
    const hits = raycaster.intersectObjects(hitMeshes, false)
    return hits.length ? hits[0].object.userData.slot : -1
  }

  const setHovered = (index) => {
    if (index === hovered) return
    const previous = slotState[hovered]
    if (previous?.frameMat) previous.frameMat.emissive.set('#000000')
    hovered = index
    const next = slotState[hovered]
    if (next?.frameMat) next.frameMat.emissive.set('#3d3218')
    if (onAim) onAim(hovered)
  }

  // --- Input the scene listens to itself: mouse-look under pointer lock, keyboard ---
  const isLocked = () => document.pointerLockElement === canvas

  const handleMouseMove = (event) => {
    if (!isLocked() || paused) return
    targetYaw -= event.movementX * LOOK_SPEED
    targetPitch = clampPitch(targetPitch - event.movementY * LOOK_SPEED)
  }

  const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'])
  const handleKeyDown = (event) => {
    if (paused) return
    if (NAV_KEYS.has(event.code)) event.preventDefault()
    keys.add(event.code)
    if ((event.code === 'Enter' || event.code === 'KeyE') && hovered >= 0 && onOpen) onOpen(hovered)
  }
  const handleKeyUp = (event) => keys.delete(event.code)
  const handleBlur = () => keys.clear()

  document.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  window.addEventListener('blur', handleBlur)

  // --- Minimap ---
  const mctx = mapCanvas ? mapCanvas.getContext('2d') : null
  const drawMap = () => {
    const W = mapCanvas.width
    const H = mapCanvas.height
    const s = W / (FLOOR_W + 2)
    const X = (x) => W / 2 + x * s
    const Z = (z) => H / 2 + z * s
    mctx.clearRect(0, 0, W, H)
    mctx.lineWidth = 2
    mctx.strokeStyle = 'rgba(243,241,236,0.5)'
    mctx.strokeRect(X(-HX), Z(-HZ), ROOM_W * s, ROOM_D * s)
    mctx.fillStyle = 'rgba(243,241,236,0.35)'
    mctx.fillRect(X(-6), Z(-0.2), 12 * s, 0.4 * s)
    for (const side of [1, -1]) {
      const x = side > 0 ? HX + WALL_T : -HX - WALL_T - ALCOVE_DEPTH
      mctx.strokeRect(X(x), Z(-DOOR_HALF - WALL_T), ALCOVE_DEPTH * s, (DOOR_HALF + WALL_T) * 2 * s)
    }
    mctx.fillStyle = '#c9a86a'
    SLOTS.forEach((slot, i) => {
      if (!slotState[i].group || i === hovered) return
      mctx.fillRect(X(slot.x) - 2, Z(slot.z) - 2, 4, 4)
    })
    if (hovered >= 0) {
      mctx.fillStyle = '#ffffff'
      mctx.fillRect(X(SLOTS[hovered].x) - 3, Z(SLOTS[hovered].z) - 3, 6, 6)
    }
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    const px = X(pos.x)
    const pz = Z(pos.z)
    mctx.fillStyle = '#f3f1ec'
    mctx.beginPath()
    mctx.moveTo(px + fx * 9, pz + fz * 9)
    mctx.lineTo(px - fz * 5 - fx * 4, pz + fx * 5 - fz * 4)
    mctx.lineTo(px + fz * 5 - fx * 4, pz - fx * 5 - fz * 4)
    mctx.closePath()
    mctx.fill()
  }

  // --- Sizing ---
  const resize = () => {
    const width = canvas.clientWidth || 1
    const height = canvas.clientHeight || 1
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()

  // --- Frame loop ---
  const timer = new THREE.Timer()
  const forward = new THREE.Vector3()
  const right = new THREE.Vector3()
  const desired = new THREE.Vector3()
  let frame = 0
  let raf = 0

  const tick = () => {
    if (destroyed) return
    raf = requestAnimationFrame(tick)
    timer.update()
    const dt = Math.min(timer.getDelta(), MAX_FRAME_DT)

    if (emblems.length && !reducedMotion) {
      const sway = Math.sin(timer.getElapsed() * 0.7) * 0.3
      for (const { holder, base } of emblems) holder.rotation.y = base + sway
    }

    let ix = joy.x
    let iz = joy.y
    if (!paused) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) iz += 1
      if (keys.has('KeyS') || keys.has('ArrowDown')) iz -= 1
      if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1
      if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1
    }
    const len = Math.hypot(ix, iz)
    if (len > 1) {
      ix /= len
      iz /= len
    }
    const hurry = keys.has('ShiftLeft') || keys.has('ShiftRight')
    const speed = hurry ? HURRY_SPEED : WALK_SPEED

    // Reduced motion asks for the view to follow the hand exactly, not to glide after it
    const ease = reducedMotion ? 1 : 1 - Math.exp(-dt * LOOK_DAMPING)
    yaw += (targetYaw - yaw) * ease
    pitch += (targetPitch - pitch) * ease

    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw))
    right.set(Math.cos(yaw), 0, -Math.sin(yaw))
    desired.copy(forward).multiplyScalar(iz * speed).addScaledVector(right, ix * speed)
    vel.lerp(desired, 1 - Math.exp(-dt * WALK_DAMPING))
    move(vel.x * dt, vel.z * dt)
    checkDoors()

    camera.position.set(pos.x, EYE, pos.z)
    camera.rotation.set(pitch, yaw, 0)

    if (!isTouch && !paused) setHovered(pickAt(0, 0))
    if (mctx && (frame++ & 1) === 0) drawMap()
    renderer.render(scene, camera)
  }
  tick()

  const destroy = () => {
    destroyed = true
    cancelAnimationFrame(raf)
    observer.disconnect()
    document.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('keyup', handleKeyUp)
    window.removeEventListener('blur', handleBlur)
    if (isLocked() && document.exitPointerLock) document.exitPointerLock()
    clear()
    disposeObject(scene)
    renderer.dispose()
    renderer.forceContextLoss()
  }

  return {
    slotCount: SLOTS.length,
    get hovered() {
      return hovered
    },
    hang,
    clear,
    /** @param {{east?: string[], west?: string[]}} signs Four lines each: eyebrow, title, detail, glyph. */
    setSigns: ({ east, west }) => {
      if (east) paintSign(signEast, east)
      if (west) paintSign(signWest, west)
    },
    /** Floats the chain's logo (inline SVG markup) above both doorways; `color` stands in for currentColor. */
    setEmblem,
    enter,
    bounce,
    /** Movement and aiming stop while an overlay is up; the room keeps rendering behind it. */
    setPaused: (value) => {
      paused = Boolean(value)
      if (paused) keys.clear()
    },
    /** Touch joystick vector, each axis in [-1, 1]; y is forward. */
    setJoystick: (x, y) => {
      joy.x = x
      joy.y = y
    },
    /** Turns the view by pixel deltas — touch drag, or mouse drag where pointer lock is refused. */
    look: (dx, dy, speed = 0.0055) => {
      targetYaw -= dx * speed
      targetPitch = clampPitch(targetPitch - dy * speed)
    },
    /** Normalised device coordinates → slot index or -1; used for taps. */
    pickAt,
    select: setHovered,
    resize,
    destroy,
  }
}
