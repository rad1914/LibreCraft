// Minimal day/night cycle. Drives the sun direction, sky color, and
// light intensities over a configurable cycle length. The cycle is
// normalized to [0..1) where:
//   0.00 = sunrise
//   0.25 = noon (sun overhead)
//   0.50 = sunset
//   0.75 = midnight (sun opposite)
//   1.00 = sunrise again
//
// The engine calls `update(dt)` each frame and `apply()` is called
// automatically to sync the Three.js scene.

import * as THREE from "three";

export interface DayNightLights {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  scene: THREE.Scene;
}

export class DayNightCycle {
  // Time of day in [0..1). 0.25 = noon.
  time = 0.25;
  // Cycle length in seconds for a full day. 300s = 5 minutes/day.
  cycleLength = 300;
  private lights: DayNightLights;
  private fog: THREE.Fog;

  constructor(lights: DayNightLights, fog: THREE.Fog) {
    this.lights = lights;
    this.fog = fog;
  }

  update(dt: number) {
    this.time = (this.time + dt / this.cycleLength) % 1;
    this.apply();
  }

  // Set time-of-day directly (used when loading from save).
  setTime(t: number) {
    this.time = ((t % 1) + 1) % 1;
    this.apply();
  }

  getTime(): number {
    return this.time;
  }

  // Returns the day factor (0 = night, 1 = full day). Used by the mob
  // spawner to decide whether to spawn/despawn.
  getDayFactor(): number {
    const elev = Math.sin((this.time - 0.0) * Math.PI * 2 - Math.PI / 2);
    const dayFactor = Math.max(0, Math.min(1, (elev + 0.2) / 0.7));
    return dayFactor * dayFactor * (3 - 2 * dayFactor);
  }

  // Compute sun elevation: -1 (below horizon, midnight) to +1 (overhead, noon).
  // time=0.25 (noon) -> +1, time=0.75 (midnight) -> -1.
  private sunElevation(): number {
    // sin(2π * (time - 0.25)) gives -1 at time=0, +1 at time=0.25, 0 at 0.5, -1 at 0.75
    // We want +1 at 0.25 (noon) and -1 at 0.75 (midnight), so:
    return Math.sin((this.time - 0.0) * Math.PI * 2 - Math.PI / 2);
  }

  apply() {
    const elev = this.sunElevation(); // -1..+1
    // Sun angle around the scene: full circle over the cycle.
    const angle = this.time * Math.PI * 2 - Math.PI / 2;
    const sunX = Math.cos(angle) * 100;
    const sunY = elev * 140;
    const sunZ = Math.sin(angle) * 60;
    this.lights.sun.position.set(sunX, sunY, sunZ);

    // Day factor: 0 at night, 1 at full day. Smoothstepped.
    const dayFactor = Math.max(0, Math.min(1, (elev + 0.2) / 0.7));
    const smoothDay = dayFactor * dayFactor * (3 - 2 * dayFactor);

    // Sun intensity: 0 at night, ~1.0 at noon.
    this.lights.sun.intensity = 0.85 * smoothDay;
    // Hemisphere dims but doesn't go fully dark (moonlight).
    this.lights.hemi.intensity = 0.85 * smoothDay + 0.15;
    // Ambient stays low but present.
    this.lights.ambient.intensity = 0.25 * smoothDay + 0.1;

    // Sky color: lerp between night blue and day blue, with warm tint near horizon.
    const night = new THREE.Color(0x0a0e2a);
    const day = new THREE.Color(0x9ad0ff);
    const sky = night.clone().lerp(day, smoothDay);
    // Warm tint near sunrise/sunset (when |elev| is small but smoothDay > 0)
    const horizonness = 1 - Math.abs(elev);
    if (smoothDay > 0.05 && horizonness > 0.5) {
      const sunset = new THREE.Color(0xff8c42);
      const tint = Math.min(1, (horizonness - 0.5) * 2) * smoothDay * 0.4;
      sky.lerp(sunset, tint);
    }
    (this.lights.scene.background as THREE.Color).copy(sky);
    this.fog.color.copy(sky);

    // Sun color shifts warmer near sunrise/sunset.
    const sunColorDay = new THREE.Color(0xfff4d6);
    const sunColorSunset = new THREE.Color(0xff7a3a);
    const sunColor = sunColorDay.clone().lerp(sunColorSunset, horizonness * (1 - smoothDay * 0.5));
    this.lights.sun.color.copy(sunColor);
  }
}
