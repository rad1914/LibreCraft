// Minimal day/night cycle. Drives the sun direction, sky color, and
// light intensities over a configurable cycle length. The cycle is
// normalized to [0..1) where:
//   0.00 = sunrise
//   0.25 = noon (sun overhead)
//   0.50 = sunset
//   0.75 = midnight (sun opposite)
//   1.00 = sunrise again
//
// At night the sky darkens further (very low ambient + hemi), stars
// appear (a Points field scattered across the sky dome), and a moon
// mesh rises opposite the sun. The engine calls `update(dt)` each
// frame and `apply()` is called automatically to sync the Three.js scene.

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
  cycleLength = 600; // 10 minutes per full day
  private lights: DayNightLights;
  private fog: THREE.Fog;
  // Visual sky elements — sun sphere, moon mesh, star field.
  private sunMesh: THREE.Mesh;
  private moonMesh: THREE.Mesh;
  private stars: THREE.Points;
  // Red-moon event tint — when > 0, the sky lerps toward red. Decays
  // back to 0 over time as the event fades.
  redMoonTint = 0;

  constructor(lights: DayNightLights, fog: THREE.Fog) {
    this.lights = lights;
    this.fog = fog;

    // Sun: bright yellow sphere (created in engine.ts and added to scene
    // there — here we just receive a reference for positioning). We
    // create our own moon + stars since they're night-only.
    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(8, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false }),
    );
    // Moon: pale grey sphere, smaller than the sun.
    this.moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(5, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xe8e8f0, fog: false }),
    );
    // Stars: a Points field scattered on a large sphere shell. Only
    // visible at night (opacity is driven by the day factor).
    const starCount = 400;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      // Random point on a sphere of radius 200 (upward bias so stars
      // are mostly overhead, not below the horizon).
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.9 + 0.1); // upper hemisphere
      const r = 200;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi);
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      fog: false,
    });
    this.stars = new THREE.Points(starGeo, starMat);
  }

  // The engine adds sun/moon/stars to the scene after constructing the
  // cycle. Called once from Engine.start().
  addSkyElements(scene: THREE.Scene, sunMesh: THREE.Mesh) {
    this.sunMesh = sunMesh; // engine owns the sun mesh; we just position it
    scene.add(this.moonMesh);
    scene.add(this.stars);
  }

  update(dt: number) {
    this.time = (this.time + dt / this.cycleLength) % 1;
    // Red-moon tint decays slowly when no event is forcing it.
    if (this.redMoonTint > 0) this.redMoonTint = Math.max(0, this.redMoonTint - dt * 0.05);
    this.apply();
  }

  setTime(t: number) {
    this.time = ((t % 1) + 1) % 1;
    this.apply();
  }

  getTime(): number { return this.time; }

  getDayFactor(): number {
    const dayFactor = Math.max(0, Math.min(1, (this.sunElevation() + 0.2) / 0.7));
    return dayFactor * dayFactor * (3 - 2 * dayFactor);
  }

  private sunElevation(): number {
    return Math.sin((this.time - 0.0) * Math.PI * 2 - Math.PI / 2);
  }

  apply() {
    const elev = this.sunElevation(); // -1..+1
    const angle = this.time * Math.PI * 2 - Math.PI / 2;
    const sunX = Math.cos(angle) * 100;
    const sunY = elev * 140;
    const sunZ = Math.sin(angle) * 60;
    this.lights.sun.position.set(sunX, sunY, sunZ);

    // Moon is opposite the sun.
    const moonX = -sunX * 0.7;
    const moonY = -elev * 140 * 0.7;
    const moonZ = -sunZ * 0.7;
    this.moonMesh.position.set(moonX, moonY, moonZ);

    // Day factor: 0 at night, 1 at full day. Smoothstepped.
    const dayFactor = Math.max(0, Math.min(1, (elev + 0.2) / 0.7));
    const smoothDay = dayFactor * dayFactor * (3 - 2 * dayFactor);
    // Night factor: 1 at deep night, 0 at day. Inverse of smoothDay.
    const nightFactor = 1 - smoothDay;

    // Sun intensity: 0 at night.
    this.lights.sun.intensity = 0.85 * smoothDay;
    // Hemisphere — darker at night (moonlight is dim). Was 0.15 floor; now 0.06.
    this.lights.hemi.intensity = 0.85 * smoothDay + 0.06 * nightFactor;
    // Ambient — very dark at night so caves and unlit areas are actually dark.
    this.lights.ambient.intensity = 0.25 * smoothDay + 0.03 * nightFactor;

    // Star opacity: 0 during day, 1 at deep night.
    (this.stars.material as THREE.PointsMaterial).opacity = nightFactor * 0.9;
    // Moon visibility — fade in as night falls. The moon mesh itself is
    // always present; we toggle visibility based on whether it's above
    // the horizon (y > 0).
    this.moonMesh.visible = moonY > 0 && nightFactor > 0.2;

    // Sky color: lerp between night blue (darker now) and day blue.
    const night = new THREE.Color(0x05060f); // very dark navy
    const day = new THREE.Color(0x9ad0ff);
    const sky = night.clone().lerp(day, smoothDay);
    // Warm tint near sunrise/sunset.
    const horizonness = 1 - Math.abs(elev);
    if (smoothDay > 0.05 && horizonness > 0.5) {
      const sunset = new THREE.Color(0xff8c42);
      const tint = Math.min(1, (horizonness - 0.5) * 2) * smoothDay * 0.4;
      sky.lerp(sunset, tint);
    }
    // Red-moon event: lerp the sky toward a deep blood red.
    if (this.redMoonTint > 0) {
      const bloodMoon = new THREE.Color(0x4a0808);
      sky.lerp(bloodMoon, Math.min(1, this.redMoonTint) * 0.6);
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
