/**
 * A small, dependency-free WebGL portrait for Numina.
 *
 * The fragment shader builds the disc, photon ring, lensing glow and star
 * field procedurally. It shares the figure motion contract in motion.ts, so
 * it sleeps off-screen and a reader who requests reduced motion can still
 * opt in with the nearby Play button.
 */

export {};

const FIGURE = '[data-black-hole]';

type RGB = readonly [number, number, number];
type Cleanup = () => void;

let cleanups: Cleanup[] = [];

const vertexSource = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fragmentSource = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif

  uniform vec2 u_resolution;
  uniform vec2 u_pointer;
  uniform float u_time;
  uniform vec3 u_void;
  uniform vec3 u_warm;
  uniform vec3 u_hot;
  uniform vec3 u_cool;

  #define PI 3.14159265359

  mat2 rotate2d(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c);
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * valueNoise(p);
      p = rotate2d(0.71) * p * 2.03 + 8.17;
      amplitude *= 0.5;
    }
    return value;
  }

  float starLayer(vec2 p, float scale, float threshold, float time) {
    vec2 id = floor(p * scale);
    vec2 cell = fract(p * scale) - 0.5;
    float seed = hash21(id);
    vec2 offset = vec2(hash21(id + 17.3), hash21(id + 91.7)) - 0.5;
    float radius = length(cell - offset * 0.58);
    float point = (1.0 - smoothstep(0.0, 0.055, radius)) * smoothstep(threshold, 1.0, seed);
    float twinkle = 0.68 + 0.32 * sin(time * (0.7 + seed) + seed * 31.0);
    return point * twinkle;
  }

  void main() {
    float shortSide = min(u_resolution.x, u_resolution.y);
    vec2 p = (2.0 * gl_FragCoord.xy - u_resolution.xy) / shortSide;
    p.y *= -1.0;
    p -= u_pointer * 0.055;

    float time = u_time;
    float breathing = sin(time * 0.18) * 0.012;
    p = rotate2d(-0.145 + breathing + u_pointer.x * 0.025) * p;
    p -= vec2(0.015, -0.01);

    float radius = length(p);
    float angle = atan(p.y, p.x);
    float vignette = 1.0 - smoothstep(0.24, 1.42, length(p * vec2(0.86, 1.0)));

    vec3 colour = u_void * 0.38;
    float alpha = 0.08 + vignette * 0.3;

    /* Distant stars bend and thin out at the centre. */
    vec2 lensUv = p * (1.0 + 0.055 / (radius * radius + 0.045));
    float stars = starLayer(lensUv + vec2(time * 0.0017, 0.0), 20.0, 0.965, time);
    stars += starLayer(lensUv * 1.37 - vec2(0.0, time * 0.001), 35.0, 0.982, time) * 0.62;
    float starExclusion = smoothstep(0.34, 0.54, radius);
    vec3 starColour = mix(u_hot, u_cool, hash21(floor(lensUv * 20.0)) * 0.58);
    colour += starColour * stars * starExclusion * vignette * 1.55;
    alpha += stars * 0.75;

    /* A quiet vertical spray, echoing the source image without becoming a jet. */
    float plumeShape = exp(-abs(p.x) * 8.5) * smoothstep(0.28, 0.55, abs(p.y));
    plumeShape *= 1.0 - smoothstep(0.38, 1.24, abs(p.y));
    float plumeNoise = fbm(vec2(p.x * 18.0 + time * 0.09, p.y * 9.0 - time * 0.06));
    float plume = plumeShape * smoothstep(0.58, 0.92, plumeNoise) * 0.48;
    colour += mix(u_warm, u_cool, 0.32) * plume;
    alpha += plume * 0.7;

    /* The accretion plane: many narrow, independently moving filaments. */
    float tilt = 0.255 + sin(time * 0.11) * 0.008;
    vec2 discPoint = vec2(p.x, p.y / tilt);
    float discRadius = length(discPoint);
    float discAngle = atan(discPoint.y, discPoint.x);
    float discBand = (1.0 - smoothstep(0.42, 1.22, discRadius)) * smoothstep(0.285, 0.39, discRadius);
    float turbulence = fbm(vec2(discRadius * 7.0 - time * 0.13, discAngle * 1.8 + time * 0.08));
    float threads = 0.5 + 0.5 * sin(discRadius * 104.0 - discAngle * 11.0 - time * 2.25 + turbulence * 8.0);
    float fineThreads = 0.5 + 0.5 * sin(discRadius * 211.0 + discAngle * 17.0 + time * 1.35);
    float filament = pow(threads, 5.0) * 0.78 + pow(fineThreads, 9.0) * 0.44;
    float innerHeat = 1.0 - smoothstep(0.34, 1.16, discRadius);
    float doppler = 0.72 + 0.55 * smoothstep(-0.72, 0.58, -discPoint.x / max(discRadius, 0.001));
    float nearSide = 0.62 + 0.38 * smoothstep(-0.7, 0.6, discPoint.y);
    float disc = discBand * (0.075 + filament) * innerHeat * doppler * nearSide;

    float horizon = 0.245;
    float outsideHorizon = smoothstep(horizon * 0.96, horizon * 1.14, radius);
    disc *= outsideHorizon;
    vec3 discColour = mix(u_warm, u_hot, pow(innerHeat, 2.2));
    discColour = mix(discColour, u_cool, smoothstep(0.98, 1.22, discRadius) * 0.22);
    colour += discColour * disc * 1.78;
    alpha += disc * 1.25;

    /* Light from the far side is folded above and below the shadow. */
    float lensRing = exp(-abs(radius - (horizon + 0.018)) * 105.0);
    float photonHalo = exp(-abs(radius - (horizon + 0.062)) * 31.0);
    float polarShade = 0.58 + 0.42 * pow(abs(cos(angle - 0.42)), 1.7);
    float hotSpot = 0.7 + 0.55 * smoothstep(-0.65, 0.75, cos(angle + 0.7));
    colour += mix(u_warm, u_hot, 0.76) * lensRing * polarShade * hotSpot * 1.48;
    colour += mix(u_warm, u_cool, 0.18) * photonHalo * 0.28;
    alpha += lensRing * 0.94 + photonHalo * 0.26;

    float upperArcRadius = length(vec2(p.x, (p.y + 0.018) * 1.14));
    float upperArc = exp(-abs(upperArcRadius - 0.315) * 76.0);
    upperArc *= smoothstep(-0.06, 0.19, -p.y) * (1.0 - smoothstep(-0.05, 0.6, -p.y));
    upperArc *= 0.66 + 0.34 * sin(angle * 13.0 - time * 0.72);
    colour += mix(u_warm, u_hot, 0.62) * max(upperArc, 0.0) * 0.74;
    alpha += max(upperArc, 0.0) * 0.62;

    /* The light cannot escape this circle. A soft rim makes it read as depth. */
    float shadow = 1.0 - smoothstep(horizon - 0.014, horizon + 0.008, radius);
    colour = mix(colour, u_void * 0.045, shadow);
    alpha = max(alpha, shadow * 0.985);
    float innerRim = exp(-abs(radius - horizon) * 63.0) * 0.16;
    colour += u_warm * innerRim;

    /* Sparse orbiting sparks make the rotation legible even at phone size. */
    float sparkOrbit = abs(discRadius - (0.48 + 0.12 * sin(discAngle * 3.0 + time * 0.36)));
    float sparks = 1.0 - smoothstep(0.0, 0.016, sparkOrbit);
    sparks *= smoothstep(0.72, 0.985, sin(discAngle * 29.0 - time * 4.4) * 0.5 + 0.5);
    sparks *= outsideHorizon * discBand;
    colour += u_hot * sparks * 1.3;
    alpha += sparks;

    float edgeFade = 1.0 - smoothstep(0.76, 1.37, length(p * vec2(0.78, 0.95)));
    alpha *= edgeFade;
    colour *= 0.94 + 0.06 * sin(time * 0.24);
    gl_FragColor = vec4(colour, clamp(alpha, 0.0, 1.0));
  }
