// Rainy window on the GPU, drawn straight to its own canvas at close to the display's resolution. The canvas
// version in backdrop.ts stays as the fallback where WebGL2 is missing.

export const RAIN_LIGHTS = 30;

const VS = `#version 300 es
in vec2 a; void main() { gl_Position = vec4(a, 0., 1.); }`;

const HEAD = `#version 300 es
precision highp float;
uniform vec2 uSize;      // scene W, H (CSS px)
uniform float uScale;    // canvas px per scene px
uniform float uT;        // time
uniform vec3 uBase, uS0, uS1;
uniform vec4 uL[${RAIN_LIGHTS}]; // light x, y, radius, strength
uniform vec3 uC[${RAIN_LIGHTS}];
out vec4 o;

vec3 h3(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yzz) * q.zyx);
}

`;

// pass 1, at half size: the street out of focus. A low glow in the album's colours, and lights as the discs a
// lens makes of them, each with a smear below it where the wet road throws it back. Mipmapped afterwards, so pass 2
// can look at it sharp (through a drop) or far blurrier (through fogged glass).
const STREET_FS = HEAD + `
void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize.y * uScale - gl_FragCoord.y) / uScale;
  float y = p.y / uSize.y;
  vec3 c = .3 * (y < .2 ? vec3(0) : y < .6 ? uS1 * ((y - .2) / .4) : mix(uS1, uS0, (y - .6) / .4));
  for (int i = 0; i < ${RAIN_LIGHTS}; i++) {
    vec2 d = (p - uL[i].xy) / uL[i].z;
    float dist = length(d);
    float halo = dist < .4 ? mix(1., .4, dist / .4) : .4 * max(0., (1. - dist) / .6);
    float disc = (1. - smoothstep(.5, .58, dist)) * (.55 + .45 * smoothstep(.2, .55, dist));
    float road = d.y > 0. ? .3 * exp(-d.x * d.x * 9.) * exp(-d.y * .55) : 0.;
    c += uC[i] * uL[i].w * (.6 * halo + .5 * disc + road);
  }
  o = vec4(c, 1);
}`;

// pass 2: the pane. Water on it is a height field (beads that sit, drops that run and the beaded tracks they
// leave); its slope bends the view, so every drop shows a small, flipped, sharper picture of the street, and the
// glass between them is fogged except where a drop has just run.
const FS = HEAD + `
uniform sampler2D uTex;
uniform float uDim, uVig;

// one layer of running drops. The pane is cut into tall cells that creep down as a whole, and in each a drop rides
// up and down its cell at almost the same speed: on the glass it hangs, lets go, runs and catches again.
// x: height of the water, y: how freshly this spot was wiped by a drop passing (its track)
vec2 runners(vec2 uv, float t, vec2 cells, float seed) {
  float lane = floor(uv.x * cells.x);
  float ls = h3(vec2(lane, seed)).x;
  float v = .07 + .06 * ls;
  vec2 q = vec2(uv.x, uv.y - t * v + ls * 3.) * cells;
  vec2 id = floor(q);
  vec3 r = h3(id + seed * 17.);
  if (r.z < .42) return vec2(0.);
  q = fract(q) - .5;
  const float A = .36;
  float ph = t * .94 * v * cells.y / A + r.y * 6.2832;
  float ride = A * sin(ph);
  float x = (r.x - .5) * .5 + .07 * sin(uv.y * 26. + r.y * 40.) + .03 * sin(uv.y * 71. + r.x * 9.); // the path, fixed to the glass
  vec2 d = vec2(q.x - x, q.y - ride) / cells;
  float R = .0075 + .0075 * r.z * r.z;
  float fast = .5 + .5 * cos(ph);                                 // 1 while it runs, 0 while it hangs
  float drop = 1. - smoothstep(R * .25, R, length(d * vec2(1., d.y < 0. ? 1. / (1.15 + .9 * fast) : 1.)));
  float up = -d.y, reach = (q.y + .5) / cells.y;                   // above the drop; and how far the cell's top is
  float len = min(.22 + .2 * r.x, reach + up);
  float along = clamp(up / len, 0., 1.);
  float w = R * .7 * (1. - along * .6);
  float track = (1. - smoothstep(w * .5, w, abs(d.x))) * step(0., up) * (1. - along) * smoothstep(0., .08, reach);
  // beads left behind, at fixed spots on the glass, shrinking away
  float row = floor(uv.y * 110.), by = (fract(uv.y * 110.) - .5) / 110.;
  vec3 hb = h3(vec2(row, lane + seed));
  float rb = R * (.16 + .3 * hb.x) * (1. - along) * step(hb.y, .7) * step(R * 1.6, up) * step(along, .999);
  float bead = rb > 0. ? 1. - smoothstep(rb * .3, rb, length(vec2(d.x + (hb.z - .5) * R * .6, by))) : 0.;
  return vec2(max(drop, bead * .8), track);
}

// beads that sit: each cell may hold one, which swells in, stays a good while and fades for another elsewhere
float beads(vec2 uv, float t, float cells, float seed, float keep) {
  vec2 q = uv * cells, id = floor(q);
  vec3 h = h3(id + seed);
  float ph = t * .03 * (.5 + h.z) + h.x, life = fract(ph);
  vec3 k = h3(id * 1.37 + floor(ph) * 7.13 + seed);
  if (k.z > keep) return 0.;
  float r = .1 + .3 * pow(fract(k.z * 97.3), 2.2);
  vec2 d = fract(q) - .5 - (k.xy - .5) * (.9 - 2. * r);
  d.x *= 1. + .25 * (k.x - .5);                                    // none quite round
  return (1. - smoothstep(r * .2, r, length(d))) * min(1., life * 14.) * min(1., (1. - life) * 8.) * (.45 + 1.4 * r);
}

vec2 water(vec2 uv) {
  vec2 a = runners(uv, uT, vec2(7., 1.4), 1.), b = runners(uv * 1.9 + vec2(.37, 0.), uT * 1.3, vec2(7., 1.4), 5.);
  float still = max(beads(uv, uT, 13., 1.3, .4), max(beads(uv, uT, 30., 7.7, .3), .5 * beads(uv, uT, 70., 3.1, .22)));
  float wiped = max(a.y, b.y);
  return vec2(max(max(a.x, b.x), still * (1. - wiped)), wiped);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize.y * uScale - gl_FragCoord.y) / uScale;
  vec2 uv = p / uSize.y;
  float e = 1.5 / (uSize.y * uScale);
  vec2 w = water(uv);
  vec2 n = (vec2(water(uv + vec2(e, 0.)).x, water(uv + vec2(0., e)).x) - w.x) / e; // the surface's slope
  float wet = smoothstep(.03, .22, w.x);
  float fog = (1. - wet) * (1. - .8 * w.y);

  // through water: flipped and wide, as a bead of water shows it; through the pane: straight, and blurred by the fog
  vec2 at = (p + n * .0032 * uSize.y * wet) / uSize;
  vec3 st = textureLod(uTex, vec2(at.x, 1. - at.y), mix(.8, 4.6, fog)).rgb;
  vec3 col = min(uBase + st * mix(1.5, 1., fog), vec3(1));
  col = mix(col, vec3(.045, .06, .095), .26 * fog);                // the fogged pane, night-cool
  // a drop's edge bends light away (dark, most on top) and gathers it low inside; a pinpoint of the room up top
  float rim = wet * (1. - smoothstep(.2, .6, w.x));
  float top = clamp(.5 + n.y * .012, 0., 1.);
  col *= 1. - .45 * rim * top;
  col += (.06 + .5 * st) * rim * (1. - top) * .4;
  vec3 nn = normalize(vec3(-n * .018, 1.));
  col += .55 * wet * pow(max(0., dot(nn, normalize(vec3(-.42, -.52, .74)))), 70.);

  col *= 1. - uDim;
  col *= 1. - uVig * min(1., length((p - vec2(.3, .4) * uSize) / (1.4142 * vec2(.7, .6) * uSize)));
  o = vec4(col, 1);
}`;

