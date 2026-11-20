"use client";

import { useEffect, useRef } from "react";
import styles from "./LiquidBackground.module.css";
import {
  DISPLAY_FRAGMENT_SHADER,
  SIM_FRAGMENT_SHADER,
  VERTEX_SHADER,
} from "./liquidShaders";

// ============================================================================
// Easy-to-tweak configuration
// ============================================================================
export const LIQUID_CONFIG = {
  colors: {
    base: "#040406", // Deep obsidian black
    deep: "#141418", // Smoked graphite liquid body
    primary: "#3F3F46", // Liquid gunmetal currents
    accent: "#A1A1AA", // Molten mercury ridges & cursor shift
    highlight: "#F4F4F5", // Crisp chrome specular sheen
  },
  ambientSpeed: 0.5, // Ambient flow speed multiplier
  opacity: 0.5, // Overall background opacity (0..1)
  cursorStrength: 0.4, // How strongly cursor motion pushes & ripples the liquid
  rippleSize: 0.04, // Radius of the cursor disturbance (relative to viewport height)
  trailFadeTime: 1.65, // Seconds for ripples & trails to fade back to ambient flow
  cursorSmoothing: 14, // Higher = snappier cursor tracking, lower = silkier lag
  scrollStrength: 0.18, // Subtle vertical liquid drift on page scroll
  simResolution: 256, // Internal fluid grid resolution (higher = sharper ripples, more GPU)
  maxDpr: 1.5, // Cap devicePixelRatio for smooth 60fps performance
  respectReducedMotion: true, // When true, shows a static gradient if OS prefers-reduced-motion is enabled
} as const;

type RgbTuple = [number, number, number];

function hexToRgb(hex: string): RgbTuple {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean
        .split("")
        .map((c) => c + c)
        .join("")
      : clean;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return [0, 0, 0];
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[LiquidBackground] Shader compile error:", gl.getShaderInfoLog(shader));
    }
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(
  gl: WebGLRenderingContext,
  vertexSrc: string,
  fragmentSrc: string
): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

interface SimTarget {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

function createSimTarget(
  gl: WebGLRenderingContext,
  width: number,
  height: number,
  internalFormat: number,
  format: number,
  type: number,
  filter: number
): SimTarget | null {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) {
    if (texture) gl.deleteTexture(texture);
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    return null;
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    return null;
  }

  return { framebuffer, texture };
}

