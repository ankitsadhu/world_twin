# Directions (multi-mode, like a maps app)

`viewer/js/trip.js`. You can open it from:
- **⚑ Directions** on any place's map card;
- a harbour place in the cab's **Where to?** list.

## The ways to travel

| Mode | Where it goes | Speed used for times |
|---|---|---|
| 🚶 Walk | anywhere on land, including the piers (and the Intrepid's deck via its elevator) | 1.4 m/s |
| 🚕 Self-driving cab | Midtown's streets (the harbour has no road network yet) | 7 m/s door to door, +2 min pickup |
| ⛴ The Hudson Sightseer | from Pier 83, you take the helm down the Hudson and into the Upper Bay | ~9.5 kn |
| ✈ The Cessna | off the Intrepid; a sightseeing flight that lands back on the carrier | 46 m/s |

**Options per destination**, fastest first:
- **Midtown places:** Cab, or Walk.
- **Harbour places:**
  - **Cab + boat:** a cab (or a walk, if under 600 m) to Pier 83, board, follow the blue line, tie up, go ashore, walk.
  - **Cab + plane:** to the Intrepid, the elevator to the flight deck, fly over the place, fly back and land.

Each option lists its legs with distance and time.

**Landings:**
- For each harbour place, the boat lands at the nearest straight pier face or seawall at least 30 m long, whichever has open water in front of it. Liberty Island's ferry dock is part of its shoreline in the city's data, so seawalls count too.
- The helm's **Tie up** uses the same faces.

**Water route:** Pier 83, out into the river, then down the middle of the widest open water at every 250 m of the way, then to the landing. It's checked to stay on water the whole way: the route to Liberty Island is 40 points and about 12.9 km.

## Guiding

**Start** shows a step bar ("Step 2 of 4 · Walk onto Pier 83 and board…") with **Steps** and **End trip**. Each step sets the waypoint beacon, and the boat leg draws its route in blue on the minimap and the full map. Steps advance by themselves:

| Leg | Done when |
|---|---|
| Cab or walk to the hub | you're on foot near Pier 83 / the Intrepid, or already aboard |
| Board | you've taken the helm / boarded the plane |
| Boat | you've gone ashore. Near the landing you're told to come alongside slowly and tie up |
| Ashore | you're within 120 m of the place: "You've arrived" |
| Fly over | you're within 500 m of it |
| Fly back | the plane is back on the deck |

- **The boat waits for you:** when a boat trip starts and the Sightseer is out on her cruise, she's put back at her berth if she's far from you, and held there for up to 30 min.
- **Honest about reality:** every harbour place shows how you'd really get there in New York (subway lines, Statue City Cruises from The Battery, PATH, NY Waterway). The plane option says plainly that the real Intrepid is a museum.

## Harbour on foot

- **Walking:** outside Times Square's area, the harbour's land and piers are solid ground and its water blocks you. Past the harbour's edge there's nothing to walk on.
- **Liberty Island:** Fort Wood has its sally port, the entrance passage, so you can walk in to the foot of the Statue's foundation.
- **Step-ups:** walking steps up at most 1.35 m (a pier deck is 1.2 m), so parked aircraft, ledges and the fort's walls block you.
