# 04. Parrilla de Programación, Bloques y Reglas

Los canales lineales estructuran su transmisión mediante bloques horarios regulares. Home Channel HLS cuenta con un compilador de reglas y una interfaz interactiva de parrilla semanal.

---

## El Bloque de 30 Minutos

El día de emisión se compone de 48 bloques de 30 minutos (de 00:00 a 23:30). Si un programa supera los 25 minutos de duración, se le puede asignar un bloque doble de 60 minutos.

```
+-------------------------------------------------------------+
|                     Bloque Horario de 30 Minutos            |
+------------------------------+------------------------------+
|   Episodio del Programa      |   Tanda Comercial Automática |
|   (ej: 22 minutos)           |   (8 minutos restantes)      |
+------------------------------+------------------------------+
```

---

## Modos y Perfiles de Programación

1. **Modo Secuencial (`series`):**
   - Emite los capítulos en orden correlativo (1, 2, 3...).
   - Al terminar una temporada o saga, avanza automáticamente a la siguiente o reinicia el ciclo.
2. **Maratón de Fin de Semana (`marathon`):**
   - Agrupa los estrenos emitidos de lunes a viernes y los retransmite en bloque continuo los sábados o domingos.
3. **Modo Episódico / Al Azar (`random`):**
   - Selecciona capítulos aleatoriamente pero sin repetir ninguno hasta haber completado todos los disponibles de la serie.
4. **Cierre de Emisión / Fuera de Aire:**
   - Cortinilla de cierre o carta de ajuste durante la madrugada si se desea pausar la emisión nocturna.

---

## Compilador de Reglas

Las reglas permiten definir la parrilla con lógica declarativa:
- *"Serie A de lunes a viernes a las 20:00 (1 bloque)"*
- *"Especial de Naturaleza los domingos a las 21:00 (2 bloques / 1 hora)"*

Las reglas se compilan en una línea de tiempo continua de 24 horas que alimenta de forma idéntica tanto la emisión HLS como la guía electrónica EPG (`/epg.xml`).
