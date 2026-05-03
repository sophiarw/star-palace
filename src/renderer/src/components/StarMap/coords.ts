// Pure coordinate transforms between world space (PCA-projected positions in
// the daemon's [-500, 500] range) and screen space (CSS pixels of the canvas
// element, with origin at top-left). Kept in a separate module so they can
// be unit-tested in node without a DOM.

export interface Camera {
  cx: number
  cy: number
  zoom: number
}

export function worldToScreen(wx: number, wy: number, cam: Camera, w: number, h: number): [number, number] {
  return [(wx - cam.cx) * cam.zoom + w / 2, (wy - cam.cy) * cam.zoom + h / 2]
}

export function screenToWorld(sx: number, sy: number, cam: Camera, w: number, h: number): [number, number] {
  return [(sx - w / 2) / cam.zoom + cam.cx, (sy - h / 2) / cam.zoom + cam.cy]
}
