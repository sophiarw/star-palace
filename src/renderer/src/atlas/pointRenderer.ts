import { DetailSprites, DETAIL_CELL, DETAIL_COLUMNS, DETAIL_BYTES } from './detailSprites'
import type { Camera, ScenePoint } from './scene'
import { project, seedFor, objectRadius } from './scene'
import { celestialSheet, spriteIndex, SPRITE_CELL, SPRITE_COLUMNS, SPRITE_ROWS } from './celestialSprites'

export interface PointRenderer { kind: 'WebGL2' | 'Canvas2D'; setPoints(points: ScenePoint[]): void; draw(camera: Camera, width: number, height: number, dpr: number): void; destroy(): void }
function rgb(hex: string): [number, number, number] { return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255] }

export function gpuRenderer(canvas: HTMLCanvasElement, invalidate: () => void = () => {}): PointRenderer | null {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' })
  if (!gl) return null
  const shaders: WebGLShader[] = []
  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source); gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('Shader compilation failed') }
    shaders.push(shader); return shader
  }
  const program = gl.createProgram()!
  try {
    gl.attachShader(program, compile(gl.VERTEX_SHADER, `#version 300 es
      precision highp float;
      layout(location=0) in vec2 corner; layout(location=1) in vec2 position;
      layout(location=2) in float radius; layout(location=3) in vec4 color;
      layout(location=4) in vec4 artwork;
      uniform vec3 camera; uniform vec2 viewport;
      out vec2 uv; out vec4 tint; flat out vec2 cell; flat out float closeup; out float detailMix;
      void main(){ float c=cos(artwork.y),s=sin(artwork.y);
        vec2 rotated=vec2(corner.x*c-corner.y*s,corner.x*s+corner.y*c);
        float scale=artwork.z>.5?clamp(sqrt(camera.z/1.5),.12,8.):1.;
        vec2 screen=(position-camera.xy)*camera.z+viewport*.5+rotated*radius*scale;
        gl_Position=vec4(screen.x/viewport.x*2.-1.,1.-screen.y/viewport.y*2.,0.,1.);
        uv=corner*.5+.5; detailMix=smoothstep(35.,60.,radius*scale); tint=color; closeup=artwork.w; cell=vec2(mod(artwork.x,8.),floor(artwork.x/8.)); }`))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float; in vec2 uv; in vec4 tint; flat in vec2 cell; flat in float closeup; in float detailMix;
      uniform sampler2D sprites; uniform sampler2D details; out vec4 pixel;
      void main(){ vec4 art=texture(sprites,(cell+uv)/vec2(8.,4.)); if(closeup>=0.) art=mix(art,texture(details,(vec2(mod(closeup,4.),floor(closeup/4.))+uv)/4.),detailMix); pixel=art*tint; }`))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader linking failed')
  } catch {
    shaders.forEach(s => gl.deleteShader(s)); gl.deleteProgram(program)
    return null
  }
  shaders.forEach(s => gl.deleteShader(s))
  const vao = gl.createVertexArray()!, corners = gl.createBuffer()!, instances = gl.createBuffer()!, texture = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, celestialSheet())
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.generateMipmap(gl.TEXTURE_2D)
  const details = new DetailSprites(), detailTexture = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, detailTexture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, DETAIL_CELL * DETAIL_COLUMNS, DETAIL_CELL * DETAIL_COLUMNS, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.useProgram(program); gl.uniform1i(gl.getUniformLocation(program, 'details'), 1)
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, corners)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindBuffer(gl.ARRAY_BUFFER, instances)
  for (const [location, size, offset] of [[1, 2, 0], [2, 1, 8], [3, 4, 12], [4, 4, 28]]) {
    gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 44, offset); gl.vertexAttribDivisor(location, 1)
  }
  const cameraLocation = gl.getUniformLocation(program, 'camera'), viewportLocation = gl.getUniformLocation(program, 'viewport')
  let count = 0, points: ScenePoint[] = [], closePoints: ScenePoint[] = [], data = new Float32Array(0)
  return { kind: 'WebGL2', setPoints(next) {
    points = next; closePoints = points.filter(p => p.zoomable); count = points.length
    data = new Float32Array(count * 11)
    points.forEach((p, i) => data.set([p.x, p.y, p.radius, ...(p.objectType ? [1, 1, 1] : rgb(p.color)), p.alpha, spriteIndex(p.objectType, seedFor(p.id)), p.rotation ?? 0, p.zoomable ? 1 : 0, -1], i * 11))
    gl.bindBuffer(gl.ARRAY_BUFFER, instances); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
  }, draw(camera, width, height, dpr) {
    const next = details.prepare(closePoints, camera, width, height)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, detailTexture)
    for (const upload of next.uploads) gl.texSubImage2D(gl.TEXTURE_2D, 0, upload.slot % DETAIL_COLUMNS * DETAIL_CELL, Math.floor(upload.slot / DETAIL_COLUMNS) * DETAIL_CELL, gl.RGBA, gl.UNSIGNED_BYTE, upload.image)
    let changed = false
    if (closePoints.length) points.forEach((p, i) => { const slot = details.slot(p); if (data[i * 11 + 10] !== slot) { data[i * 11 + 10] = slot; changed = true } })
    if (changed) { gl.bindBuffer(gl.ARRAY_BUFFER, instances); gl.bufferSubData(gl.ARRAY_BUFFER, 0, data) }
    canvas.dataset.detailSprites = String(details.count)
    if (next.pending) invalidate()
    gl.viewport(0, 0, Math.round(width * dpr), Math.round(height * dpr)); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(program); gl.bindVertexArray(vao); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform3f(cameraLocation, camera.x, camera.y, camera.zoom); gl.uniform2f(viewportLocation, width, height)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count)
  }, destroy() { gl.deleteTexture(detailTexture); gl.deleteTexture(texture); gl.deleteBuffer(corners); gl.deleteBuffer(instances); gl.deleteVertexArray(vao); gl.deleteProgram(program) } }
}

export function canvasRenderer(canvas: HTMLCanvasElement, invalidate: () => void = () => {}): PointRenderer {
  const ctx = canvas.getContext('2d')!, sheet = celestialSheet(), details = new DetailSprites()
  let points: (ScenePoint & { sprite: number })[] = []
  return { kind: 'Canvas2D', setPoints(next) { points = next.map(p => ({ ...p, sprite: spriteIndex(p.objectType, seedFor(p.id)) })) }, draw(camera, width, height, dpr) {
    const next = details.prepare(points, camera, width, height)
    canvas.dataset.detailSprites = String(details.count)
    if (next.pending) invalidate()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height)
    for (const point of points) {
      const [x, y] = project(point.x, point.y, camera, width, height), r = objectRadius(point, camera.zoom)
      if (x < -r || x > width + r || y < -r || y > height + r) continue
      ctx.globalAlpha = point.alpha
      if (point.objectType) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(point.rotation ?? 0)
        const slot = details.slot(point)
        const t = slot < 0 ? 0 : Math.max(0, Math.min(1, (r - 35) / 25)), mix = t * t * (3 - 2 * t)
        ctx.globalAlpha = point.alpha * (1 - mix)
        ctx.drawImage(sheet, point.sprite % SPRITE_COLUMNS * SPRITE_CELL, Math.floor(point.sprite / SPRITE_COLUMNS) * SPRITE_CELL, SPRITE_CELL, SPRITE_CELL, -r, -r, r * 2, r * 2)
        if (slot >= 0) { ctx.globalAlpha = point.alpha * mix; ctx.drawImage(details.sheet, slot % DETAIL_COLUMNS * DETAIL_CELL, Math.floor(slot / DETAIL_COLUMNS) * DETAIL_CELL, DETAIL_CELL, DETAIL_CELL, -r, -r, r * 2, r * 2) }
        ctx.restore()
      } else {
        ctx.fillStyle = point.color; ctx.beginPath(); ctx.arc(x, y, r * .35, 0, Math.PI * 2); ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }, destroy() { points = [] } }
}

export const SPRITE_BYTES = DETAIL_BYTES * 2 + SPRITE_CELL ** 2 * SPRITE_COLUMNS * SPRITE_ROWS * 4 * (1 + 4 / 3)
