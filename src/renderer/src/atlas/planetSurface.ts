import { PLANET_FRAGMENT } from './planetShader'

export const PLANET_FAMILIES = ['Ocean & cloud', 'Banded giant', 'Dune world', 'Fractured ice', 'Volcanic night', 'Veiled world']

/** One bounded context per open system, shared by thumbnails and inspected detail. */
export class PlanetSurface {
  readonly canvas = document.createElement('canvas')
  private gl: WebGLRenderingContext | null
  private program?: WebGLProgram
  private buffer?: WebGLBuffer
  private shaders: WebGLShader[] = []
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  constructor() {
    this.gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true })
    try {
      const gl = this.gl
      if (!gl) return
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type)!
        this.shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Planet shader unavailable')
        return shader
      }
      this.program = gl.createProgram()!
      gl.attachShader(this.program, compile(gl.VERTEX_SHADER, 'attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}'))
      gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, PLANET_FRAGMENT)); gl.linkProgram(this.program)
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error('Planet shader unavailable')
      gl.useProgram(this.program)
      this.buffer = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW)
      const position = gl.getAttribLocation(this.program, 'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
      this.uniforms = Object.fromEntries(['resolution', 'clockTime', 'seed', 'family', 'atmosphere', 'scale'].map(key => [key, gl.getUniformLocation(this.program!, key)]))
    } catch { this.destroy() }
  }
  get animated(): boolean { return !!this.gl && !this.gl.isContextLost() }
  paint(target: HTMLCanvasElement, seed: number, family: number, time = 0, size = 128): void {
    const gl = this.gl
    if (target.width !== size) target.width = target.height = size
    const ctx = target.getContext('2d')!
    ctx.clearRect(0, 0, size, size)
    if (!gl || gl.isContextLost()) { this.fallback(ctx, seed, family, size); return }
    if (this.canvas.width !== size) this.canvas.width = this.canvas.height = size
    gl.viewport(0, 0, size, size); gl.uniform2f(this.uniforms.resolution, size, size)
    gl.uniform1f(this.uniforms.clockTime, time); gl.uniform1f(this.uniforms.seed, seed % 10000)
    gl.uniform1f(this.uniforms.family, family); gl.uniform1f(this.uniforms.atmosphere, .7); gl.uniform1f(this.uniforms.scale, 1)
    gl.drawArrays(gl.TRIANGLES, 0, 6); ctx.drawImage(this.canvas, 0, 0)
  }
  private fallback(ctx: CanvasRenderingContext2D, seed: number, family: number, size: number): void {
    const colors = ['#739899', '#bb9e76', '#b78058', '#acd0d3', '#ac5840', '#9494b4']
    const r = size * .36
    ctx.save(); ctx.translate(size / 2, size / 2)
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = colors[family]; ctx.fillRect(-r, -r, r * 2, r * 2)
    let state = seed >>> 0
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
    for (let i = 0; i < 60; i++) { ctx.fillStyle = i % 2 ? '#ffffff24' : '#18232c30'; ctx.beginPath(); ctx.ellipse((random() - .5) * r * 2, (random() - .5) * r * 2, r * (.04 + random() * .15), r * .04, random(), 0, Math.PI * 2); ctx.fill() }
    const shade = ctx.createLinearGradient(-r, -r, r, r); shade.addColorStop(0, '#fff8df44'); shade.addColorStop(.4, '#00000000'); shade.addColorStop(1, '#000000ed'); ctx.fillStyle = shade; ctx.fillRect(-r, -r, r * 2, r * 2); ctx.restore()
  }
  destroy(): void {
    if (this.gl) { for (const shader of this.shaders) this.gl.deleteShader(shader); if (this.program) this.gl.deleteProgram(this.program); if (this.buffer) this.gl.deleteBuffer(this.buffer); this.gl.getExtension('WEBGL_lose_context')?.loseContext() }
    this.gl = null
  }
}
