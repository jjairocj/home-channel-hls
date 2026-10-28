# 04. Programming Grid, Slots & Rules

Linear television stations structure their broadcast day using fixed scheduling grids. Home Channel HLS provides an automated rule compiler and drag-and-drop schedule planner.

---

## The 30-Minute Broadcast Slot

The day is divided into 48 discrete 30-minute blocks (00:00 to 23:30). If an episode exceeds 25 minutes, it can automatically span a 60-minute double slot.

```
+-------------------------------------------------------------+
|                     30-Minute Broadcast Slot                |
+------------------------------+------------------------------+
|   Main Episode Content       |   Automated Commercial Break |
|   (e.g., 22 minutes)         |   (Remaining 8 minutes)      |
+------------------------------+------------------------------+
```

---

## Programming Modes & Profiles

1. **Sequential Mode (`series`):**
   - Broadcasts the next episode in order.
   - When all episodes are broadcast, it can automatically transition to the next season or loop back to Episode 1.
2. **Weekend Marathon (`marathon`):**
   - Automatically groups and replays the episodes that premiered Monday through Friday.
3. **Episodic Random (`random` / sitcom mode):**
   - Selects episodes at random without repeating any episode until all episodes in the series have aired once.
4. **Sign-Off / Off-Air:**
   - Shuts down programming with a customized station sign-off video or color test bars during overnight maintenance windows.

---

## Rule Compilation System

Rules allow defining schedules declaratively:
- *"Show Alpha, Monday through Friday at 20:00 (Slot 1)"*
- *"Classic Sci-Fi, Saturdays at 21:00 (2 Slots / 1 Hour)"*

Rules are compiled into an immutable 24-hour timeline that feeds both the live playout queue and the XMLTV EPG exporter.
