import type { InstrumentData } from '../render/instruments';
import type { GameSession } from '../sim/session';

/** Reuse map-display points while still reflecting route, mission and pickup changes every frame. */
export class InstrumentLists {
  readonly route: InstrumentData['route'] = [];
  readonly objectives: InstrumentData['objectives'] = [];
  readonly pickups: InstrumentData['pickups'] = [];

  update(session: GameSession): void {
    const route = this.route;
    const start = route[0] ??= [0, 0];
    start[0] = session.body.pos.x;
    start[1] = session.body.pos.z;
    let count = 1;
    for (const node of session.nav.info.preview) {
      const point = route[count++] ??= [0, 0];
      point[0] = node.pos[0];
      point[1] = node.pos[2];
    }
    route.length = count;

    count = 0;
    for (const objective of session.mission.optional) {
      if (objective.status === 'done') continue;
      const goal = session.mission.goalOf(objective, session.body.pos);
      const point = this.objectives[count++] ??= { x: 0, z: 0, main: false };
      point.x = goal[0]; point.z = goal[2]; point.main = false;
    }
    const current = session.mission.current();
    if (current) {
      const goal = session.mission.goalOf(current, session.body.pos);
      const point = this.objectives[count++] ??= { x: 0, z: 0, main: true };
      point.x = goal[0]; point.z = goal[2]; point.main = true;
    }
    this.objectives.length = count;

    count = 0;
    for (const pickup of session.world.map.pickups) {
      if (session.pickupsTaken.has(pickup.id)) continue;
      const point = this.pickups[count++] ??= { x: 0, z: 0, kind: '' };
      point.x = pickup.pos[0]; point.z = pickup.pos[2]; point.kind = pickup.kind;
    }
    this.pickups.length = count;
  }
}
