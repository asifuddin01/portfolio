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

  float saturate(float value) {
    return clamp(value, 0.0, 1.0);
  }

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

  float wrappedAngle(float angle, float target) {
    return atan(sin(angle - target), cos(angle - target));
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

  float dustLayer(vec2 p, float scale, float time) {
    vec2 id = floor(p * scale);
    vec2 cell = fract(p * scale) - 0.5;
    float seed = hash21(id + 13.7);
    vec2 offset = vec2(hash21(id + 37.2), hash21(id + 83.9)) - 0.5;
    float radius = length(cell - offset * 0.64);
    float core = 1.0 - smoothstep(0.015, 0.105, radius);
    float glow = (1.0 - smoothstep(0.04, 0.22, radius)) * 0.24;
    float presence = smoothstep(0.52, 1.0, seed);
    float twinkle = 0.62 + 0.38 * sin(time * (0.84 + seed * 0.62) + seed * 27.0);
    return (core + glow) * presence * twinkle;
  }

  void main() {
    float shortSide = min(u_resolution.x, u_resolution.y);
    vec2 raw = (2.0 * gl_FragCoord.xy - u_resolution.xy) / shortSide;
    raw.y *= -1.0;
    raw -= u_pointer * vec2(0.032, 0.024);

    float time = u_time;
    float precession = sin(time * 0.11) * 0.007;
    vec2 p = rotate2d(0.115 + precession + u_pointer.x * 0.014) * raw;
    p -= vec2(0.012, 0.075);

    float horizon = 0.325;
    float radius = length(p);
    float angle = atan(p.y, p.x);
    float localFade = 1.0 - smoothstep(0.48, 1.18, length(p * vec2(0.74, 0.92)));
    vec2 frameUv = gl_FragCoord.xy / u_resolution.xy;
    float frameEdge = min(min(frameUv.x, 1.0 - frameUv.x), min(frameUv.y, 1.0 - frameUv.y));
    float edgeFade = smoothstep(0.0, 0.13, frameEdge);

    vec3 spaceBlack = mix(u_void, vec3(0.001, 0.003, 0.005), 0.36);
    vec3 gold = mix(u_warm, vec3(0.92, 0.59, 0.24), 0.3);
    vec3 whiteHeat = mix(u_hot, vec3(1.0, 0.95, 0.78), 0.25);
    vec3 ice = mix(u_cool, vec3(0.12, 0.34, 0.39), 0.22);

    /* Empty pixels remain transparent so the page texture continues through the figure. */
    vec3 colour = spaceBlack;
    float alpha = localFade * 0.008;

    /* Sparse stars are gently deflected near the horizon. */
    vec2 lensUv = p * (1.0 + 0.06 / (radius * radius + 0.05));
    float stars = starLayer(lensUv + vec2(time * 0.0035, 0.0), 20.0, 0.968, time);
    stars += starLayer(lensUv * 1.43 - vec2(0.0, time * 0.0022), 39.0, 0.988, time) * 0.58;
    float starExclusion = smoothstep(horizon + 0.055, horizon + 0.2, radius);
    float starSeed = hash21(floor(lensUv * 20.0));
    vec3 starColour = mix(whiteHeat, ice, starSeed * 0.46);
    float starLight = stars * starExclusion * edgeFade;
    colour += starColour * starLight * 1.72;
    alpha += starLight * 0.9;

    /* A narrow vertical dust wake supplies the reference image's long depth. */
    float plumeAxis = p.x + p.y * 0.038;
    float plumeShape = exp(-plumeAxis * plumeAxis * 20.0);
    plumeShape *= smoothstep(0.15, 0.28, abs(p.y)) * (1.0 - smoothstep(0.68, 1.25, abs(p.y)));
    float below = mix(0.42, 1.0, smoothstep(-0.22, 0.72, p.y));
    float dustPoints = dustLayer(vec2(p.x * 1.55, p.y * 0.68 - time * 0.009), 22.0, time * 1.12);
    float dustFine = dustLayer(vec2(p.x * 2.4 - 1.7, p.y * 0.88 - time * 0.004), 37.0, time * 0.86) * 0.48;
    float dust = plumeShape * below * (dustPoints + dustFine) * edgeFade;
    colour += mix(gold, whiteHeat, 0.34) * dust * 2.15;
    alpha += dust * 1.52;
    float plumeHaze = plumeShape * below * localFade * smoothstep(0.36, 0.78, abs(p.y));
    colour += ice * plumeHaze * 0.15;
    alpha += plumeHaze * 0.055;

    /* A thin accretion plane: separated moving filaments, not a solid fire cloud. */
    float tilt = 0.225 + sin(time * 0.1) * 0.003;
    float bow = p.x * p.x * 0.018 - p.x * 0.008;
    vec2 discPoint = vec2(p.x, (p.y - bow) / tilt);
    float discRadius = length(discPoint);
    float discAngle = atan(discPoint.y, discPoint.x);
    float discBand = smoothstep(0.33, 0.41, discRadius) * (1.0 - smoothstep(1.02, 1.38, discRadius));
    float flowNoise = fbm(vec2(discRadius * 6.8 - time * 0.15, discAngle * 1.8 + time * 0.08));
    float threadA = pow(0.5 + 0.5 * sin(discRadius * 116.0 - discAngle * 10.0 - time * 1.55 + flowNoise * 6.0), 7.0);
    float threadB = pow(0.5 + 0.5 * sin(discRadius * 207.0 + discAngle * 16.0 - time * 1.02 + flowNoise * 3.2), 10.0);
    float threadC = pow(0.5 + 0.5 * sin(discRadius * 311.0 - discAngle * 21.0 - time * 0.68), 14.0);
    float filaments = threadA * 0.76 + threadB * 0.32 + threadC * 0.13;
    float innerHeat = 1.0 - smoothstep(0.32, 1.08, discRadius);
    float orbitalSide = discPoint.x / max(discRadius, 0.001);
    float doppler = 0.54 + 0.72 * smoothstep(-0.82, 0.82, orbitalSide);
    float hotTarget = 0.18 + sin(time * 0.22) * 0.055;
    float hotDelta = wrappedAngle(discAngle, hotTarget) / 0.42;
    float hotSpot = exp(-(hotDelta * hotDelta));
    float disc = discBand * (0.045 + filaments) * (0.38 + innerHeat * 0.62) * doppler;
    float outsideHorizon = smoothstep(horizon * 0.96, horizon * 1.12, radius);
    disc *= outsideHorizon;
    vec3 discColour = mix(gold, whiteHeat, pow(innerHeat, 2.5) * (0.24 + hotSpot * 0.42));
    float discMist = discBand * smoothstep(0.34, 0.86, flowNoise) * (0.025 + innerHeat * 0.065) * doppler;
    colour += gold * discMist * 1.65;
    colour += discColour * disc * (1.25 + hotSpot * 0.62);
    alpha += discMist * 0.72 + disc * 1.14;

    /* Thin strands of the far side are folded over the upper edge. */
    float upper = 1.0 - smoothstep(-0.005, 0.135, p.y);
    float lensRadius = length(vec2(p.x, (p.y + 0.008) * 1.06));
    float lensFlow = 0.88 + 0.12 * sin(angle * 12.0 - time * 0.78);
    float arcA = exp(-abs(lensRadius - (horizon + 0.03)) * 125.0);
    float arcB = exp(-abs(lensRadius - (horizon + 0.074)) * 105.0);
    float arcC = exp(-abs(lensRadius - (horizon + 0.126)) * 88.0);
    float lensArc = upper * max(lensFlow, 0.0) * (arcA * 0.84 + arcB * 0.38 + arcC * 0.16);
    float lensMist = upper * smoothstep(horizon - 0.015, horizon + 0.025, lensRadius);
    lensMist *= 1.0 - smoothstep(horizon + 0.08, horizon + 0.2, lensRadius);
    lensMist *= 0.035 + flowNoise * 0.03;
    float lensSideHeat = 0.58 + 0.42 * smoothstep(-0.72, 0.72, p.x / max(lensRadius, 0.001));
    colour += mix(gold, whiteHeat, 0.62) * lensArc * lensSideHeat * 1.28;
    colour += gold * lensMist;
    alpha += lensArc * 0.92;

    /* The central shadow sits above the distant disc. */
    float shadow = 1.0 - smoothstep(horizon - 0.012, horizon + 0.008, radius);
    colour = mix(colour, spaceBlack * 0.018, shadow);
    alpha = max(alpha, shadow * 0.97);

    float photonCore = exp(-abs(radius - (horizon + 0.007)) * 132.0);
    float photonGlow = exp(-abs(radius - (horizon + 0.035)) * 34.0);
    float rimHotDelta = wrappedAngle(angle, 0.38 + sin(time * 0.18) * 0.045) / 0.5;
    float rimHot = exp(-(rimHotDelta * rimHotDelta));
    colour += mix(gold, whiteHeat, 0.58) * photonCore * (0.62 + rimHot * 1.18);
    colour += gold * photonGlow * (0.09 + rimHot * 0.12);
    alpha += photonCore * 0.88 + photonGlow * 0.12;

    /* A restrained near-side pass crosses in front and completes the fold. */
    float nearSide = smoothstep(-0.06, 0.3, discPoint.y);
    float nearDisc = disc * nearSide * (0.18 + hotSpot * 0.2);
    colour += mix(discColour, whiteHeat, hotSpot * 0.52) * nearDisc;
    alpha += nearDisc * 0.72;

    /* A handful of orbiting flecks keeps the direction legible on a phone. */
    float sparkLane = abs(discRadius - (0.46 + 0.1 * sin(discAngle * 2.0 + time * 0.34)));
    float sparks = 1.0 - smoothstep(0.0, 0.014, sparkLane);
    sparks *= smoothstep(0.84, 0.992, sin(discAngle * 27.0 - time * 3.5 + flowNoise * 2.0) * 0.5 + 0.5);
    sparks *= discBand * outsideHorizon * 0.42;
    colour += whiteHeat * sparks;
    alpha += sparks * 0.9;

    colour = vec3(1.0) - exp(-max(colour, vec3(0.0)) * 1.34);
    alpha *= edgeFade;
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
    const isMobile = coarsePointer.matches || rect.width < 560;
    const maxRatio = isMobile ? 1.25 : 1.7;
    const ratio = Math.min(window.devicePixelRatio || 1, maxRatio);
    let width = Math.max(1, Math.round(rect.width * ratio));
    let height = Math.max(1, Math.round(rect.height * ratio));
    const pixelLimit = isMobile ? 425_000 : 875_000;
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
    gl.uniform1f(timeLocation, elapsed % 2048);
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
    if (lastPaint && now - lastPaint < frameInterval - 1) {
      frame = requestAnimationFrame(tick);
      return;
    }
    if (previous) elapsed += Math.min((now - previous) / 1000, 0.05);
    previous = now;
    lastPaint = lastPaint ? now - ((now - lastPaint) % frameInterval) : now;
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
