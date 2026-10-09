# Game positioning: vehicle contact

The city should feel playful, social and easy to share: familiar Times Square streets, bikes, taxis and memorable set pieces
can create stories players want to show friends. Vehicle contact is an arcade interaction, not a realistic injury simulator.

- **Brand-safety default:** Rough contact is off in a fresh install. The player explicitly opts in from Settings > City; `?rough`
  is a development override only. With the setting off, vehicles brake for pedestrians and NPCs do not change into hit states.
- **Non-graphic feedback:** A first hit knocks an NPC down, then they get up dazed and limp away. A separate hit while down or
  dazed fades the character out and refills the crowd elsewhere. No blood, gore, injury detail, death language or persistent
  victim state is shown.
- **Vehicle fantasy:** Cars and bikes exchange momentum, yaw and damage. A hard bike impact throws the rider; badly damaged
  vehicles smoke and are towed after the player leaves. Towing and damage are free.
- **Business boundary:** Gameplay collision never charges money. The only purchases remain property and advertising banners.

This is the project decision record for approachable, marketable vehicle contact and the Rough contact switch.

## Optional pursuit challenge

Driving players can opt into a short, fictional two-star, two-cruiser chase. The player wins by opening and holding an 85 m gap;
getting tagged ends the challenge without damage, fines, or persistent consequences. The city has no ambient wanted level,
weapons, or open-world crime progression. Police are visible, sirens play when city sound is enabled, and their cars follow
the street network.

## Repeatable aerial hook

The Cessna flight supports a visible, skill-based rooftop skydive: jump from altitude, choose a real-roof landing pad, steer the
supplied parachute through three gates, and finish with a rooftop landing. Misses remain non-graphic and quickly replayable. The
route uses designated pads where the existing city geometry alone would make a small rooftop target unclear or unreliable.
