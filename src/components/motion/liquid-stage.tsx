"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";

import { canHover, gsap, prefersReducedMotion, useGSAP } from "./gsap";

/**
 * Жидкая сцена: переливающийся фон из референса monopo - шалфей, янтарь и
 * бычья кровь, перетекающие друг в друга, как дым.
 *
 * Процедурный шейдер: масса медленно тянется за курсором и догоняет его за
 * пару секунд, а наведение на раздел её разогревает и ускоряет. Настоящее
 * течение на видеокарте (стабильные жидкости, тонкая плёнка, заливка букв)
 * пробовали - и убрали: оно читалось как размазанная краска, а не дым, и
 * стоило кадров на встроенной графике.
 *
 * Без видеокарты (программный рендер) полотно сразу мельче, при «меньше
 * движения» рисуется один неподвижный кадр, без WebGL вовсе - CSS-градиент
 * тех же трёх цветов.
 *
 * Цвет полотна под жидкостью - цвет сцены из CSS (`--stage-bg`): почти
 * чёрный в тёмной теме, серый в светлой. При смене темы полотно встаёт в
 * новый цвет сразу, в том же кадре, что и вуали вокруг: плавность даёт общее
 * растворение страницы (theme-store.ts). Свой твин цвета здесь был, пока
 * вуали перетекали CSS-переходом, - и расходился с ними по кривой.
 *
 * GSAP здесь - не таймер, а дирижёр: вход, «нагрев» и темп - твины одного
 * объекта, а кадр рисуется по `gsap.ticker`, поэтому сцена и интерфейс идут в
 * одном такте и вместе засыпают во фоновой вкладке.
 */

export type LiquidStageHandle = {
  /** Навели на строку указателя: жидкость тянется к ней и разогревается. */
  focus: (row: HTMLElement) => void;
  /** Ушли со строки: жидкость остывает. */
  release: () => void;
};

type Props = {
  className?: string;
  /** Насколько сцена проявлена в покое, 0..1. */
  intensity?: number;
  /** Задержка проявления, секунды: сначала сцена, потом интерфейс. */
  delay?: number;
};

type Engine = { focus: (row: HTMLElement) => void; release: () => void };

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/*
 * Жидкость - это не дым, а масса с кромкой. Поле h - «высота» жидкости:
 * там, где оно выше порога, начинается масса, и кромка у неё резкая. Блик
 * считается по нормали из разностей поля - отсюда глянец, как у стекла или
 * масла. Цвет идёт по полю h как по плёнке: шалфей → янтарь → бычья кровь и
 * обратно, - отсюда перелив.
 *
 * Нормаль - из двух лишних выборок последнего слоя, а не из dFdx/dFdy:
 * производные считаются на квадрат 2×2 пикселя, а полотно и так в половину
 * экрана, и блик выходил квадратами 4×4. Разности гладкие в каждом пикселе и
 * не требуют расширения.
 */
const FRAG_BODY = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uPointer;
uniform float uIntensity;
uniform float uHeat;
uniform vec3 uBase;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.46;
  }
  return v;
}

vec3 film(float x) {
  vec3 sage = vec3(0.627, 0.878, 0.671);
  vec3 amber = vec3(1.0, 0.675, 0.180);
  vec3 blood = vec3(0.647, 0.176, 0.145);
  float k = abs(fract(x) * 2.0 - 1.0);
  vec3 c = mix(sage, amber, smoothstep(0.28, 0.66, k));
  return mix(c, blood, smoothstep(0.66, 1.0, k));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
  vec2 ptr = vec2((uPointer.x - 0.5) * aspect, uPointer.y - 0.5);

  float t = uTime * 0.045;
  float pull = exp(-length(p - ptr) * 3.2);

  vec2 s = p * 1.05;
  vec2 q = vec2(fbm(s + vec2(0.0, t)), fbm(s + vec2(5.2, 1.3) - t));
  vec2 r = vec2(
    fbm(s + 2.4 * q + vec2(1.7, 9.2) + 0.6 * t),
    fbm(s + 2.4 * q + vec2(8.3, 2.8) - 0.4 * t)
  );
  float f = fbm(s + 2.2 * r);

  // Масса прижата вправо и вниз: слева и сверху стоит текст. Курсор и
  // «нагрев» от наведения на раздел подтягивают её к себе.
  float side = p.x / (0.5 * aspect);
  float h = f + 0.32 * side - 0.16 * p.y + 0.30 * pull + 0.07 * uHeat - 0.03;
  float mass = smoothstep(0.50, 0.60, h);

  float e = 2.0 / uRes.y;
  float fx = fbm(s + vec2(e, 0.0) + 2.2 * r);
  float fy = fbm(s + vec2(0.0, e) + 2.2 * r);
  vec3 n = normalize(vec3(-(fx - f) / e * 0.55, -(fy - f) / e * 0.55, 1.0));
  vec3 L = normalize(vec3(-0.45, 0.65, 0.62));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 20.0);

  vec3 col = film(h * 1.25 + r.x * 0.35 + t * 0.6);
  vec3 lit = col * (0.45 + 0.7 * diff) + spec * (0.55 + 0.45 * uHeat) * vec3(1.0, 0.97, 0.88);
  // Глубина: у кромки масса светлее, в толще темнеет - как у жидкости.
  lit *= mix(1.0, 0.62, smoothstep(0.62, 0.95, h));

  vec3 outc = mix(uBase, lit, mass * uIntensity);
  // Отсвет вокруг массы: без него кромка висит на чёрном, как вырезанная.
  outc += col * 0.07 * smoothstep(0.30, 0.54, h) * (1.0 - mass) * uIntensity;
  outc += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.03;
  gl_FragColor = vec4(outc, 1.0);
}
`;

/** Во сколько раз полотно меньше экрана. Жидкость размыта по природе. */
const SCALE = 0.5;
const MAX_WIDTH = 1280;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
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

type Shared = {
  intensity: number;
  heat: number;
  px: number;
  py: number;
  speed: number;
  time: number;
  /** Цвет полотна, 0..1 по каналам. */
  br: number;
  bg: number;
  bb: number;
};

/** Тёмная сцена - на случай, если CSS цвета не отдал. */
const DARK: [number, number, number] = [0.055, 0.063, 0.059];

/** `#rgb` / `#rrggbb` / `rgb(r, g, b)` → доли 0..1. Иное - null. */
export function parseColor(value: string): [number, number, number] | null {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(text);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  return null;
}

