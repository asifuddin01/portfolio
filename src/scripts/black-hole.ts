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
    float point = (1.0 - smoothstep(0.0, 0.066, radius)) * smoothstep(threshold, 1.0, seed);
    float twinkle = 0.68 + 0.32 * sin(time * (0.7 + seed) + seed * 31.0);
    return point * twinkle;
  }

  void main() {
    float shortSide = min(u_resolution.x, u_resolution.y);
    vec2 raw = (2.0 * gl_FragCoord.xy - u_resolution.xy) / shortSide;
    raw.y *= -1.0;
    raw -= u_pointer * vec2(0.052, 0.036);

    float time = u_time;
    float precession = sin(time * 0.115) * 0.028;
    vec2 p = rotate2d(-0.165 + precession + u_pointer.x * 0.022) * raw;
    p -= vec2(0.018, -0.008);

    float horizon = 0.415;
    float radius = length(p);
    float angle = atan(p.y, p.x);
    float vignette = 1.0 - smoothstep(0.2, 1.48, length(p * vec2(0.78, 0.94)));
    float radialFade = 1.0 - smoothstep(0.79, 1.48, length(raw * vec2(0.73, 0.91)));
    vec2 frameUv = gl_FragCoord.xy / u_resolution.xy;
    float frameEdge = min(min(frameUv.x, 1.0 - frameUv.x), min(frameUv.y, 1.0 - frameUv.y));
    float edgeFade = radialFade * smoothstep(0.0, 0.115, frameEdge);

    vec3 spaceBlack = mix(u_void * 0.12, vec3(0.001, 0.004, 0.008), 0.76);
    vec3 ember = mix(u_warm, vec3(1.0, 0.12, 0.008), 0.64);
    vec3 gold = mix(u_warm, vec3(1.0, 0.52, 0.09), 0.62);
    vec3 whiteHeat = mix(u_hot, vec3(1.0, 0.94, 0.72), 0.52);
    vec3 ice = mix(u_cool, vec3(0.16, 0.48, 0.58), 0.44);

    vec3 colour = spaceBlack * (0.88 + 0.12 * vignette);
    float alpha = 0.62 + vignette * 0.36;

    /* A deep, slowly moving sky with light gravitational distortion. */
    vec2 lensUv = p * (1.0 + 0.1 / (radius * radius + 0.065));
    float nebulaNoise = fbm(lensUv * 2.05 + vec2(2.7, -time * 0.012));
    float nebula = smoothstep(0.47, 0.86, nebulaNoise) * vignette;
    nebula *= 0.42 + 0.58 * smoothstep(-0.82, 0.72, lensUv.y - lensUv.x * 0.18);
    colour += mix(ice, ember, saturate(nebulaNoise - 0.42)) * nebula * 0.12;

    float stars = starLayer(lensUv + vec2(time * 0.0016, 0.0), 19.0, 0.915, time);
    stars += starLayer(lensUv * 1.53 - vec2(0.0, time * 0.0011), 37.0, 0.962, time) * 0.72;
    stars += starLayer(lensUv * 2.31 + vec2(time * 0.0007), 61.0, 0.989, time) * 0.42;
    float starExclusion = smoothstep(horizon + 0.035, horizon + 0.22, radius);
    float starSeed = hash21(floor(lensUv * 19.0));
    vec3 starColour = mix(whiteHeat, ice, starSeed * 0.52);
    colour += starColour * stars * starExclusion * vignette * 2.25;
    alpha += stars * 0.78;

    /* A dust fountain gives the surrounding darkness depth and slow drift. */
    float fountain = exp(-abs(p.x + p.y * 0.045) * 7.2);
    fountain *= smoothstep(0.36, 0.58, abs(p.y)) * (1.0 - smoothstep(0.52, 1.32, abs(p.y)));
    float dustPoints = starLayer(vec2(p.x * 1.8, p.y * 0.72 - time * 0.006), 31.0, 0.93, time * 1.3);
    float dust = fountain * dustPoints * 0.88;
    colour += mix(gold, ice, 0.22) * dust;
    alpha += dust * 0.72;

    /* The oblique accretion plane supplies a broad body and fine moving fibres. */
    float tilt = 0.205 + sin(time * 0.1) * 0.008;
    float bow = p.x * p.x * 0.024 - p.x * 0.012;
    vec2 discPoint = vec2(p.x, (p.y - bow + 0.012) / tilt);
    float discRadius = length(discPoint);
    float discAngle = atan(discPoint.y, discPoint.x);
    float discBand = smoothstep(0.31, 0.48, discRadius) * (1.0 - smoothstep(1.14, 1.72, discRadius));
    float flowNoise = fbm(vec2(discRadius * 5.8 - time * 0.21, discAngle * 1.72 + time * 0.14));
    float coarseThread = 0.5 + 0.5 * sin(discRadius * 79.0 - discAngle * 10.0 - time * 2.0 + flowNoise * 9.0);
    float fineThread = 0.5 + 0.5 * sin(discRadius * 174.0 + discAngle * 15.0 - time * 2.75 + flowNoise * 4.5);
    float filament = pow(coarseThread, 4.0) * 0.18 + pow(fineThread, 10.0) * 0.1;
    float innerHeat = 1.0 - smoothstep(0.36, 1.28, discRadius);
    float orbitalSide = discPoint.x / max(discRadius, 0.001);
    float doppler = 0.38 + 1.28 * smoothstep(-0.78, 0.78, orbitalSide);
    float plasmaBody = discBand * (0.36 + flowNoise * 0.86 + filament) * (0.5 + innerHeat * 0.86) * doppler;

    vec3 discColour = mix(ember, gold, saturate(innerHeat * 0.92));
    discColour = mix(discColour, whiteHeat, pow(innerHeat, 3.1) * saturate(filament * 1.55));

    /* The distant half of the disc is seen first, behind the event horizon. */
    float farSide = 1.0 - smoothstep(-0.52, 0.22, discPoint.y);
    float farDisc = plasmaBody * (0.06 + farSide * 0.94);
    colour += discColour * farDisc * 1.18;
    alpha += farDisc * 0.72;

    /* Gravitational lensing folds the far side into a thick crown above the shadow. */
    vec2 crownPoint = vec2(p.x * 0.99, p.y - 0.018);
    float crownRadius = length(crownPoint);
    float crownAngle = atan(crownPoint.y, crownPoint.x);
    float crownUpper = 1.0 - smoothstep(-0.21, -0.025, p.y);
    float crownFlow = valueNoise(vec2(crownRadius * 13.0 - time * 0.44, crownAngle * 3.2 + time * 0.16));
    float crownWarpedRadius = crownRadius + (crownFlow - 0.5) * 0.045 + sin(crownAngle * 3.0 - time * 0.28) * 0.012;
    float crownInner = smoothstep(horizon - 0.06, horizon + 0.025, crownWarpedRadius);
    float crownOuter = 1.0 - smoothstep(horizon + 0.29, horizon + 0.48, crownWarpedRadius);
    float crownEnvelope = crownInner * crownOuter;
    float crownThreads = 0.5 + 0.5 * sin(crownWarpedRadius * 176.0 - crownAngle * 13.0 - time * 2.25 + crownFlow * 6.0);
    crownThreads = pow(crownThreads, 8.0);
    float crownFine = 0.5 + 0.5 * sin(crownWarpedRadius * 287.0 + crownAngle * 18.0 + time * 1.6 + crownFlow * 3.5);
    crownFine = pow(crownFine, 12.0);
    float crownHotAngle = wrappedAngle(crownAngle, -0.18) / 0.78;
    float crownHot = exp(-(crownHotAngle * crownHotAngle));
    float crownHeat = 1.0 - smoothstep(horizon + 0.025, horizon + 0.36, crownWarpedRadius);
    float crown = crownEnvelope * crownUpper * (0.52 + crownFlow * 0.56 + crownThreads * 0.2 + crownFine * 0.09);
    crown *= 0.52 + crownHeat * 0.88;
    vec3 crownColour = mix(ember, gold, saturate(crownHeat * 0.84 + crownFlow * 0.28));
    crownColour = mix(crownColour, whiteHeat, crownHeat * crownHeat * saturate(crownThreads + crownFine * 0.44) * 0.31);
    colour += crownColour * crown * (1.08 + crownHot * 0.62);
    colour += ember * crownEnvelope * crownUpper * 0.38;
    alpha += crown * 0.86;

    /* Empty space wins at the centre. A tiny warm falloff gives the sphere volume. */
    float shadow = 1.0 - smoothstep(horizon - 0.012, horizon + 0.009, radius);
    float shadowFalloff = 1.0 - smoothstep(0.0, horizon, radius);
    vec3 eventHorizon = spaceBlack * (0.018 + shadowFalloff * 0.025);
    colour = mix(colour, eventHorizon, shadow);
    alpha = max(alpha, shadow * 0.995);

    float hotTarget = 0.56 + sin(time * 0.42) * 0.16;
    float hotAngleDelta = wrappedAngle(angle, hotTarget) / 0.42;
    float hotAngle = exp(-(hotAngleDelta * hotAngleDelta));
    float photonCore = exp(-abs(radius - (horizon + 0.008)) * 118.0);
    float photonGlow = exp(-abs(radius - (horizon + 0.042)) * 25.0);
    colour += whiteHeat * photonCore * (0.25 + hotAngle * 1.72);
    colour += mix(gold, ember, 0.28) * photonGlow * (0.16 + hotAngle * 0.72);
    alpha += photonCore * 0.94 + photonGlow * 0.21;

    /* The near side sweeps over the lower shadow, completing the three-dimensional fold. */
    float nearSide = smoothstep(-0.24, 0.32, discPoint.y);
    float sweepHotAngle = wrappedAngle(discAngle, 0.17) / 0.72;
    float sweepHot = exp(-(sweepHotAngle * sweepHotAngle));
    float frontGuard = smoothstep(horizon * 0.48, horizon * 0.98, radius);
    float nearDisc = plasmaBody * nearSide * frontGuard * (0.055 + sweepHot * 0.095);
    vec3 nearColour = mix(discColour, whiteHeat, sweepHot * pow(innerHeat, 1.7) * 0.76);
    colour += nearColour * nearDisc * 1.18;

    float frontCurve = 0.11 - p.x * 0.08 - p.x * p.x * 0.042;
    float ribbonDistance = abs(p.y - frontCurve);
    float ribbonEnvelope = 1.0 - smoothstep(0.048, 0.19, ribbonDistance);
    ribbonEnvelope *= 1.0 - smoothstep(0.78, 1.42, abs(p.x));
    float ribbonGuard = smoothstep(horizon * 0.52, horizon * 1.02, radius);
    float ribbonThread = 0.5 + 0.5 * sin(ribbonDistance * 168.0 + p.x * 13.0 - time * 3.35 + flowNoise * 8.0);
    ribbonThread = pow(ribbonThread, 8.0);
    float ribbonBody = ribbonEnvelope * ribbonGuard * (0.58 + flowNoise * 0.62 + ribbonThread * 0.16);
    float flareCentre = 0.34 + sin(time * 0.62) * 0.14;
    float flareX = (p.x - flareCentre) / 0.38;
    float flareY = (p.y - frontCurve) / 0.15;
    float ribbonFlare = exp(-(flareX * flareX + flareY * flareY));
    vec3 ribbonColour = mix(ember, gold, saturate(0.25 + innerHeat * 0.72 + ribbonFlare * 0.46));
    ribbonColour = mix(ribbonColour, whiteHeat, ribbonFlare * (0.58 + ribbonThread * 0.34));
    colour += ribbonColour * ribbonBody * (1.15 + ribbonFlare * 1.28);
    colour += gold * ribbonEnvelope * ribbonGuard * exp(-(flareX * flareX * 0.38 + flareY * flareY * 0.5)) * 0.34;
    alpha += ribbonBody * 0.76;
    alpha += nearDisc * 0.86;

    /* Fast flecks make the orbital direction unmistakable on a phone. */
    float sparkLane = abs(discRadius - (0.48 + 0.13 * sin(discAngle * 2.0 + time * 0.44)));
    float sparks = 1.0 - smoothstep(0.0, 0.021, sparkLane);
    sparks *= smoothstep(0.74, 0.985, sin(discAngle * 32.0 - time * 5.2 + flowNoise * 3.0) * 0.5 + 0.5);
    sparks *= discBand * frontGuard * (0.36 + nearSide * 0.64);
    colour += whiteHeat * sparks * (1.35 + hotAngle * 0.7);
    alpha += sparks;

    /* Filmic compression preserves the white-hot rim without flattening the amber gas. */
    colour *= 0.94 + 0.06 * sin(time * 0.23);
    colour = vec3(1.0) - exp(-max(colour, vec3(0.0)) * 1.28);
    colour = pow(colour, vec3(0.92));
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
