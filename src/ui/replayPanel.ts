// 回放的面板：进度条、暂停、慢放、换镜头、拍照。画面是主角，只占最下面一条，能收起来。

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export interface ReplayHandlers {
  seek(t: number): void;
  hold(on: boolean): void;
  slow(on: boolean): void;
  shot(): void;
  photo(): void;
  back(): void;
}

export class ReplayPanel {
  private readonly root: HTMLDivElement;
  private readonly bar: HTMLInputElement;
  private readonly time: HTMLElement;
  private readonly holdBtn: HTMLButtonElement;
  private dragging = false;

  constructor(parent: HTMLElement, private readonly seconds: number, keys: string, on: ReplayHandlers) {
    const root = this.root = document.createElement('div');
    root.className = 'photo-panel replay-panel';
    root.innerHTML = `<div class="photo-keys">${keys}</div>
      <div class="photo-row">
        <button type="button" class="btn sm" data-a="hold" aria-pressed="false">暂停</button>
        <input type="range" class="replay-bar" min="0" max="${seconds}" step="0.1" value="0" aria-label="回放进度">
        <output class="replay-time">0:00 / ${clock(seconds)}</output>
        <label class="photo-check"><input type="checkbox" data-k="slow">慢放</label>
        <button type="button" class="btn sm" data-a="shot">换镜头</button>
        <button type="button" class="btn sm" data-a="photo">拍这一帧</button>
        <button type="button" class="btn sm primary" data-a="back">结束回放</button>
      </div>`;
    parent.appendChild(root);
    const q = <T extends HTMLElement>(s: string): T => root.querySelector(s) as T;
    this.bar = q('.replay-bar');
    this.time = q('.replay-time');
    this.holdBtn = q('[data-a="hold"]');
    this.bar.addEventListener('pointerdown', () => {
      this.dragging = true;
    });
    this.bar.addEventListener('pointerup', () => {
      this.dragging = false;
    });
    this.bar.addEventListener('input', () => on.seek(Number(this.bar.value)));
    this.holdBtn.addEventListener('click', () => {
      const held = this.holdBtn.getAttribute('aria-pressed') !== 'true';
      this.setHold(held);
      on.hold(held);
    });
    q<HTMLInputElement>('[data-k="slow"]').addEventListener('change', (e) => on.slow((e.target as HTMLInputElement).checked));
    q('[data-a="shot"]').addEventListener('click', () => on.shot());
    q('[data-a="photo"]').addEventListener('click', () => on.photo());
    q('[data-a="back"]').addEventListener('click', () => on.back());
    // 点过的控件不留焦点：不然按键都进了按钮和滑块
    root.addEventListener('pointerup', () => setTimeout(() => (document.activeElement as HTMLElement | null)?.blur?.(), 0));
  }

  private setHold(on: boolean): void {
    this.holdBtn.setAttribute('aria-pressed', String(on));
    this.holdBtn.textContent = on ? '继续' : '暂停';
  }

  update(t: number): void {
    if (!this.dragging) this.bar.value = String(t);
    this.time.textContent = `${clock(t)} / ${clock(this.seconds)}`;
  }

  /** 收起面板，看干净的画面 */
  toggle(): void {
    this.root.classList.toggle('hidden');
  }

  /** 拍这一帧的时候让给拍照面板 */
  show(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
  }

  dispose(): void {
    this.root.remove();
  }
}