/** Цвет сцены из CSS; не отдал - тёмная сцена. */
function stageColor(el: Element): [number, number, number] {
  return parseColor(getComputedStyle(el).getPropertyValue("--stage-bg")) ?? DARK;
}

type EngineOptions = {
  canvas: HTMLCanvasElement;
  s: Shared;
  intensity: number;
  delay: number;
};

export const LiquidStage = forwardRef<LiquidStageHandle, Props>(function LiquidStage(
  { className, intensity = 0.9, delay = 0 },
  handle,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  // Всё, что меняется во времени, - поля одного объекта: GSAP твинит их, кадр читает.
  const state = useRef<Shared>({
    intensity: 0,
    heat: 0,
    px: 0.72,
    py: 0.38,
    speed: 1,
    time: 0,
    br: DARK[0],
    bg: DARK[1],
    bb: DARK[2],
  });
  const engine = useRef<Engine | null>(null);

  useImperativeHandle(handle, () => ({
    focus: (row) => engine.current?.focus(row),
    release: () => engine.current?.release(),
  }));

  useGSAP(
    () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const attributes: WebGLContextAttributes = { antialias: false, alpha: false, preserveDrawingBuffer: false };
      const gl: WebGLRenderingContext | WebGL2RenderingContext | null =
        canvas.getContext("webgl2", attributes) ?? canvas.getContext("webgl", attributes);
      if (!gl) {
        setFailed(true);
        return;
      }

      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
      const software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);

      const run = runNoise(gl, software, { canvas, s: state.current, intensity, delay });
      if (!run) {
        setFailed(true);
        return;
      }
      engine.current = run.engine;
      return () => {
        engine.current = null;
        run.dispose();
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      };
    },
    { scope: canvasRef },
  );

  if (failed) return <div className={`liquid-fallback ${className ?? ""}`} aria-hidden="true" />;
  return <canvas ref={canvasRef} className={`liquid-stage ${className ?? ""}`} aria-hidden="true" />;
});

/* ─── Движок шума ───────────────────────────────────────────────────────── */

/**
 * Курсор притягивает жидкость, наведение на строку её разогревает и ускоряет.
 */
