// 超仿真的界面：鼠标旁边的控件说明、左上角的检查单。别的 HUD 都收起来，飞行信息全在仪表上。

export interface ChecklistRow {
  text: string;
  done: boolean;
}

export class SimPanel {
  private tip: HTMLDivElement;
  private list: HTMLDivElement;
  private rows: HTMLOListElement;
  private tipKey = '';
  private listKey = '';
  /** 点“自动完成”时调用 */
  onAuto: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.tip = document.createElement('div');
    this.tip.className = 'sim-tip hidden';
    this.list = document.createElement('div');
    this.list.className = 'sim-list hidden';
    this.list.innerHTML = '<div class="sim-list-head"><b>启动检查单</b><button type="button" class="sim-auto">自动完成</button></div><ol></ol><p class="sim-note">把鼠标移到屏幕边转头。左键操作，右键往回拧，滚轮转旋钮或拉近视野。</p>';
    this.rows = this.list.querySelector('ol')!;
    this.list.querySelector('.sim-auto')!.addEventListener('click', this.auto);
    parent.append(this.tip, this.list);
  }

  private auto = (e: Event): void => {
    (e.target as HTMLElement).blur();
    this.onAuto?.();
  };

  /** 鼠标指着的控件：名字、说明、当前读数 */
  tooltip(name: string, label: string, value: string, x: number, y: number, warn: string | null): void {
    const key = `${name}|${label}|${value}|${warn}`;
    if (key !== this.tipKey) {
      this.tipKey = key;
      this.tip.innerHTML = '';
      const b = document.createElement('b');
      b.textContent = name;
      this.tip.append(b);
      if (value) {
        const v = document.createElement('em');
        v.textContent = value;
        this.tip.append(v);
      }
      if (label) {
        const l = document.createElement('span');
        l.textContent = label;
        this.tip.append(l);
      }
      if (warn) {
        const w = document.createElement('i');
        w.textContent = warn;
        this.tip.append(w);
      }
    }
    // 靠右、靠下的时候翻到鼠标另一边，别跑出屏幕
    const left = x > innerWidth * 0.72;
    const up = y > innerHeight * 0.8;
    this.tip.style.transform = `translate(${left ? x - 18 : x + 18}px, ${up ? y - 14 : y + 18}px) translate(${left ? '-100%' : '0'}, ${up ? '-100%' : '0'})`;
    this.tip.classList.remove('hidden');
  }

  hideTooltip(): void {
    this.tip.classList.add('hidden');
    this.tipKey = '';
  }

  /** 检查单：全部做完就收起来 */
  checklist(rows: ChecklistRow[] | null): void {
    const key = rows ? rows.map((r) => (r.done ? '1' : '0')).join('') : '';
    if (key === this.listKey) return;
    this.listKey = key;
    if (!rows) {
      this.list.classList.add('hidden');
      return;
    }
    this.list.classList.remove('hidden');
    const next = rows.findIndex((r) => !r.done);
    this.rows.innerHTML = '';
    rows.forEach((r, i) => {
      const li = document.createElement('li');
      li.textContent = r.text;
      if (r.done) li.className = 'done';
      else if (i === next) li.className = 'now';
      this.rows.append(li);
    });
  }

  hide(): void {
    this.hideTooltip();
    this.checklist(null);
  }

  dispose(): void {
    this.list.querySelector('.sim-auto')?.removeEventListener('click', this.auto);
    this.tip.remove();
    this.list.remove();
    this.onAuto = null;
  }
}