export default function LiquidBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const setCanvasVisible = (visible: boolean, reason?: string) => {
      canvas.classList.toggle(styles.canvasReady, visible);
      canvas.dataset.liquidState = visible ? "active" : (reason ?? "inactive");
    };

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    let cleanupActiveGl: (() => void) | null = null;

    const startWebGL = () => {
      if (LIQUID_CONFIG.respectReducedMotion && motionQuery.matches) {
        setCanvasVisible(false, "prefers-reduced-motion");
        return;
      }

      const contextAttrs: WebGLContextAttributes = {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: "high-performance",
        preserveDrawingBuffer: false,
      };

      const gl2 = canvas.getContext("webgl2", contextAttrs);
      const gl: WebGLRenderingContext | null =
        gl2 ??
        canvas.getContext("webgl", contextAttrs) ??
        (canvas.getContext("experimental-webgl", contextAttrs) as WebGLRenderingContext | null);

      if (!gl) {
        setCanvasVisible(false, "no-webgl-context");
        return;
      }

      const simProgram = createProgram(gl, VERTEX_SHADER, SIM_FRAGMENT_SHADER);
      const displayProgram = createProgram(
        gl,
        VERTEX_SHADER,
        DISPLAY_FRAGMENT_SHADER
      );

      if (!simProgram || !displayProgram) {
        if (simProgram) gl.deleteProgram(simProgram);
        if (displayProgram) gl.deleteProgram(displayProgram);
        setCanvasVisible(false, "shader-program-error");
        return;
      }

      // Fullscreen quad vertex buffer
      const quadBuffer = gl.createBuffer();
      if (!quadBuffer) {
        gl.deleteProgram(simProgram);
        gl.deleteProgram(displayProgram);
        setCanvasVisible(false);
        return;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW
      );

      // Select best supported FBO format (prefer half-float, fallback cleanly to RGBA8)
      const simSize = LIQUID_CONFIG.simResolution;
      let useHalfFloat = false;
      let targetA: SimTarget | null = null;
      let targetB: SimTarget | null = null;

      if (gl2) {
        const hasFloatColorBuffer =
          Boolean(gl2.getExtension("EXT_color_buffer_float")) ||
          Boolean(gl2.getExtension("EXT_color_buffer_half_float"));
        if (hasFloatColorBuffer) {
          targetA = createSimTarget(
            gl2,
            simSize,
            simSize,
            gl2.RGBA16F,
            gl2.RGBA,
            gl2.HALF_FLOAT,
            gl2.LINEAR
          );
          targetB = targetA
            ? createSimTarget(
              gl2,
              simSize,
              simSize,
              gl2.RGBA16F,
              gl2.RGBA,
              gl2.HALF_FLOAT,
              gl2.LINEAR
            )
            : null;
          if (targetA && targetB) {
            useHalfFloat = true;
          } else {
            if (targetA) {
              gl.deleteFramebuffer(targetA.framebuffer);
              gl.deleteTexture(targetA.texture);
              targetA = null;
            }
            if (targetB) {
              gl.deleteFramebuffer(targetB.framebuffer);
              gl.deleteTexture(targetB.texture);
              targetB = null;
            }
          }
        }
      } else {
        const halfFloatExt = gl.getExtension("OES_texture_half_float");
        const halfFloatLinear = gl.getExtension("OES_texture_half_float_linear");
        if (halfFloatExt && halfFloatLinear) {
          targetA = createSimTarget(
            gl,
            simSize,
            simSize,
            gl.RGBA,
            gl.RGBA,
            halfFloatExt.HALF_FLOAT_OES,
            gl.LINEAR
          );
          targetB = targetA
            ? createSimTarget(
              gl,
              simSize,
              simSize,
              gl.RGBA,
              gl.RGBA,
              halfFloatExt.HALF_FLOAT_OES,
              gl.LINEAR
            )
            : null;
          if (targetA && targetB) {
            useHalfFloat = true;
          } else {
            if (targetA) {
              gl.deleteFramebuffer(targetA.framebuffer);
              gl.deleteTexture(targetA.texture);
              targetA = null;
            }
            if (targetB) {
              gl.deleteFramebuffer(targetB.framebuffer);
              gl.deleteTexture(targetB.texture);
              targetB = null;
            }
          }
        }
      }

      if (!targetA || !targetB) {
        targetA = createSimTarget(
          gl,
          simSize,
          simSize,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          gl.LINEAR
        );
        targetB = targetA
          ? createSimTarget(
            gl,
            simSize,
            simSize,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            gl.LINEAR
          )
          : null;
      }

      if (!targetA || !targetB) {
        if (targetA) {
          gl.deleteFramebuffer(targetA.framebuffer);
          gl.deleteTexture(targetA.texture);
        }
        if (targetB) {
          gl.deleteFramebuffer(targetB.framebuffer);
          gl.deleteTexture(targetB.texture);
        }
        gl.deleteBuffer(quadBuffer);
        gl.deleteProgram(simProgram);
        gl.deleteProgram(displayProgram);
        setCanvasVisible(false, "fbo-creation-failed");
        return;
      }

      const zeroPoint = useHalfFloat ? 0.5 : 128 / 255;

      // Clear both ping-pong FBOs to resting state (zero velocity, zero wake)
      const clearTarget = (target: SimTarget) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.viewport(0, 0, simSize, simSize);
        gl.clearColor(zeroPoint, zeroPoint, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      };
      clearTarget(targetA);
      clearTarget(targetB);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Uniform & attribute locations
      const simPosLoc = gl.getAttribLocation(simProgram, "aPosition");
      const displayPosLoc = gl.getAttribLocation(displayProgram, "aPosition");

      const simLoc = {
        uState: gl.getUniformLocation(simProgram, "uState"),
        uTexelSize: gl.getUniformLocation(simProgram, "uTexelSize"),
        uDt: gl.getUniformLocation(simProgram, "uDt"),
        uAspect: gl.getUniformLocation(simProgram, "uAspect"),
        uCursor: gl.getUniformLocation(simProgram, "uCursor"),
        uPrevCursor: gl.getUniformLocation(simProgram, "uPrevCursor"),
        uCursorVel: gl.getUniformLocation(simProgram, "uCursorVel"),
        uCursorSpeed: gl.getUniformLocation(simProgram, "uCursorSpeed"),
        uCursorStrength: gl.getUniformLocation(simProgram, "uCursorStrength"),
        uRippleSize: gl.getUniformLocation(simProgram, "uRippleSize"),
        uTrailFadeTime: gl.getUniformLocation(simProgram, "uTrailFadeTime"),
        uZeroPoint: gl.getUniformLocation(simProgram, "uZeroPoint"),
        uIsByte: gl.getUniformLocation(simProgram, "uIsByte"),
      };

      const dispLoc = {
        uState: gl.getUniformLocation(displayProgram, "uState"),
        uTexelSize: gl.getUniformLocation(displayProgram, "uTexelSize"),
        uTime: gl.getUniformLocation(displayProgram, "uTime"),
        uAspect: gl.getUniformLocation(displayProgram, "uAspect"),
        uScroll: gl.getUniformLocation(displayProgram, "uScroll"),
        uScrollStrength: gl.getUniformLocation(displayProgram, "uScrollStrength"),
        uZeroPoint: gl.getUniformLocation(displayProgram, "uZeroPoint"),
        uCursor: gl.getUniformLocation(displayProgram, "uCursor"),
        uPointerPresence: gl.getUniformLocation(displayProgram, "uPointerPresence"),
        uColorBase: gl.getUniformLocation(displayProgram, "uColorBase"),
        uColorDeep: gl.getUniformLocation(displayProgram, "uColorDeep"),
        uColorPrimary: gl.getUniformLocation(displayProgram, "uColorPrimary"),
        uColorAccent: gl.getUniformLocation(displayProgram, "uColorAccent"),
        uColorHighlight: gl.getUniformLocation(displayProgram, "uColorHighlight"),
      };

      const colorBase = hexToRgb(LIQUID_CONFIG.colors.base);
      const colorDeep = hexToRgb(LIQUID_CONFIG.colors.deep);
      const colorPrimary = hexToRgb(LIQUID_CONFIG.colors.primary);
      const colorAccent = hexToRgb(LIQUID_CONFIG.colors.accent);
      const colorHighlight = hexToRgb(LIQUID_CONFIG.colors.highlight);

      // Sizing state
      let width = window.innerWidth;
      let height = window.innerHeight;
      let aspect = Math.max(width / Math.max(height, 1), 0.1);

      const resize = () => {
        width = window.innerWidth;
        height = window.innerHeight;
        aspect = Math.max(width / Math.max(height, 1), 0.1);
        const dpr = Math.min(window.devicePixelRatio || 1, LIQUID_CONFIG.maxDpr);
        const targetW = Math.max(1, Math.floor(width * dpr));
        const targetH = Math.max(1, Math.floor(height * dpr));
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }
      };
      resize();

      // Pointer / touch & scroll state
      let pointerActive = false;
      let pointerPresence = 0;
      let targetX = 0.5;
      let targetY = 0.5;
      let smoothX = 0.5;
      let smoothY = 0.5;
      let prevSmoothX = 0.5;
      let prevSmoothY = 0.5;

      let targetScroll = window.scrollY / Math.max(height, 1);
      let smoothScroll = targetScroll;

      const updatePointer = (clientX: number, clientY: number, isEntry = false) => {
        const nx = clientX / Math.max(width, 1);
        const ny = 1 - clientY / Math.max(height, 1);
        if (!pointerActive || isEntry) {
          targetX = nx;
          targetY = ny;
          smoothX = nx;
          smoothY = ny;
          prevSmoothX = nx;
          prevSmoothY = ny;
          pointerActive = true;
          return;
        }
        targetX = nx;
        targetY = ny;
      };

      const onPointerMove = (e: PointerEvent) => {
        updatePointer(e.clientX, e.clientY, false);
      };

      const onPointerDown = (e: PointerEvent) => {
        updatePointer(e.clientX, e.clientY, e.pointerType !== "mouse" || !pointerActive);
      };

      const onPointerUp = (e: PointerEvent) => {
        if (e.pointerType !== "mouse") {
          pointerActive = false;
        }
      };

      const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length > 0) {
          const t = e.touches[0];
          updatePointer(t.clientX, t.clientY, true);
        }
      };

      const onTouchMove = (e: TouchEvent) => {
        if (e.touches.length > 0) {
          const t = e.touches[0];
          updatePointer(t.clientX, t.clientY, false);
        }
      };

      const onPointerLeave = () => {
        pointerActive = false;
      };

      const onMouseOut = (e: MouseEvent) => {
        if (!e.relatedTarget) {
          pointerActive = false;
        }
      };

      const onScroll = () => {
        targetScroll = window.scrollY / Math.max(height, 1);
      };

      // Animation loop with visibility pausing
      let rafId = 0;
      let isDisposed = false;
      let isContextLost = false;
      let readTarget = targetA;
      let writeTarget = targetB;
      let elapsedTime = 0;
      let lastFrameTime = performance.now();
      let renderedFirstFrame = false;

      const renderFrame = (now: number) => {
        if (isDisposed || isContextLost || document.hidden) return;

        const dt = Math.min(Math.max((now - lastFrameTime) / 1000, 0.001), 0.05);
        lastFrameTime = now;
        elapsedTime += dt * LIQUID_CONFIG.ambientSpeed;

        // Smooth pointer position with exponential lerp
        const ease = 1 - Math.exp(-LIQUID_CONFIG.cursorSmoothing * dt);
        prevSmoothX = smoothX;
        prevSmoothY = smoothY;
        smoothX += (targetX - smoothX) * ease;
        smoothY += (targetY - smoothY) * ease;

        // Smooth pointer glow presence
        const presenceTarget = pointerActive ? 1 : 0;
        pointerPresence += (presenceTarget - pointerPresence) * (1 - Math.exp(-6 * dt));

        // Smooth scroll drift
        smoothScroll += (targetScroll - smoothScroll) * (1 - Math.exp(-8 * dt));

        // Compute velocity in viewport-height units per second (soft-clamped via tanh)
        const dx = (smoothX - prevSmoothX) * aspect;
        const dy = smoothY - prevSmoothY;
        const rawVx = pointerActive ? dx / dt : 0;
        const rawVy = pointerActive ? dy / dt : 0;
        const velX = Math.tanh(rawVx * 0.45);
        const velY = Math.tanh(rawVy * 0.45);
        const speed = Math.hypot(rawVx, rawVy);

        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);

        // Pass 1: Update fluid simulation ping-pong FBO
        gl.useProgram(simProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, writeTarget.framebuffer);
        gl.viewport(0, 0, simSize, simSize);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, readTarget.texture);
        gl.uniform1i(simLoc.uState, 0);
        gl.uniform2f(simLoc.uTexelSize, 1 / simSize, 1 / simSize);
        gl.uniform1f(simLoc.uDt, dt);
        gl.uniform1f(simLoc.uAspect, aspect);
        gl.uniform2f(simLoc.uCursor, smoothX, smoothY);
        gl.uniform2f(simLoc.uPrevCursor, prevSmoothX, prevSmoothY);
        gl.uniform2f(simLoc.uCursorVel, velX, velY);
        gl.uniform1f(simLoc.uCursorSpeed, speed);
        gl.uniform1f(simLoc.uCursorStrength, LIQUID_CONFIG.cursorStrength);
        gl.uniform1f(simLoc.uRippleSize, LIQUID_CONFIG.rippleSize);
        gl.uniform1f(simLoc.uTrailFadeTime, LIQUID_CONFIG.trailFadeTime);
        gl.uniform1f(simLoc.uZeroPoint, zeroPoint);
        gl.uniform1f(simLoc.uIsByte, useHalfFloat ? 0 : 1);

        gl.enableVertexAttribArray(simPosLoc);
        gl.vertexAttribPointer(simPosLoc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Swap ping-pong buffers
        const prevRead = readTarget;
        readTarget = writeTarget;
        writeTarget = prevRead;

        // Pass 2: Render glossy liquid surface to screen canvas
        gl.useProgram(displayProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, readTarget.texture);
        gl.uniform1i(dispLoc.uState, 0);
        gl.uniform2f(dispLoc.uTexelSize, 1 / simSize, 1 / simSize);
        gl.uniform1f(dispLoc.uTime, elapsedTime);
        gl.uniform1f(dispLoc.uAspect, aspect);
        gl.uniform1f(dispLoc.uScroll, smoothScroll);
        gl.uniform1f(dispLoc.uScrollStrength, LIQUID_CONFIG.scrollStrength);
        gl.uniform1f(dispLoc.uZeroPoint, zeroPoint);
        gl.uniform2f(dispLoc.uCursor, smoothX, smoothY);
        gl.uniform1f(dispLoc.uPointerPresence, pointerPresence);
        gl.uniform3fv(dispLoc.uColorBase, colorBase);
        gl.uniform3fv(dispLoc.uColorDeep, colorDeep);
        gl.uniform3fv(dispLoc.uColorPrimary, colorPrimary);
        gl.uniform3fv(dispLoc.uColorAccent, colorAccent);
        gl.uniform3fv(dispLoc.uColorHighlight, colorHighlight);

        gl.enableVertexAttribArray(displayPosLoc);
        gl.vertexAttribPointer(displayPosLoc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        if (!renderedFirstFrame) {
          renderedFirstFrame = true;
          setCanvasVisible(true);
        }

        rafId = window.requestAnimationFrame(renderFrame);
      };

      const startLoop = () => {
        if (isDisposed || isContextLost || document.hidden) return;
        lastFrameTime = performance.now();
        window.cancelAnimationFrame(rafId);
        rafId = window.requestAnimationFrame(renderFrame);
      };

      const onVisibilityChange = () => {
        if (document.hidden) {
          window.cancelAnimationFrame(rafId);
          pointerActive = false;
        } else {
          startLoop();
        }
      };

      const onContextLost = (e: Event) => {
        e.preventDefault();
        isContextLost = true;
        window.cancelAnimationFrame(rafId);
        setCanvasVisible(false);
      };

      const onContextRestored = () => {
        isContextLost = false;
        cleanupGlResources();
        startWebGL();
      };

      const cleanupGlResources = () => {
        isDisposed = true;
        window.cancelAnimationFrame(rafId);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerLeave);
        window.removeEventListener("mouseout", onMouseOut);
        window.removeEventListener("blur", onPointerLeave);
        window.removeEventListener("touchstart", onTouchStart);
        window.removeEventListener("touchmove", onTouchMove);
        window.removeEventListener("touchend", onPointerLeave);
        window.removeEventListener("touchcancel", onPointerLeave);
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", resize);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        canvas.removeEventListener("webglcontextlost", onContextLost);
        canvas.removeEventListener("webglcontextrestored", onContextRestored);

        if (!gl.isContextLost()) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.bindTexture(gl.TEXTURE_2D, null);
          gl.bindBuffer(gl.ARRAY_BUFFER, null);
          gl.deleteFramebuffer(targetA.framebuffer);
          gl.deleteTexture(targetA.texture);
          gl.deleteFramebuffer(targetB.framebuffer);
          gl.deleteTexture(targetB.texture);
          gl.deleteBuffer(quadBuffer);
          gl.deleteProgram(simProgram);
          gl.deleteProgram(displayProgram);
        }
      };

      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("pointerdown", onPointerDown, { passive: true });
      window.addEventListener("pointerup", onPointerUp, { passive: true });
      window.addEventListener("pointercancel", onPointerLeave, { passive: true });
      window.addEventListener("mouseout", onMouseOut, { passive: true });
      window.addEventListener("blur", onPointerLeave, { passive: true });
      window.addEventListener("touchstart", onTouchStart, { passive: true });
      window.addEventListener("touchmove", onTouchMove, { passive: true });
      window.addEventListener("touchend", onPointerLeave, { passive: true });
      window.addEventListener("touchcancel", onPointerLeave, { passive: true });
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", resize, { passive: true });
      document.addEventListener("visibilitychange", onVisibilityChange);
      canvas.addEventListener("webglcontextlost", onContextLost);
      canvas.addEventListener("webglcontextrestored", onContextRestored);

      cleanupActiveGl = cleanupGlResources;
      startLoop();
    };

    const onMotionChange = () => {
      if (cleanupActiveGl) {
        cleanupActiveGl();
        cleanupActiveGl = null;
      }
      if (LIQUID_CONFIG.respectReducedMotion && motionQuery.matches) {
        setCanvasVisible(false, "prefers-reduced-motion");
      } else {
        startWebGL();
      }
    };

    startWebGL();
    motionQuery.addEventListener("change", onMotionChange);

    return () => {
      motionQuery.removeEventListener("change", onMotionChange);
      if (cleanupActiveGl) {
        cleanupActiveGl();
        cleanupActiveGl = null;
      }
    };
  }, []);

  return (
    <div
      className={styles.wrapper}
      style={{ opacity: LIQUID_CONFIG.opacity }}
      aria-hidden="true"
    >
      <div className={styles.fallback} />
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
