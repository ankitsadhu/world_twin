// The police helicopter (4-5 star chases): hovers above and behind you, banks as it follows, rotor blur, a searchlight cone that sweeps on to you.
// Primitives only (no model needed); it never touches anything, it is there to raise the heat visually.
import * as THREE from "three";

export class Heli {
  constructor(scene) {
    const g = new THREE.Group(); g.name = "POLICE_heli"; g.userData.traffic = true;
    const blue = new THREE.MeshStandardMaterial({ color: 0x10243a, roughness: 0.45, metalness: 0.3 }), dark = new THREE.MeshStandardMaterial({ color: 0x15171c });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), blue); body.scale.set(1, 0.85, 1.7); g.add(body);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.35, 5, 8), blue); tail.rotation.x = Math.PI / 2; tail.position.z = -4; g.add(tail);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.8), blue); fin.position.set(0, 0.6, -6.3); g.add(fin);
    this.rotor = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.04, 28), new THREE.MeshBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.18, depthWrite: false })); this.rotor.position.y = 1.7; g.add(this.rotor);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.05, 0.25), dark); blade.position.y = 1.72; this.blade = blade; g.add(blade);
    const skid = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.1), dark); skid.position.y = -1.3; g.add(skid);
    for (const [c, x] of [[0xff2638, -0.5], [0x36a8ff, 0.5]]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: c, toneMapped: false })); l.position.set(x, -0.9, 1.4); l.userData.strobe = c; g.add(l); }
    this.cone = new THREE.Mesh(new THREE.ConeGeometry(3.6, 40, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff6d6, transparent: true, opacity: 0.035, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide }));
    this.cone.position.y = -21; g.add(this.cone);
    g.traverse(o => { o.raycast = () => {}; o.userData.traffic = true; });
    this.group = g; g.visible = false; scene.add(g); this.active = false; this.t = 0;
  }
  show(on, ride) {
    if (on && !this.active && ride?.car) { const p = ride.car.position; this.group.position.set(p.x - 60, p.y + 55, p.z + 40); }
    this.active = on; this.group.visible = on;
  }
  update(dt, ride) {
    if (!this.active || !ride?.car) return;
    this.t += dt;
    const p = ride.car.position, h = ride.heading, want = new THREE.Vector3(p.x - Math.cos(h) * 22 + Math.sin(this.t * 0.7) * 6, p.y + 46 + Math.sin(this.t * 1.3) * 2, p.z + Math.sin(h) * 22 + Math.cos(this.t * 0.6) * 6);
    const prev = this.group.position.clone(); this.group.position.lerp(want, 1 - Math.exp(-dt * 0.9));
    const vel = this.group.position.clone().sub(prev).divideScalar(Math.max(dt, 1e-3));
    this.group.rotation.y = Math.atan2(p.x - this.group.position.x, p.z - this.group.position.z);                    // nose toward you
    this.group.rotation.x = THREE.MathUtils.clamp(vel.length() * 0.012, 0, 0.25);                                     // leans into the move
    this.blade.rotation.y += dt * 40; this.rotor.visible = true;
    const to = new THREE.Vector3(p.x, p.y, p.z).sub(this.group.position), L = to.length();                            // the searchlight points at you
    this.cone.scale.set(1, L / 40, 1); this.cone.position.set(0, 0, 0);
    this.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().normalize().applyQuaternion(this.group.quaternion.clone().invert()));
    this.cone.position.copy(new THREE.Vector3(0, 0, 0).add(to.clone().applyQuaternion(this.group.quaternion.clone().invert()).multiplyScalar(0.5)));
    const blink = Math.floor(this.t * 4) % 2;
    this.group.traverse(o => { if (o.userData.strobe) o.visible = (o.userData.strobe === 0xff2638) === !blink; });
  }
}
