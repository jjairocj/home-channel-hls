# 05. Commercial Breaks & Bumper Rotation

A hallmark of authentic broadcast television is the pacing of commercial breaks and station bumpers. Home Channel HLS manages interstitials using an automated mathematical composer (`BlockComposer.js`) paired with an anti-repetition cooldown algorithm (`CommercialRotation.js`).

---

## Interstitial Categories & Roles

Every non-program media item has a defined broadcast role:

| Role | Name | Purpose | Example |
| :--- | :--- | :--- | :--- |
| `break_in` | Break In / Intro | Transitions out of the main show into the break | *"You're watching..."* |
| `break_out` | Break Out / Outro | Closes the break and announces the upcoming show | *"Coming up next..."* |
| `commercial` | Commercial Spot | Standard advertising or promo clip | Personal promo, sponsor spot |
| `station_id` | Station Ident | Thematic station brand identifier (10-15s) | Animated station logo |
| `filler` | Micro-Cushion | Ultra-short clips (3-8s) to close remaining time gaps | Short station sting |

---

## The Break Structure

A typical commercial break is constructed in this order:
1. **Opener:** Exactly one `break_in` bumper.
2. **Spots Pool:** 1 to N `commercial` spots, selected according to cooldown history.
3. **Thematic Ident:** An occasional `station_id` inserted into long breaks.
4. **Closer:** Exactly one `break_out` bumper immediately before the next program begins.

---

## Anti-Repetition Algorithm

To prevent viewer fatigue:
- **Deck-Based Rotation:** Clips are drawn from a cyclic rotation pool.
- **Cooling Down State:** Recently aired commercials enter a cooldown state and cannot be re-aired in the same break or consecutive blocks unless the available library is exhausted.
- **Fair Allocation:** Commercial weights and frequencies ensure both long and short clips receive balanced airtime throughout the broadcast day.