const NAMES = ["uSize", "uScale", "uT", "uBase", "uS0", "uS1", "uL", "uC", "uTex", "uDim", "uVig"];
type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
type GL = { gl: WebGL2RenderingContext; street: Prog; glass: Prog; tex: WebGLTexture; fb: WebGLFramebuffer; tw: number; th: number };
let state: GL | null | undefined; // undefined: not tried yet; null: no WebGL2 here
const DOWN = 2; // the street pass runs at half size: its sharpest view is the small one inside a drop

function init(canvas: HTMLCanvasElement): GL | null {
  // drawn straight to the page: no copy into a second canvas, and one buffer instead of two
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false });
  if (!gl) return null;
  const prog = (fs: string): Prog | null => {
    const p = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, "a");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return console.warn("rainglass shader", gl.getProgramInfoLog(p)), null;
    return { p, u: Object.fromEntries(NAMES.map((n) => [n, gl.getUniformLocation(p, n)])) };
  };
  const street = prog(STREET_FS), glass = prog(FS);
  if (!street || !glass) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one big triangle
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const fb = gl.createFramebuffer()!;
  return { gl, street, glass, tex, fb, tw: 0, th: 0 };
}

/** Gives the WebGL context back once the rainy window is off screen: its buffers here, and the D3D device the GPU
 *  process keeps for every live context. A lost context can't be restarted on its canvas: the next rainGL call
 *  must come with a new one. */
export function rainFree() {
  if (state) {
    state.gl.getExtension("WEBGL_lose_context")?.loseContext();
    state.gl.canvas.width = state.gl.canvas.height = 1;
  }
  state = undefined;
}

/** Draws the rainy window on its own canvas, at the canvas's size, with the dimming and vignette every scene gets;
 *  false when WebGL2 isn't available (use the 2D version). */
export function rainGL(canvas: HTMLCanvasElement, W: number, H: number, t: number, base: number[], s0: number[], s1: number[], lights: Float32Array, cols: Float32Array, dim: number, vignette: number): boolean {
  if (state && state.gl.canvas !== canvas) rainFree();
  if (state === undefined) state = init(canvas);
  if (!state) return false;
  const { gl, street, glass, tex, fb } = state;
  if (gl.isContextLost()) return false;
  const cw = canvas.width, ch = canvas.height;
  const tw = Math.ceil(cw / DOWN), th = Math.ceil(ch / DOWN);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (state.tw !== tw || state.th !== th) {
    state.tw = tw;
    state.th = th;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  }
  const set = ({ u }: Prog, scale: number) => {
    gl.uniform2f(u.uSize, W, H);
    gl.uniform1f(u.uScale, scale);
    gl.uniform1f(u.uT, t);
    gl.uniform3fv(u.uBase, base);
    gl.uniform3fv(u.uS0, s0);
    gl.uniform3fv(u.uS1, s1);
  };
  gl.useProgram(street.p);
  set(street, th / H);
  gl.uniform4fv(street.u.uL, lights);
  gl.uniform3fv(street.u.uC, cols);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.viewport(0, 0, tw, th);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.useProgram(glass.p);
  set(glass, ch / H);
  gl.uniform1i(glass.u.uTex, 0);
  gl.uniform1f(glass.u.uDim, dim);
  gl.uniform1f(glass.u.uVig, vignette);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, cw, ch);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return true;
}
