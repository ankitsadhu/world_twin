const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function axes(h) {
  return [[Math.cos(h), Math.sin(h)], [-Math.sin(h), Math.cos(h)]];
}

function radius(h, halfLength, halfWidth, axis) {
  return halfLength * Math.abs(Math.cos(h) * axis[0] + Math.sin(h) * axis[1])
    + halfWidth * Math.abs(-Math.sin(h) * axis[0] + Math.cos(h) * axis[1]);
}

function support(body, direction) {
  const [f, s] = axes(body.h);
  const df = direction[0] * f[0] + direction[1] * f[1];
  const ds = direction[0] * s[0] + direction[1] * s[1];
  const along = Math.abs(df) < 1e-8 ? 0 : Math.sign(df);
  const across = Math.abs(ds) < 1e-8 ? 0 : Math.sign(ds);
  return [body.x + f[0] * body.halfLength * along + s[0] * body.halfWidth * across,
    body.y + f[1] * body.halfLength * along + s[1] * body.halfWidth * across];
}

export function obbContact(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  let penetration = Infinity, normal = null;
  for (const axis of [...axes(a.h), ...axes(b.h)]) {
    const overlap = radius(a.h, a.halfLength, a.halfWidth, axis)
      + radius(b.h, b.halfLength, b.halfWidth, axis) - Math.abs(dx * axis[0] + dy * axis[1]);
    if (overlap <= 0) return null;
    if (overlap < penetration) {
      const sign = dx * axis[0] + dy * axis[1] < 0 ? -1 : 1;
      penetration = overlap;
      normal = [axis[0] * sign, axis[1] * sign];
    }
  }
  const pa = support(a, normal), pb = support(b, [-normal[0], -normal[1]]);
  return {
    point: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2],
    normal,
    penetration,
  };
}

function pointVelocity(body, point) {
  const rx = point[0] - body.x, ry = point[1] - body.y;
  return [body.vx - body.omega * ry, body.vy + body.omega * rx];
}

export function resolveImpact(a, b, contact, restitution = 0.25) {
  const [nx, ny] = contact.normal;
  const va = pointVelocity(a, contact.point), vb = pointVelocity(b, contact.point);
  const closing = (vb[0] - va[0]) * nx + (vb[1] - va[1]) * ny;
  const dvA = [0, 0], dvB = [0, 0];
  let impulse = 0;
  if (closing < 0) {
    const rax = contact.point[0] - a.x, ray = contact.point[1] - a.y;
    const rbx = contact.point[0] - b.x, rby = contact.point[1] - b.y;
    const ca = rax * ny - ray * nx, cb = rbx * ny - rby * nx;
    const invA = 1 / a.mass, invB = 1 / b.mass;
    const invIa = 1 / a.inertia, invIb = 1 / b.inertia;
    impulse = -(1 + clamp(restitution, 0, 1)) * closing / (invA + invB + ca * ca * invIa + cb * cb * invIb);
    dvA[0] = -impulse * nx * invA; dvA[1] = -impulse * ny * invA;
    dvB[0] = impulse * nx * invB; dvB[1] = impulse * ny * invB;
    a.vx += dvA[0]; a.vy += dvA[1]; a.omega -= impulse * ca * invIa;
    b.vx += dvB[0]; b.vy += dvB[1]; b.omega += impulse * cb * invIb;
  }
  const correction = Math.max(contact.penetration - 0.02, 0) * 0.65 / (1 / a.mass + 1 / b.mass);
  a.x -= nx * correction / a.mass; a.y -= ny * correction / a.mass;
  b.x += nx * correction / b.mass; b.y += ny * correction / b.mass;
  const effectiveMass = 1 / (1 / a.mass + 1 / b.mass);
  const strength = clamp(Math.sqrt(Math.max(0, 0.5 * effectiveMass * closing * closing) / 120000), 0, 1);
  return { strength, point: contact.point, normal: contact.normal, dvA, dvB, closingSpeed: Math.max(0, -closing), impulse };
}

export function boxInertia(mass, halfLength, halfWidth) {
  return mass * ((2 * halfLength) ** 2 + (2 * halfWidth) ** 2) / 12;
}
