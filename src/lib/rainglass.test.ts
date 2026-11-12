import { expect, test } from "bun:test";

function mock() {
  let contexts = 0, draws = 0, lost = false, links = true, webgl = true;
  const canvas = () => {
    const gl = {
      VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, LINK_STATUS: 3, ARRAY_BUFFER: 4, STATIC_DRAW: 5,
      FLOAT: 6, TEXTURE_2D: 7, TEXTURE_MIN_FILTER: 8, TEXTURE_MAG_FILTER: 9, LINEAR: 10,
      TEXTURE_WRAP_S: 11, TEXTURE_WRAP_T: 12, CLAMP_TO_EDGE: 13, RGBA8: 14, RGBA: 15,
      UNSIGNED_BYTE: 16, FRAMEBUFFER: 17, COLOR_ATTACHMENT0: 18, TRIANGLES: 19, LINEAR_MIPMAP_LINEAR: 20,
      canvas: null as unknown,
      createProgram: () => ({}), createShader: () => ({}), shaderSource: () => {}, compileShader: () => {},
      attachShader: () => {}, bindAttribLocation: () => {}, linkProgram: () => {},
      getProgramParameter: () => links, getProgramInfoLog: () => "test link failure", getUniformLocation: () => ({}),
      bindBuffer: () => {}, createBuffer: () => ({}), bufferData: () => {}, enableVertexAttribArray: () => {},
      vertexAttribPointer: () => {}, createTexture: () => ({}), bindTexture: () => {}, texParameteri: () => {},
      createFramebuffer: () => ({}), isContextLost: () => lost, texImage2D: () => {}, bindFramebuffer: () => {},
      framebufferTexture2D: () => {}, uniform2f: () => {}, uniform1f: () => {}, uniform3fv: () => {},
      uniform4fv: () => {}, uniform1i: () => {}, useProgram: () => {}, viewport: () => {}, drawArrays: () => draws++,
      generateMipmap: () => {}, getExtension: () => null,
    };
    const el = { width: 1280, height: 720, getContext: (kind: string) => (kind === "webgl2" && webgl ? (contexts++, (gl.canvas = el), gl) : null) };
    return el as unknown as HTMLCanvasElement;
  };
  return { canvas, counts: () => ({ contexts, draws }), lose: (v: boolean) => (lost = v), link: (v: boolean) => (links = v), noWebgl: () => (webgl = false) };
}

const fresh = async () => (await import(`./rainglass.ts?test=${crypto.randomUUID()}`)) as typeof import("./rainglass");
const colors = [0.1, 0.2, 0.3];
const lights = new Float32Array(120), lightColors = new Float32Array(90);
const draw = (rainGL: typeof import("./rainglass").rainGL, c: HTMLCanvasElement) => rainGL(c, 1280, 720, 1, colors, colors, colors, lights, lightColors, 0.3, 0.35);

test("rain renderer falls back when WebGL2 is unavailable", async () => {
  const { rainGL } = await fresh(), m = mock();
  m.noWebgl();
  expect(draw(rainGL, m.canvas())).toBe(false);
});

test("rain renderer reuses its context and draws two shader passes", async () => {
  const { rainGL } = await fresh(), m = mock(), c = m.canvas();
  expect(draw(rainGL, c)).toBe(true);
  expect(draw(rainGL, c)).toBe(true);
  expect(m.counts()).toEqual({ contexts: 1, draws: 4 });
});

test("rain renderer falls back when a shader fails to link", async () => {
  const { rainGL } = await fresh(), m = mock(), c = m.canvas();
  m.link(false);
  expect(draw(rainGL, c)).toBe(false);
  expect(draw(rainGL, c)).toBe(false);
  expect(m.counts()).toEqual({ contexts: 1, draws: 0 });
});

test("rain renderer reports a lost context and starts over on a new canvas", async () => {
  const { rainGL } = await fresh(), m = mock(), c = m.canvas();
  expect(draw(rainGL, c)).toBe(true);
  m.lose(true);
  expect(draw(rainGL, c)).toBe(false);
  m.lose(false);
  expect(draw(rainGL, m.canvas())).toBe(true);
  expect(m.counts()).toEqual({ contexts: 2, draws: 4 });
});