`;

function parseColour(value: string): RGB {
  const probe = document.createElement('span');
  probe.style.color = value;
  probe.style.position = 'fixed';
  probe.style.visibility = 'hidden';
  document.body.append(probe);
  const match = getComputedStyle(probe).color.match(/[\d.]+/g);
  probe.remove();
  if (!match || match.length < 3) return [0.5, 0.5, 0.5];
  return [Number(match[0]) / 255, Number(match[1]) / 255, Number(match[2]) / 255];
}

function luminance(colour: RGB): number {
  return colour[0] * 0.2126 + colour[1] * 0.7152 + colour[2] * 0.0722;
}

function darkest(a: RGB, b: RGB): RGB {
  return luminance(a) < luminance(b) ? a : b;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function mount(figure: HTMLElement): Cleanup {
  const canvas = figure.querySelector<HTMLCanvasElement>('[data-black-hole-canvas]');
  if (!canvas) return () => undefined;

  let gl: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let frame = 0;
  let elapsed = 4.2;
  let previous = 0;
  let lastPaint = 0;
  let pointerX = 0;
  let pointerY = 0;
  let targetX = 0;
  let targetY = 0;
  let disposed = false;
  let contextLost = false;
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

  let resolutionLocation: WebGLUniformLocation | null = null;
  let pointerLocation: WebGLUniformLocation | null = null;
  let timeLocation: WebGLUniformLocation | null = null;
  let voidLocation: WebGLUniformLocation | null = null;
  let warmLocation: WebGLUniformLocation | null = null;
  let hotLocation: WebGLUniformLocation | null = null;
  let coolLocation: WebGLUniformLocation | null = null;

  const configure = (): boolean => {
    gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      premultipliedAlpha: false,
    });
    if (!gl) return false;

    program = createProgram(gl);
    if (!program) return false;
    gl.useProgram(program);

    const position = gl.getAttribLocation(program, 'a_position');
    buffer = gl.createBuffer();
    if (!buffer || position < 0) return false;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    pointerLocation = gl.getUniformLocation(program, 'u_pointer');
    timeLocation = gl.getUniformLocation(program, 'u_time');
    voidLocation = gl.getUniformLocation(program, 'u_void');
    warmLocation = gl.getUniformLocation(program, 'u_warm');
    hotLocation = gl.getUniformLocation(program, 'u_hot');
    coolLocation = gl.getUniformLocation(program, 'u_cool');

    figure.dataset.renderer = 'webgl';
    return true;
  };

  const resize = (): void => {
    if (!gl) return;
    const rect = canvas.getBoundingClientRect();
    const maxRatio = coarsePointer.matches || rect.width < 560 ? 1.45 : 1.8;
    const ratio = Math.min(window.devicePixelRatio || 1, maxRatio);
    let width = Math.max(1, Math.round(rect.width * ratio));
    let height = Math.max(1, Math.round(rect.height * ratio));
    const pixelLimit = 900_000;
    if (width * height > pixelLimit) {
      const reduction = Math.sqrt(pixelLimit / (width * height));
      width = Math.max(1, Math.round(width * reduction));
      height = Math.max(1, Math.round(height * reduction));
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  };

  const palette = (): void => {
    if (!gl || !program) return;
    const styles = getComputedStyle(document.documentElement);
    const ink = parseColour(styles.getPropertyValue('--ink'));
    const paper = parseColour(styles.getPropertyValue('--paper'));
    const voidColour = darkest(ink, paper);
    const warm = parseColour(styles.getPropertyValue('--brass'));
    const hot = luminance(ink) > luminance(paper) ? ink : paper;
    const cool = parseColour(styles.getPropertyValue('--verdigris'));
    gl.useProgram(program);
    gl.uniform3fv(voidLocation, voidColour);
    gl.uniform3fv(warmLocation, warm);
    gl.uniform3fv(hotLocation, hot);
    gl.uniform3fv(coolLocation, cool);
  };

  const draw = (): void => {
    if (!gl || !program) return;
    gl.useProgram(program);
    gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
    gl.uniform2f(pointerLocation, pointerX, pointerY);
    gl.uniform1f(timeLocation, elapsed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const shouldRun = (): boolean =>
    !disposed &&
    !contextLost &&
    !document.hidden &&
    figure.dataset.motion === 'running' &&
    figure.dataset.motionVisible !== 'false';

  const tick = (now: number): void => {
    frame = 0;
    if (!shouldRun()) {
      previous = 0;
      lastPaint = 0;
      draw();
      return;
    }
    const frameInterval = coarsePointer.matches ? 1000 / 30 : 1000 / 60;
    if (lastPaint && now - lastPaint < frameInterval) {
      frame = requestAnimationFrame(tick);
      return;
    }
    if (previous) elapsed += Math.min((now - previous) / 1000, 0.05);
    previous = now;
    lastPaint = now;
    pointerX += (targetX - pointerX) * 0.045;
    pointerY += (targetY - pointerY) * 0.045;
    draw();
    frame = requestAnimationFrame(tick);
  };

  const sync = (): void => {
    if (shouldRun()) {
      if (!frame) frame = requestAnimationFrame(tick);
    } else {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      lastPaint = 0;
      draw();
    }
  };

  const onPointer = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  };
  const onPointerLeave = (): void => { targetX = 0; targetY = 0; };
  const onVisibility = (): void => sync();
  const onContextLost = (event: Event): void => {
    event.preventDefault();
    contextLost = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    figure.dataset.renderer = 'fallback';
  };
  const onContextRestored = (): void => {
    if (configure()) {
      contextLost = false;
      resize();
      palette();
      draw();
      sync();
    }
  };

  if (!configure()) {
    figure.dataset.renderer = 'fallback';
    return () => { delete figure.dataset.renderer; };
  }

  const stateObserver = new MutationObserver(sync);
  stateObserver.observe(figure, {
    attributes: true,
    attributeFilter: ['data-motion', 'data-motion-visible'],
  });
  const themeObserver = new MutationObserver(() => {
    palette();
    draw();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  const resizeObserver = new ResizeObserver(() => {
    resize();
    draw();
  });
  resizeObserver.observe(canvas);

  if (finePointer.matches) {
    canvas.addEventListener('pointermove', onPointer, { passive: true });
    canvas.addEventListener('pointerleave', onPointerLeave);
  }
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  document.addEventListener('visibilitychange', onVisibility);

  resize();
  palette();
  draw();
  sync();

  return () => {
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    stateObserver.disconnect();
    themeObserver.disconnect();
    resizeObserver.disconnect();
    canvas.removeEventListener('pointermove', onPointer);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
    document.removeEventListener('visibilitychange', onVisibility);
    if (gl && buffer) gl.deleteBuffer(buffer);
    if (gl && program) gl.deleteProgram(program);
    delete figure.dataset.renderer;
  };
}

function teardown(): void {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
}

function boot(): void {
  teardown();
  cleanups = Array.from(document.querySelectorAll<HTMLElement>(FIGURE), mount);
}

document.addEventListener('astro:page-load', boot);
document.addEventListener('astro:before-swap', teardown);
if (document.readyState !== 'loading') boot();
else document.addEventListener('DOMContentLoaded', boot, { once: true });
