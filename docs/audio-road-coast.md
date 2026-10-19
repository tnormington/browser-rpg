# Audio: the road and the coast (HOM-51)

## Shipped
- `coast-ambience.ogg` (Saltmarrow): sea wash. `road-ambience.ogg` (Greywater Road): wind and birds. 20 s seamless loops, ~135 KB each.
- `sfx.ts` exports `setAmbience(regionId | null)`: crossfades (1.5 s) to the bed for that region, none for regions not in `AMBIENCE`. Hale's Rest and the cave stay bare.

## Needs wiring (Game Engineer)
- In `main.ts`, call `setAmbience(regionAt(player.x, player.z)?.id ?? null)` when the player's region changes, and once at start. Positional: no. Loops: yes (handled in sfx).

## Not shipped, and why (kept honest: no new files without a trigger)
The sim emits no fishing, cooking or flight events yet, and enemy-specific events carry no species, so nothing to hang them on. Planned reuse of existing files, no new downloads needed:
| Event wanted | Sound | Notes |
|---|---|---|
| `fish` cast | `swing-2` rate 0.7, vol 0.3 | a line whipping out |
| `fish` catch | `loot` | Saltmarrow catch |
| `cook` finish | Kenney RPG Audio `metalPot1/2` (CC0, add when the event exists) | the range |
| `flight` start | `levelup` rate 0.8 + a wind rise (reuse `road-ambience` louder for the ride) | |
| new enemies | existing `hit-flesh`/`hurt`/`slam` already cover them by event; species voices would need `hit`/`telegraph` events to carry the enemy `type` (Systems Designer) | `shore_crab`, `barnacle_ogre` could play `hit-crit` / `slam` at lower rate |

Could not verify by ear: loop seams, relative loudness of beds against the footsteps (vol 0.35/0.4 is a guess; tune in `AMBIENCE`).
