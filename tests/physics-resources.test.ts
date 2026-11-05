import { expect, it } from 'vitest';
import { PhysicsWorld, initPhysics } from '../src/sim/physics';

it('反复创建和移除树碰撞代理不保留已失效的碰撞体', async () => {
  await initPhysics();
  const physics = new PhysicsWorld();
  try {
    for (let cycle = 0; cycle < 100; cycle++) {
      const collider = physics.addBall(0, 10, 0, 3, { kind: 'tree', id: String(cycle) });
      expect(physics.tags.get(collider.handle)?.id).toBe(String(cycle));
      physics.removeCollider(collider);
      expect(physics.world.colliders.len()).toBe(0);
      expect(physics.tags.size).toBe(0);
    }
    // Rapier 已释放资源，外层 bookkeeping 也不能持有全部退休代理。
    const bookkeeping = physics as unknown as { colliderList?: unknown[] };
    expect(bookkeeping.colliderList ?? []).toHaveLength(0);
  } finally {
    physics.dispose();
  }
});
