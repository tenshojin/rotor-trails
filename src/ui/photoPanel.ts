// 拍照模式的面板：焦距、曝光、倾斜、隐藏直升机、构图线。画面是主角，这个面板只占最下面一条，
// 还能一键收起来。面板和构图线都是网页元素，存下来的图里没有它们。

/** 全画幅相机的焦距和竖直视角互换（底片高 24 mm） */
export const lensOfFov = (fov: number): number => 12 / Math.tan((fov * Math.PI) / 360);
export const fovOfLens = (mm: number): number => (Math.atan(12 / mm) * 360) / Math.PI;

const LENS_MIN = 14;
const LENS_MAX = 300;
/** 滑块上的 0..1 换成焦距：对数刻度，广角那头才调得细 */
const lensAt = (v: number): number => LENS_MIN * (LENS_MAX / LENS_MIN) ** v;
const sliderAt = (mm: number): number => Math.log(mm / LENS_MIN) / Math.log(LENS_MAX / LENS_MIN);

/** 风格：名字、饱和度、冷暖、黑位 */
export const LOOKS: ReadonlyArray<readonly [string, number, number, number]> = [
  ['原片', 1, 0, 0],
  ['胶片', 0.86, 0.55, 0.045],
  ['暖阳', 1.1, 1, 0],
  ['冷调', 0.92, -1, 0.01],
  ['黑白', 0, 0, 0.015],
];

export interface PhotoPanelHandlers {
  fov(deg: number): void;
  exposure(ev: number): void;
  /** 背景虚化（0..1） */
  blur(k: number): void;
  roll(rad: number): void;
  hideHeli(on: boolean): void;
  /** 勾上是慢快门：旋翼虚成一片 */
  blurRotor(on: boolean): void;
  look(sat: number, warm: number, fade: number): void;
  save(): void;
  back(): void;
}

export class PhotoPanel {
  private readonly root: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly note: HTMLElement;
  private readonly lens: HTMLInputElement;
  private readonly tilt: HTMLInputElement;
  private readonly lensOut: HTMLElement;
  private readonly tiltOut: HTMLElement;
  private noteTimer = 0;

  /** canBlur：低画质没有景深那一步 */
  constructor(parent: HTMLElement, fov: number, keys: string, canBlur: boolean, on: PhotoPanelHandlers) {
    this.grid = document.createElement('div');
    this.grid.className = 'photo-grid';
    parent.appendChild(this.grid);
    const root = this.root = document.createElement('div');
    root.className = 'photo-panel';
    root.innerHTML = `<div class="photo-keys">${keys}</div>
      <div class="photo-row">
        <label class="photo-slider"><span>焦距</span><input type="range" data-k="lens" min="0" max="1" step="0.002" aria-label="焦距"><output></output></label>
        <label class="photo-slider"><span>曝光</span><input type="range" data-k="ev" min="-2" max="2" step="0.1" value="0" aria-label="曝光"><output>0.0</output></label>
        <label class="photo-slider"><span>倾斜</span><input type="range" data-k="roll" min="-30" max="30" step="1" value="0" aria-label="倾斜"><output>0°</output></label>
        ${canBlur ? '<label class="photo-slider"><span>虚化</span><input type="range" data-k="dof" min="0" max="1" step="0.02" value="0" aria-label="背景虚化"><output>关</output></label>' : ''}
        <label class="photo-slider"><span>风格</span><select data-k="look" aria-label="风格">${LOOKS.map((l, i) => `<option value="${i}">${l[0]}</option>`).join('')}</select></label>
        <label class="photo-check"><input type="checkbox" data-k="heli">隐藏直升机</label>
        <label class="photo-check"><input type="checkbox" data-k="blur">旋翼虚化</label>
        <label class="photo-check"><input type="checkbox" data-k="grid">构图线</label>
        <span class="photo-note" role="status"></span>
        <button type="button" class="btn sm primary" data-a="save">存图</button>
        <button type="button" class="btn sm" data-a="back">返回</button>
      </div>`;
    parent.appendChild(root);
    const q = <T extends HTMLElement>(s: string): T => root.querySelector(s) as T;
    this.lens = q('[data-k="lens"]');
    this.tilt = q('[data-k="roll"]');
    this.lensOut = this.lens.nextElementSibling as HTMLElement;
    this.tiltOut = this.tilt.nextElementSibling as HTMLElement;
    this.note = q('.photo-note');
    const ev = q<HTMLInputElement>('[data-k="ev"]');
    this.setFov(fov);
    this.lens.addEventListener('input', () => {
      const mm = lensAt(Number(this.lens.value));
      this.lensOut.textContent = `${Math.round(mm)} mm`;
      on.fov(fovOfLens(mm));
    });
    ev.addEventListener('input', () => {
      const v = Number(ev.value);
      (ev.nextElementSibling as HTMLElement).textContent = `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
      on.exposure(v);
    });
    const dof = root.querySelector<HTMLInputElement>('[data-k="dof"]');
    dof?.addEventListener('input', () => {
      const v = Number(dof.value);
      (dof.nextElementSibling as HTMLElement).textContent = v > 0 ? `${Math.round(v * 100)}%` : '关';
      on.blur(v);
    });
    this.tilt.addEventListener('input', () => {
      const v = Number(this.tilt.value);
      this.tiltOut.textContent = `${v}°`;
      on.roll((v * Math.PI) / 180);
    });
    const look = q<HTMLSelectElement>('[data-k="look"]');
    look.addEventListener('change', () => {
      const [, sat, warm, fade] = LOOKS[Number(look.value)];
      on.look(sat, warm, fade);
    });
    q<HTMLInputElement>('[data-k="heli"]').addEventListener('change', (e) => on.hideHeli((e.target as HTMLInputElement).checked));
    q<HTMLInputElement>('[data-k="blur"]').addEventListener('change', (e) => on.blurRotor((e.target as HTMLInputElement).checked));
    q<HTMLInputElement>('[data-k="grid"]').addEventListener('change', (e) => this.grid.classList.toggle('lines', (e.target as HTMLInputElement).checked));
    q('[data-a="save"]').addEventListener('click', () => on.save());
    q('[data-a="back"]').addEventListener('click', () => on.back());
    // 点过的控件不留焦点：不然接下来按 WASD、空格都进了滑块和按钮，机位不动
    root.addEventListener('pointerup', () => setTimeout(() => (document.activeElement as HTMLElement | null)?.blur?.(), 0));
  }

  setFov(deg: number): void {
    const mm = lensOfFov(deg);
    this.lens.value = String(sliderAt(mm));
    this.lensOut.textContent = `${Math.round(mm)} mm`;
  }

  setRoll(rad: number): void {
    const v = Math.round((rad * 180) / Math.PI);
    this.tilt.value = String(v);
    this.tiltOut.textContent = `${v}°`;
  }

  /** 收起面板，看干净的画面 */
  toggle(): void {
    this.root.classList.toggle('hidden');
  }

  /** 面板展开着（手柄的十字键这时候走面板） */
  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** 面板本身（手柄在上面挑项目） */
  get element(): HTMLElement {
    return this.root;
  }

  /** 存好了：面板收起来的时候也要让人知道，所以闪一下画面 */
  saved(text: string): void {
    this.note.textContent = text;
    clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => {
      this.note.textContent = '';
    }, 2500);
    this.grid.classList.remove('photo-flash');
    void this.grid.offsetWidth;
    this.grid.classList.add('photo-flash');
  }

  dispose(): void {
    clearTimeout(this.noteTimer);
    this.root.remove();
    this.grid.remove();
  }
}
