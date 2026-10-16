import * as THREE from 'three'
import { CONFIG } from './config'
import { surfaceAt } from './terrain'

export type CamMode = 'chase' | 'close' | 'far' | 'orbit' | 'eye'
export const CAM_MODES: CamMode[] = ['chase', 'close', 'far', 'orbit', 'eye']

export type CamTarget = {
  pos: THREE.Vector3
  quat: THREE.Quaternion
  yaw: number
  pitch: number
  roll: number
  speed: number
  grounded: boolean
}

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 16 / 9, 0.12, 16000)
  mode: CamMode = 'chase'
  /** Deslocamento horizontal da imagem (fração da largura), para a tela inicial. */
  shift = 0
  reducedMotion = false
  private lookYaw = 0
  private lookPitch = 0
  private idle = 10
  private heading = 0
  private pitchFollow = 0
  private orbitAngle = 0
  private fov = CONFIG.camera.fov
  private readonly desired = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  private readonly smoothedPos = new THREE.Vector3()
  private readonly smoothedLook = new THREE.Vector3()
  private readonly eyeQuat = new THREE.Quaternion()
  private ready = false
  private shakeT = 0
  private lastW = 0
  private lastH = 0

  setMode(mode: CamMode): void {
    this.mode = mode
    if (mode === 'orbit') this.orbitAngle = this.heading
    this.lookYaw = 0
    this.lookPitch = 0
    this.ready = false
  }

  next(): CamMode {
    this.setMode(CAM_MODES[(CAM_MODES.indexOf(this.mode) + 1) % CAM_MODES.length])
    return this.mode
  }

  snap(): void {
    this.ready = false
  }

  update(dt: number, t: CamTarget, look: { x: number; y: number }, width: number, height: number, autoOrbit = false): void {
    // Olhar com o mouse: orbita em torno do pássaro e volta ao centro depois de um tempo.
    if (look.x !== 0 || look.y !== 0) {
      this.idle = 0
      this.lookYaw -= look.x
      this.lookPitch = clamp(this.lookPitch + look.y, -1.1, 1.0)
      if (this.mode === 'orbit' || autoOrbit) this.orbitAngle -= look.x
    } else {
      this.idle += dt
    }
    if (this.idle > 2.2 && this.mode !== 'orbit' && this.mode !== 'eye') {
      const k = 1 - Math.exp(-dt * 1.8)
      this.lookYaw -= this.lookYaw * k
      this.lookPitch -= this.lookPitch * k
    }
    if (this.mode === 'eye') {
      this.lookYaw = clamp(this.lookYaw, -1.9, 1.9)
      this.lookPitch = clamp(this.lookPitch, -0.9, 0.9)
    }
    const rm = this.reducedMotion ? 0.3 : 1
    const speedK = clamp((t.speed - 11) / 26, 0, 1)
    const targetFov = CONFIG.camera.fov + speedK * 12 * rm + (this.mode === 'eye' ? 6 : 0)
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 3))

    if (!this.ready) {
      this.heading = t.yaw
      this.pitchFollow = 0
      this.ready = true
      this.smoothedPos.set(NaN, 0, 0)
    }
    const follow = CONFIG.camera.follow
    this.heading += wrapPi(t.yaw - this.heading) * (1 - Math.exp(-dt * follow * 0.8))
    this.pitchFollow += (clamp(t.pitch, -0.9, 0.9) * 0.45 - this.pitchFollow) * (1 - Math.exp(-dt * follow * 0.5))

    const dist = this.distanceFor()
    if (this.mode === 'eye') {
      this.eyeQuat.copy(t.quat)
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(t.quat)
      this.desired.copy(t.pos).addScaledVector(forward, 0.28).addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(t.quat), 0.1)
      this.camera.position.copy(this.desired)
      const euler = new THREE.Euler(this.lookPitch, this.lookYaw, 0, 'YXZ')
      const lookQ = new THREE.Quaternion().setFromEuler(euler)
      // Rolagem do pássaro suavizada, para o horizonte não girar demais.
      const rollQ = new THREE.Quaternion().copy(t.quat)
      const flat = new THREE.Euler().setFromQuaternion(rollQ, 'YXZ')
      flat.z *= 0.6 * rm + 0.4
      rollQ.setFromEuler(flat)
      this.camera.quaternion.copy(rollQ).multiply(lookQ)
    } else {
      if (this.mode === 'orbit' && this.idle > 1.5) this.orbitAngle += dt * (autoOrbit ? 0.16 : 0.05)
      const h = this.mode === 'orbit' ? this.orbitAngle : this.heading + this.lookYaw
      const pitchAngle = this.mode === 'orbit' ? 0.22 + this.lookPitch * 0.8 : 0.12 + this.pitchFollow * 0.6 + this.lookPitch * 0.9
      const horizontal = dist * Math.cos(pitchAngle)
      // A câmera fica atrás do pássaro: oposta à direção de avanço (-sin h, -cos h).
      this.desired.set(
        t.pos.x + Math.sin(h) * horizontal,
        t.pos.y + CONFIG.camera.height * (dist / CONFIG.camera.distance) * 0.55 + Math.sin(pitchAngle) * dist,
        t.pos.z + Math.cos(h) * horizontal,
      )
      // Evita atravessar o terreno ou a água.
      const floor = surfaceAt(this.desired.x, this.desired.z) + 1.3
      if (this.desired.y < floor) this.desired.y = floor
      if (!Number.isFinite(this.smoothedPos.x)) {
        this.smoothedPos.copy(this.desired)
      } else {
        const lerp = 1 - Math.exp(-dt * (this.mode === 'orbit' ? 5 : follow * 1.4))
        this.smoothedPos.lerp(this.desired, lerp)
      }
      this.camera.position.copy(this.smoothedPos)
      if (this.camera.position.y < surfaceAt(this.camera.position.x, this.camera.position.z) + 1.1) {
        this.camera.position.y = surfaceAt(this.camera.position.x, this.camera.position.z) + 1.1
      }
      const aheadDir = new THREE.Vector3(0, 0, -1).applyQuaternion(t.quat)
      this.look.copy(t.pos).addScaledVector(aheadDir, this.mode === 'orbit' ? 0 : Math.min(8, dist * 1.3))
      this.look.y += 0.4
      this.smoothedLook.lerp(this.look, 1 - Math.exp(-dt * 12))
      if (!this.smoothedLook.lengthSq()) this.smoothedLook.copy(this.look)
      this.camera.lookAt(this.smoothedLook)
      // Rolagem sutil acompanhando a curva do pássaro.
      this.camera.rotateZ(-t.roll * (this.mode === 'orbit' ? 0 : 0.28 * rm))
    }
    // Tremor leve em alta velocidade.
    if (speedK > 0.4 && !this.reducedMotion) {
      this.shakeT += dt * 38
      const a = (speedK - 0.4) * 0.0035
      this.camera.rotateX(Math.sin(this.shakeT) * a)
      this.camera.rotateY(Math.cos(this.shakeT * 1.3) * a)
    }
    this.camera.fov = this.fov
    if (width > 0 && height > 0) {
      this.camera.aspect = width / height
      if (this.shift !== 0) {
        this.camera.setViewOffset(width, height, -this.shift * width, 0, width, height)
      } else if (this.lastW !== width || this.lastH !== height || this.camera.view?.enabled) {
        this.camera.clearViewOffset()
      }
      this.lastW = width
      this.lastH = height
    }
    this.camera.updateProjectionMatrix()
  }

  private distanceFor(): number {
    const base = CONFIG.camera.distance
    switch (this.mode) {
      case 'close': return base * 0.55
      case 'far': return base * 2.3
      case 'orbit': return base * 1.7
      default: return base
    }
  }
}
