// 固定步长推进器：把不规则的帧间隔换算成固定 1/60 s 的物理步数。
// 物理结果只取决于步数，与帧率无关；切后台、卡顿后的超长帧会被截断，不会一次性补算导致“瞬移”。

export class FixedStepper {
  /** 尚未消化的时间（s） */
  acc = 0;
  /** 渲染插值系数（0..1）：上一个物理状态与当前状态之间的位置 */
  alpha = 1;

  constructor(
    readonly step: number,
    /** 单帧最多推进的物理步数（超过后丢弃积压时间） */
    readonly maxSteps = 6,
    /** 单帧最长计入的时间（s） */
    readonly maxFrame = 0.1,
  ) {}

  /** 计入一帧的时间，返回本帧应执行的物理步数。 */
  advance(frameDt: number): number {
    let dt = Number.isFinite(frameDt) && frameDt > 0 ? frameDt : 0;
    dt = Math.min(dt, this.maxFrame);
    this.acc += dt;
    let n = Math.floor(this.acc / this.step + 1e-9);
    if (n > this.maxSteps) {
      n = this.maxSteps;
      this.acc = 0;
    } else this.acc -= n * this.step;
    if (this.acc < 0) this.acc = 0;
    this.alpha = Math.min(1, this.acc / this.step);
    return n;
  }

  reset(): void {
    this.acc = 0;
    this.alpha = 1;
  }
}