function runNoise(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  software: boolean,
  o: EngineOptions,
): { engine: Engine; dispose: () => void } | null {
  const { canvas, s, intensity, delay } = o;
  let focused = false;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_BODY);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  // Один треугольник, накрывающий экран, - дешевле двух.
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const u = {
    res: gl.getUniformLocation(program, "uRes"),
    time: gl.getUniformLocation(program, "uTime"),
    pointer: gl.getUniformLocation(program, "uPointer"),
    intensity: gl.getUniformLocation(program, "uIntensity"),
    heat: gl.getUniformLocation(program, "uHeat"),
    base: gl.getUniformLocation(program, "uBase"),
  };
  [s.br, s.bg, s.bb] = stageColor(canvas);

  const draw = () => {
    gl.uniform3f(u.base, s.br, s.bg, s.bb);
    gl.uniform1f(u.time, s.time);
    gl.uniform2f(u.pointer, s.px, s.py);
    gl.uniform1f(u.intensity, s.intensity);
    gl.uniform1f(u.heat, s.heat);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // Качество по возможностям машины. Без видеокарты (офисный ПК с
  // заблокированным драйвером - Chrome уходит в программный SwiftShader)
  // шейдер в половину экрана стоил бы сотни миллисекунд на кадр, и вместе с
  // ним вставал бы весь интерфейс: GSAP при долгих кадрах замедляет анимации,
  // чтобы не прыгать. Поэтому программный рендер сразу получает полотно в
  // пятую часть экрана, а медленные кадры дальше режут его вдвое - вплоть до
  // неподвижного последнего кадра.
  let scale = software ? 0.2 : SCALE;
  let still = prefersReducedMotion();

  const resize = () => {
    const width = Math.min(canvas.clientWidth * scale * Math.min(window.devicePixelRatio, 2), MAX_WIDTH);
    const ratio = canvas.clientHeight / Math.max(canvas.clientWidth, 1);
    canvas.width = Math.max(2, Math.round(width));
    canvas.height = Math.max(2, Math.round(width * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(u.res, canvas.width, canvas.height);
    // Смена размера стирает полотно, и рисовать надо сразу, а не на тике:
    // между ними браузер успевает показать пустой кадр. Пока вход раздвигает
    // сцену, размер меняется каждый кадр - и дым мигал бы весь раздвиг.
    draw();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  // Смена темы - атрибут на <html>. Кадр рисуется сразу, а не на тике:
  // растворение снимает новую тему в ближайшем кадре, и полотно в нём уже
  // должно быть нового цвета. Неподвижную сцену тикер не ведёт вовсе.
  const themeWatch = new MutationObserver(() => {
    [s.br, s.bg, s.bb] = stageColor(canvas);
    draw();
  });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  const idle: Engine = { focus: () => {}, release: () => {} };
  if (still) {
    s.intensity = intensity;
    s.time = 40;
    resize();
    return {
      engine: idle,
      dispose: () => {
        observer.disconnect();
        themeWatch.disconnect();
      },
    };
  }
  resize();

  // Сначала сцена, потом интерфейс: жидкость проявляется из темноты.
  gsap.to(s, { intensity, duration: 2.8, delay, ease: "power2.out" });

  const pointerTo = {
    x: gsap.quickTo(s, "px", { duration: 2.2, ease: "power3.out" }),
    y: gsap.quickTo(s, "py", { duration: 2.2, ease: "power3.out" }),
  };

  // Координаты - доли самого полотна, а не окна: на экране входа сцена
  // занимает левую половину, и в долях окна жидкость тянулась бы мимо курсора.
  const onPointer = (event: PointerEvent) => {
    if (focused) return;
    const box = canvas.getBoundingClientRect();
    pointerTo.x((event.clientX - box.left) / Math.max(box.width, 1));
    pointerTo.y(1 - (event.clientY - box.top) / Math.max(box.height, 1));
  };
  if (canHover()) window.addEventListener("pointermove", onPointer, { passive: true });

  // Вне экрана не рисуем вовсе: сцена на странице входа уезжает вверх на
  // телефоне, и считать её там - жечь батарею ради невидимого.
  let visible = true;
  const io = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
  });
  io.observe(canvas);

  // Сторож кадров: из каждых шестидесяти больше половины дольше 45 мс -
  // полотно вдвое меньше; меньше уже некуда - сцена замирает.
  let frames = 0;
  let slow = 0;
  const tick = (_time: number, deltaMs: number) => {
    if (!visible || still) return;
    s.time += (Math.min(deltaMs, 50) / 1000) * s.speed;
    draw();
    frames += 1;
    if (deltaMs > 45) slow += 1;
    if (frames < 60) return;
    if (slow > 30) {
      if (scale > 0.2) {
        scale = Math.max(0.2, scale / 2);
      } else {
        still = true;
        s.intensity = intensity;
      }
      resize();
    }
    frames = 0;
    slow = 0;
  };
  gsap.ticker.add(tick);

  const engine: Engine = {
    focus(row) {
      focused = true;
      const box = canvas.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      pointerTo.x((r.left + r.width * 0.7 - box.left) / Math.max(box.width, 1));
      pointerTo.y(1 - (r.top + r.height / 2 - box.top) / Math.max(box.height, 1));
      gsap.to(s, { heat: 1, speed: 2.4, duration: 1.2, ease: "expo.out", overwrite: "auto" });
    },
    release() {
      focused = false;
      gsap.to(s, { heat: 0, speed: 1, duration: 1.6, ease: "expo.out", overwrite: "auto" });
    },
  };

  return {
    engine,
    dispose() {
      gsap.ticker.remove(tick);
      gsap.killTweensOf(s);
      window.removeEventListener("pointermove", onPointer);
      observer.disconnect();
      themeWatch.disconnect();
      io.disconnect();
    },
  };
}
