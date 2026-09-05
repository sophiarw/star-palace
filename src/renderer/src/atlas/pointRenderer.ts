import type { Camera, ScenePoint } from './scene'
import { project } from './scene'

export interface PointRenderer { kind: 'WebGL2' | 'Canvas2D'; setPoints(points: ScenePoint[]): void; draw(camera: Camera, width: number, height: number, dpr: number): void; destroy(): void }
function rgb(hex: string): [number, number, number] { return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255] }

export function gpuRenderer(canvas: HTMLCanvasElement): PointRenderer | null {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' })
  if (!gl) return null
  const shaders: WebGLShader[] = []
  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source); gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compilation failed')
    shaders.push(shader); return shader
  }
  const program = gl.createProgram()!
  try {
    gl.attachShader(program, compile(gl.VERTEX_SHADER, `#version 300 es
      precision highp float;
      layout(location=0) in vec2 corner; layout(location=1) in vec2 position;
      layout(location=2) in float radius; layout(location=3) in vec4 color;
      uniform vec3 camera; uniform vec2 viewport;
      out vec2 uv; out vec4 tint;
      void main(){ vec2 screen=(position-camera.xy)*camera.z+viewport*.5+corner*radius;
        gl_Position=vec4(screen.x/viewport.x*2.-1.,1.-screen.y/viewport.y*2.,0.,1.); uv=corner; tint=color; }`))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float; in vec2 uv; in vec4 tint; out vec4 pixel;
      void main(){ float d=length(uv); float core=1.-smoothstep(.15,.55,d);
        float halo=(1.-smoothstep(.1,1.,d))*.15; pixel=vec4(tint.rgb,tint.a*(core+halo)); }`))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader linking failed')
  } catch {
    shaders.forEach(s => gl.deleteShader(s)); gl.deleteProgram(program)
    return null
  }
  shaders.forEach(s => gl.deleteShader(s))
  const vao = gl.createVertexArray()!, corners = gl.createBuffer()!, instances = gl.createBuffer()!
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, corners)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindBuffer(gl.ARRAY_BUFFER, instances)
  for (const [location, size, offset] of [[1, 2, 0], [2, 1, 8], [3, 4, 12]]) {
    gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 28, offset); gl.vertexAttribDivisor(location, 1)
  }
  const cameraLocation = gl.getUniformLocation(program, 'camera'), viewportLocation = gl.getUniformLocation(program, 'viewport')
  let count = 0
  return { kind: 'WebGL2', setPoints(points) {
    count = points.length
    const data = new Float32Array(count * 7)
    points.forEach((p, i) => data.set([p.x, p.y, p.radius, ...rgb(p.color), p.alpha], i * 7))
    gl.bindBuffer(gl.ARRAY_BUFFER, instances); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
  }, draw(camera, width, height, dpr) {
    gl.viewport(0, 0, Math.round(width * dpr), Math.round(height * dpr)); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(program); gl.bindVertexArray(vao); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.uniform3f(cameraLocation, camera.x, camera.y, camera.zoom); gl.uniform2f(viewportLocation, width, height)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count)
  }, destroy() { gl.deleteBuffer(corners); gl.deleteBuffer(instances); gl.deleteVertexArray(vao); gl.deleteProgram(program) } }
}

export function canvasRenderer(canvas: HTMLCanvasElement): PointRenderer {
  const ctx = canvas.getContext('2d')!
  let points: ScenePoint[] = []
  return { kind: 'Canvas2D', setPoints(next) { points = next }, draw(camera, width, height, dpr) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height)
    for (const point of points) {
      const [x, y] = project(point.x, point.y, camera, width, height)
      if (x < -10 || x > width + 10 || y < -10 || y > height + 10) continue
      ctx.fillStyle = point.color; ctx.globalAlpha = point.alpha; ctx.beginPath(); ctx.arc(x, y, point.radius * .5, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
  }, destroy() { points = [] } }
}
