// The world's zones (docs/world_plan.md): each is a named place with its own signature game, searchable ("Where to?"), pinned on the map and
// minimap, and usable as a destination. Positions are real intersections / waterfront points checked to be walkable ground.
export const ZONES = [
  { id: "crossroads", name: "The Crossroads", x: 0, y: -5, sub: "Times Square · Stunt Park, ramps and things to smash", kw: "times square stunt crossroads ramps ball drop" },
  { id: "broadway", name: "Broadway Theater District", x: 0, y: 314, sub: "Taxi rush · fares between the theatres", kw: "broadway theater theatre taxi fares crazy" },
  { id: "backstreets", name: "Hell's Kitchen Backstreets", x: -823, y: 75, sub: "Street races and time trials on the long avenues", kw: "hell's kitchen race racing drift avenue time trial need for speed" },
  { id: "hudson", name: "Hudson River Park", x: -1400, y: -300, sub: "Waterfront · boats and the sunset", kw: "hudson river park pier boat waterfront sunset" },
  { id: "rooftops", name: "Midtown Rooftops", x: 584, y: -249, sub: "Parachute down onto the towers", kw: "rooftop parachute skydive jump towers" },
  { id: "eastrun", name: "Midtown East Run", x: 739, y: 394, sub: "Heat: cruisers, roadblocks and bikes", kw: "heat police chase escape wanted cruisers east" },
  { id: "parkgate", name: "The Park Gate", x: 273, y: 631, sub: "Explore and collect the city's spots", kw: "central park gate explore collect photo postcards" },
];

// add the zones to search and to the map (once the map data has loaded)
export function addZones(nav, datasets) {
  for (const z of ZONES) {
    if (nav.places.some(p => p.id === "zone_" + z.id)) continue;
    nav.places.push({ id: "zone_" + z.id, name: z.name, sub: z.sub, kind: "landmark", keywords: z.kw, x: z.x, y: z.y, eye: [z.x - 20, z.y - 40, 9], target: [z.x, z.y, 2], zone: true });
  }
  const markers = ZONES.map(z => ({ id: "zone_" + z.id, icon: "star", label: z.name, x: z.x, y: z.y, minS: 0.2 }));
  for (const d of datasets) if (d && !d.markers.some(m => m.id === "zone_crossroads")) d.markers.push(...markers);
}
