export const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const SIM_FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 vUv;

uniform sampler2D uState;
uniform vec2 uTexelSize;
uniform float uDt;
uniform float uAspect;
uniform vec2 uCursor;
uniform vec2 uPrevCursor;
uniform vec2 uCursorVel;
uniform float uCursorSpeed;
uniform float uCursorStrength;
uniform float uRippleSize;
uniform float uTrailFadeTime;
uniform float uZeroPoint;
uniform float uIsByte;

vec2 decodeVel(vec2 rg) {
  return (rg - uZeroPoint) * 2.0;
}

vec2 encodeVel(vec2 v) {
  return clamp(v * 0.5 + uZeroPoint, 0.0, 1.0);
}

void main() {
  vec4 current = texture2D(uState, vUv);
  vec2 vel = decodeVel(current.rg);

  // Semi-Lagrangian self-advection: pushes and stretches the liquid along flow
  vec2 advectOffset = vec2(vel.x / uAspect, vel.y) * uDt * 0.36;
  vec2 backUv = clamp(vUv - advectOffset, uTexelSize, 1.0 - uTexelSize);

  vec4 sC = texture2D(uState, backUv);
  vec2 d = uTexelSize * 1.35;
  vec4 sL = texture2D(uState, clamp(backUv - vec2(d.x, 0.0), uTexelSize, 1.0 - uTexelSize));
  vec4 sR = texture2D(uState, clamp(backUv + vec2(d.x, 0.0), uTexelSize, 1.0 - uTexelSize));
  vec4 sB = texture2D(uState, clamp(backUv - vec2(0.0, d.y), uTexelSize, 1.0 - uTexelSize));
  vec4 sT = texture2D(uState, clamp(backUv + vec2(0.0, d.y), uTexelSize, 1.0 - uTexelSize));

  vec2 vC = decodeVel(sC.rg);
  vec2 vL = decodeVel(sL.rg);
  vec2 vR = decodeVel(sR.rg);
  vec2 vB = decodeVel(sB.rg);
  vec2 vT = decodeVel(sT.rg);

  // Viscous diffusion smooths wakes into thick, organic ripples
  vec2 vAvg = 0.25 * (vL + vR + vB + vT);
  vec2 newVel = mix(vC, vAvg, clamp(uDt * 6.5, 0.0, 0.35));

  // Subtle vorticity/swirl so fast sweeps curl like real fluid
  float curl = clamp((vR.y - vL.y) - (vT.x - vB.x), -1.5, 1.5);
  vec2 swirlForce = vec2(vT.y - vB.y, -(vR.x - vL.x)) * curl * uDt * 0.20;
  newVel += swirlForce;

  // Gentle outward wave expansion from wake pressure gradients
  vec2 hGrad = vec2(sR.b - sL.b, sT.b - sB.b);
  newVel -= hGrad * uDt * 0.30;

  float hAvg = 0.25 * (sL.b + sR.b + sB.b + sT.b);
  float eAvg = 0.25 * (sL.a + sR.a + sB.a + sT.a);
  float newH = mix(sC.b, hAvg, clamp(uDt * 5.2, 0.0, 0.32));
  float newE = mix(sC.a, eAvg, clamp(uDt * 4.6, 0.0, 0.28));

  // Frame-rate-independent smooth decay over uTrailFadeTime seconds
  float fadeTime = max(uTrailFadeTime, 0.25);
  newVel *= pow(0.025, uDt / fadeTime);
  newH *= pow(0.02, uDt / fadeTime);
  newE *= pow(0.015, uDt / (fadeTime * 1.15));

  // Continuous capsule splat between previous and current smoothed cursor
  vec2 aspectVec = vec2(uAspect, 1.0);
  vec2 p = vUv * aspectVec;
  vec2 a = uPrevCursor * aspectVec;
  vec2 b = uCursor * aspectVec;
  vec2 ab = b - a;
  float abLenSq = dot(ab, ab);
  float proj = abLenSq > 1e-7 ? clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0) : 0.0;
  vec2 closest = a + ab * proj;
  vec2 diff = p - closest;
  float dist = length(diff);

  float speedFactor = clamp(uCursorSpeed * 0.7, 0.0, 2.4);
  float radius = uRippleSize * (0.7 + 0.55 * min(speedFactor, 1.5));
  float invR2 = 1.0 / max(radius * radius, 1e-5);
  float splat = exp(-dist * dist * invR2);
  float ringDist = (dist - radius * 0.85) / max(radius * 0.55, 1e-4);
  float ring = exp(-ringDist * ringDist);

  vec2 radialDir = dist > 1e-4 ? diff / dist : vec2(0.0);
  vec2 pushVel = uCursorVel * splat * uCursorStrength * 0.45
               + radialDir * ring * speedFactor * uCursorStrength * 0.16;

  newVel = clamp(newVel + pushVel, vec2(-1.0), vec2(1.0));
  newH = clamp(
    newH + (splat * 0.50 + ring * 0.20) * speedFactor * uCursorStrength,
    0.0,
    1.0
  );
  newE = clamp(
    newE + splat * 0.58 * speedFactor * uCursorStrength,
    0.0,
    1.0
  );

  // Clean zero-settle deadzone when using 8-bit fallback textures
  if (uIsByte > 0.5) {
    if (abs(newVel.x) < 0.009) newVel.x = 0.0;
    if (abs(newVel.y) < 0.009) newVel.y = 0.0;
    if (newH < 0.006) newH = 0.0;
    if (newE < 0.006) newE = 0.0;
  }

  gl_FragColor = vec4(encodeVel(newVel), newH, newE);
}
`;

export const DISPLAY_FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 vUv;

uniform sampler2D uState;
uniform vec2 uTexelSize;
uniform float uTime;
uniform float uAspect;
uniform float uScroll;
uniform float uScrollStrength;
uniform float uZeroPoint;
uniform vec2 uCursor;
uniform float uPointerPresence;
uniform vec3 uColorBase;
uniform vec3 uColorDeep;
uniform vec3 uColorPrimary;
uniform vec3 uColorAccent;
uniform vec3 uColorHighlight;

// Smooth 2D simplex noise
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,
    0.366025403784439,
    -0.577350269189626,
    0.024390243902439
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(
    permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0)
  );
  vec3 m = max(
    0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)),
    0.0
  );
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.55;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  value += amp * snoise(p);
  p = rot * p * 1.95 + vec2(3.1, 1.7);
  amp *= 0.5;
  value += amp * snoise(p);
  return value;
}

vec2 decodeVel(vec2 rg) {
  return (rg - uZeroPoint) * 2.0;
}

void main() {
  // Sample fluid simulation state and spatial gradients for 3D ripple normals
  vec4 state = texture2D(uState, vUv);
  vec2 vel = decodeVel(state.rg);
  float wake = state.b;
  float glow = state.a;

  vec2 d = uTexelSize * 2.0;
  vec4 sL = texture2D(uState, clamp(vUv - vec2(d.x, 0.0), 0.0, 1.0));
  vec4 sR = texture2D(uState, clamp(vUv + vec2(d.x, 0.0), 0.0, 1.0));
  vec4 sB = texture2D(uState, clamp(vUv - vec2(0.0, d.y), 0.0, 1.0));
  vec4 sT = texture2D(uState, clamp(vUv + vec2(0.0, d.y), 0.0, 1.0));

  vec2 wakeGrad = vec2(sR.b - sL.b, sT.b - sB.b);
  vec2 velDiv = vec2(
    decodeVel(sR.rg).x - decodeVel(sL.rg).x,
    decodeVel(sT.rg).y - decodeVel(sB.rg).y
  );

  // Aspect-corrected coordinates with gentle scroll drift and cursor fluid warp
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  p.y -= uScroll * uScrollStrength;

  vec2 warpedP = p - vel * 0.65 - wakeGrad * 0.34;
  float t = uTime;

  // Double domain-warped liquid field for glossy ambient motion
  vec2 q = vec2(
    fbm(warpedP * 1.15 + vec2(t * 0.14, -t * 0.10)),
    fbm(warpedP * 1.15 + vec2(-t * 0.11 + 4.3, t * 0.13 + 1.9))
  );
  vec2 r = vec2(
    fbm(warpedP * 1.35 + 1.95 * q + vec2(1.7 - t * 0.09, 6.2 + t * 0.11)),
    fbm(warpedP * 1.35 + 1.95 * q + vec2(5.4 + t * 0.10, 2.8 - t * 0.08))
  );
  float field = fbm(warpedP * 1.1 + 1.85 * r + vel * 0.75);

  // Reconstruct smooth liquid surface normal (ambient folds + cursor ripples)
  vec2 ambientSlope = (q - r) * 1.35;
  vec2 rippleSlope = wakeGrad * 5.2 + vel * 1.65 + velDiv * 1.0;
  vec3 normal = normalize(vec3(-(ambientSlope + rippleSlope), 1.0));

  // Dual glossy specular highlights + Fresnel sheen
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  vec3 light1 = normalize(vec3(-0.45, 0.65, 1.0));
  vec3 light2 = normalize(vec3(0.55, -0.50, 0.85));
  float spec1 = pow(max(dot(normal, normalize(light1 + viewDir)), 0.0001), 30.0);
  float spec2 = pow(max(dot(normal, normalize(light2 + viewDir)), 0.0001), 18.0);
  float fresnel = pow(max(1.0 - clamp(normal.z, 0.0, 1.0), 0.0001), 2.4);

  // Palette blending: deep navy ocean with violet & cyan liquid currents
  float flowMix = clamp(field * 0.55 + 0.5, 0.0, 1.0);
  float foldMix = clamp(length(q) * 0.72, 0.0, 1.0);
  float ribbonMix = clamp(r.x * 0.5 + 0.5, 0.0, 1.0);

  vec3 col = mix(uColorBase, uColorDeep, smoothstep(0.15, 0.85, flowMix));
  float violetBand = smoothstep(0.26, 0.88, flowMix * 0.72 + foldMix * 0.38);
  col = mix(col, uColorPrimary, violetBand * 0.40);

  float cyanBand = smoothstep(0.46, 0.92, ribbonMix * flowMix + foldMix * 0.2);
  col = mix(col, uColorAccent, cyanBand * 0.26);

  // Luminous violet-to-cyan shift and glossy wet ridges along cursor trails
  float wakeEnergy = clamp(wake * 1.15 + glow * 0.65, 0.0, 1.0);
  vec3 wakeColor = mix(
    uColorPrimary,
    uColorAccent,
    clamp(0.42 + length(vel) * 1.1 + ribbonMix * 0.35, 0.0, 1.0)
  );
  col = mix(col, wakeColor, wakeEnergy * 0.52);

  float rippleGloss = 0.24 + wakeEnergy * 0.95;
  col += uColorHighlight * spec1 * 0.42 * rippleGloss;
  col += uColorPrimary * spec2 * 0.30 * (0.45 + wakeEnergy * 0.75);
  col += mix(uColorPrimary, uColorAccent, 0.62) * fresnel * (0.18 + wakeEnergy * 0.52);

  // Subtle soft glow right around the active cursor
  vec2 curDiff = (vUv - uCursor) * vec2(uAspect, 1.0);
  float curGlow = exp(-dot(curDiff, curDiff) * 15.0) * uPointerPresence;
  col += mix(uColorPrimary, uColorAccent, 0.58) * curGlow * 0.13;

  // Soft tone-mapping + subtle edge vignette for crisp text readability
  col = col / (1.0 + col * 0.35);
  float distCenter = length((vUv - 0.5) * vec2(min(uAspect * 0.75, 1.15), 1.0));
  float vignette = smoothstep(1.35, 0.28, distCenter);
  col *= mix(0.58, 1.0, vignette);

  // Gentle centre readability balance so zinc-400 and white text stay sharp
  float centerBand = exp(-dot((vUv - 0.5) * vec2(1.2, 2.2), (vUv - 0.5) * vec2(1.2, 2.2)));
  col *= mix(1.0, 0.84, centerBand * (1.0 - wakeEnergy * 0.45));

  gl_FragColor = vec4(col, 1.0);
}
`;
