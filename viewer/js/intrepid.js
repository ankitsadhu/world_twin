// The Intrepid Sea, Air & Space Museum, as a visitor gets around it: walk out along Pier 86 to the visitor elevator
// beside the hull, ride up to the flight deck (18 m), walk the deck among the display aircraft (you can't walk off its
// edge), and ride back down. The carrier model is export/times_square/intrepid.glb (scripts/blender/heroes/intrepid.py);
// it replaces the district's plain footprint block for the ship.
import * as THREE from "three";

const DECK_Z = 18.0, EYE = 1.7;
const LIFT = { x: -1424.3, y: 49.5 };                   // the visitor elevator tower on Pier 86 (port side of the ship)
const PIER_SPOT = { x: -1424.3, y: 54.0 };             // where you stand on the pier in front of its glass doors
const DECK_SPOT = { x: -1424.3, y: 39.0 };             // where the bridge from the tower lands on the flight deck

export class IntrepidVisit {
  constructor(o) {
    // o: { camera, getMode, getCollider, walk }
    Object.assign(this, o);
    const css = document.createElement("style");
    css.textContent = `
      #liftchip { position: fixed; left: 50%; bottom: 150px; transform: translateX(-50%); z-index: 28; display: none; align-items: center;
        gap: var(--s2); box-shadow: var(--shadow); }
      #liftchip kbd { font: var(--w-semibold) var(--t-caption) var(--font); background: rgba(0,0,0,.15); border-radius: 6px; padding: 2px 6px; }
      body[data-input="touch"] #liftchip kbd { display: none; }
      #liftveil { position: fixed; inset: 0; z-index: 60; background: #000; opacity: 0; pointer-events: none; transition: opacity .4s; }`;
    document.head.appendChild(css);
    document.body.insertAdjacentHTML("beforeend", `<button id="liftchip" class="ui-btn ui-surface"></button><div id="liftveil" aria-hidden="true"></div>`);
    this.chip = document.getElementById("liftchip");
    this.chip.onclick = () => this.ride();
    addEventListener("keydown", e => { if (this.where && e.code === "KeyE" && !e.repeat && e.target.tagName !== "INPUT") this.ride(); });
  }

  // the flight deck's walkable area: the ship's outline, a metre in from the edge (the deck-edge netting)
  onDeck(x, y) {
    const col = this.getCollider();
    if (!col) return false;
    if (!this.ship) this.ship = [...col.near(-1490, 30, 20)].map(i => col.polys[i]).find(p => p.kind === "ship") || null;
    const s = this.ship;
    if (!s || x < s.box[0] + 1 || x > s.box[2] - 1 || y < s.box[1] + 1 || y > s.box[3] - 1) return false;
    if (!inside(s.pts, x, y)) return false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!inside(s.pts, x + dx, y + dy)) return false;
    return true;
  }

  update() {
    const c = this.camera.position, x = c.x, y = -c.z, feet = c.y - EYE;
    this.where = null;
    if (this.getMode() === "walk") {
      if (feet < 5 && Math.hypot(x - PIER_SPOT.x, y - PIER_SPOT.y) < 12) this.where = "up";
      else if (feet > 15 && Math.hypot(x - DECK_SPOT.x, y - DECK_SPOT.y) < 12) this.where = "down";
    }
    if (this.where !== this._shown) {
      this._shown = this.where;
      this.chip.style.display = this.where ? "flex" : "none";
      this.chip.innerHTML = this.where === "up" ? `⬆ Elevator to the flight deck<kbd>E</kbd>` : this.where === "down" ? `⬇ Elevator down to Pier 86<kbd>E</kbd>` : "";
    }
  }

  async ride() {
    const dir = this.where;
    if (!dir) return;
    const veil = document.getElementById("liftveil");
    veil.style.opacity = "1";
    await new Promise(r => setTimeout(r, 420));
    const s = dir === "up" ? DECK_SPOT : PIER_SPOT, face = dir === "up" ? -1 : 1;   // up: face into the deck (south)
    this.camera.position.set(s.x, (dir === "up" ? DECK_Z : 1.2) + EYE, -s.y);
    if (this.walk) { this.walk.yaw = face < 0 ? Math.PI : 0; this.walk.target = null; }
    setTimeout(() => { veil.style.opacity = "0"; }, 250);
  }
}

function inside(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
