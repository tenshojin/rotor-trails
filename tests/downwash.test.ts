import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { addWashWind, DownwashView } from '../src/render/downwash';
import { WASH, WASH_Y } from '../src/render/atmosphere';
import { getSmokeTexture } from '../src/render/navView';
import { TRAINING } from '../src/maps/training';
import type { MapDef } from '../src/maps/types';
import type { GameSession } from '../src/sim/session';

vi.mock('../src/render/navView', async () => {
  const { Texture } = await import('three/webgpu');
  const sharedSmoke = new Texture();
  return { getSmokeTexture: () => sharedSmoke };
});

function fixture() {
  const map: MapDef = { ...TRAINING, pads: [], waterLevel: null };
  const s = {
    body: { pos: new THREE.Vector3(0, 2, 0), vel: new THREE.Vector3() },
    world: { terrain: { heightAt: () => 0 } },
    flight: { telemetry: { rotorRpm: 1 } },
    wind: { sample: (_x: number, _y: number, _z: number, _t: number, out: THREE.Vector3) => out.set(1, 0, 0.2) },
    t: 0,
  } as unknown as GameSession;
  const view = new DownwashView(map);
  const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 1000);
  camera.position.set(20, 12, 20);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const mesh = view.group.children[0] as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshBasicNodeMaterial>;
  const step = (dt = 0.1) => { s.t += Number.isFinite(dt) ? Math.max(0, dt) : 0; view.update(dt, s, camera); };
  return { view, camera, mesh, s, step };
}

function finiteAttributes(geometry: THREE.BufferGeometry) {
  for (const name of ['washPuff', 'washColor', 'washAngle']) {
    expect(Array.from(geometry.getAttribute(name).array).every(Number.isFinite), name).toBe(true);
  }
}

describe('rotor downwash batching', () => {
  it('keeps all live particles in one depth-sorted draw, even after repeated pool reuse', () => {
    const { view, mesh, camera, step } = fixture();
    try {
      for (let i = 0; i < 120; i++) step();
      expect(view.group.children).toEqual([mesh]);
      expect(mesh.geometry.isInstancedBufferGeometry).toBe(true);
      expect(mesh.material.forceSinglePass).toBe(true);
      expect(mesh.visible).toBe(true);
      expect(mesh.geometry.instanceCount).toBeGreaterThan(1);
      expect(mesh.geometry.instanceCount).toBeLessThanOrEqual(72);
      finiteAttributes(mesh.geometry);
      const attr = mesh.geometry.getAttribute('washPuff');
      let last = Infinity;
      for (let i = 0; i < mesh.geometry.instanceCount; i++) {
        const distance = new THREE.Vector3(attr.getX(i), attr.getY(i), attr.getZ(i)).distanceToSquared(camera.position);
        expect(distance).toBeLessThanOrEqual(last + 0.001);
        last = distance;
      }
    } finally { view.dispose(); }
  });

  it('never uploads NaN opacity while particles cross their lifetime and hides an empty batch', () => {
    const { view, mesh, s, step } = fixture();
    try {
      expect(mesh.visible).toBe(false);
      for (let i = 0; i < 12; i++) step();
      expect(mesh.visible).toBe(true);
      s.flight.telemetry.rotorRpm = 0;
      for (let i = 0; i < 60; i++) {
        step();
        finiteAttributes(mesh.geometry);
        const alpha = mesh.geometry.getAttribute('washColor');
        for (let j = 0; j < mesh.geometry.instanceCount; j++) expect(alpha.getW(j)).toBeGreaterThanOrEqual(0);
      }
      expect(mesh.visible).toBe(false);
      // Shader prewarming retains an inert instance; it must be truly transparent.
      expect(mesh.geometry.instanceCount).toBe(1);
      expect(mesh.geometry.getAttribute('washColor').getW(0)).toBe(0);
      expect(mesh.geometry.getAttribute('washPuff').getW(0)).toBe(0);
    } finally { view.dispose(); }
  });

  it('旋翼气流：贴地时满强度，飞高了不再贴地散开，飞快了力度变小', () => {
    const { view, s, step } = fixture();
    try {
      step();
      expect(WASH.value.z).toBe(1);
      const hover = WASH.value.w;
      expect(hover).toBeGreaterThan(0.5);
      expect(WASH_Y.value).toBeGreaterThan(2);
      s.body.pos.y = 120;
      step();
      expect(WASH.value.z).toBe(0);
      expect(WASH.value.w).toBeCloseTo(hover);
      s.body.pos.y = 2;
      s.body.vel.set(50, 0, 0);
      step();
      expect(WASH.value.w).toBeLessThan(hover * 0.5);
      // 气柱落到地面时飞机已经飞过去了
      expect(WASH.value.x).toBeLessThan(0);
      s.flight.telemetry.rotorRpm = 0;
      step();
      expect(WASH.value.w).toBe(0);
    } finally { view.dispose(); }
  });

  it('旋翼气流把风向袋往外吹，远处没有影响', () => {
    const { view, step } = fixture();
    try {
      step();
      const near = addWashWind(new THREE.Vector3(15, 0, 0), new THREE.Vector3());
      expect(near.x).toBeGreaterThan(5);
      expect(Math.abs(near.z)).toBeLessThan(0.01);
      const far = addWashWind(new THREE.Vector3(200, 0, 0), new THREE.Vector3(1, 0, 0));
      expect(far.x).toBe(1);
    } finally { view.dispose(); }
  });

  it('clamps late/invalid frames and releases owned GPU resources without disposing the shared smoke texture', () => {
    const { view, mesh, step } = fixture();
    for (const dt of [NaN, Infinity, -5]) step(dt);
    expect(mesh.visible).toBe(false);
    step(10);
    expect(mesh.geometry.instanceCount).toBeLessThanOrEqual(4);
    finiteAttributes(mesh.geometry);
    expect(WASH.value.z).toBeGreaterThan(0);
    const geoDisposed = vi.fn(), matDisposed = vi.fn(), sharedDisposed = vi.fn();
    mesh.geometry.addEventListener('dispose', geoDisposed);
    mesh.material.addEventListener('dispose', matDisposed);
    const smoke = getSmokeTexture();
    smoke.addEventListener('dispose', sharedDisposed);
    view.dispose();
    expect(geoDisposed).toHaveBeenCalledOnce();
    expect(matDisposed).toHaveBeenCalledOnce();
    expect(sharedDisposed).not.toHaveBeenCalled();
    expect(WASH.value.toArray()).toEqual([0, 0, 0, 0]);
    smoke.removeEventListener('dispose', sharedDisposed);
  });
});
