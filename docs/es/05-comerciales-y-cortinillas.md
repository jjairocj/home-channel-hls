# 05. Pausas Comerciales y Rotación de Cortinillas

El sello de un canal de televisión profesional es la cadencia y variedad de sus cortes comerciales. Home Channel HLS gestiona estas pausas mediante un compositor matemático (`BlockComposer.js`) y un algoritmo anti-repetición (`CommercialRotation.js`).

---

## Roles y Categorías de Cortinillas

Cada clip que no es un episodio principal tiene un rol asignado:

| Rol | Nombre | Propósito | Ejemplo |
| :--- | :--- | :--- | :--- |
| `break_in` | Entrada de Corte | Abre la tanda al terminar el capítulo | *"Estás viendo..."* |
| `break_out` | Cierre de Corte | Cierra la tanda y anuncia el siguiente programa | *"A continuación..."* |
| `commercial`| Comercial / Spot | Anuncio o video promocional intermedio | Promos propias, spots |
| `station_id`| Ident de Estación | Pieza temática de marca (10-15 s) | Logo animado del canal |
| `filler` | Relleno Corto | Micro-clips (3-8 s) para cuadrar segundos sobrantes | Ráfaga breve de canal |

---

## Estructura de la Tanda

Una pausa comercial típica sigue esta secuencia:
1. **Apertura:** Exactamente una cortinilla `break_in` (*"Estás viendo..."*).
2. **Cuerpo Comercial:** 1 a N comerciales seleccionados según su historial de emisión.
3. **Ident Temático:** Un `station_id` en tandas largas con presupuesto de tiempo suficiente.
4. **Cierre:** Exactamente una cortinilla `break_out` (*"A continuación..."*) justo antes del inicio del siguiente programa.

---

## Algoritmo Anti-Repetición (Enfriamiento)

Para evitar que los mismos anuncios se repitan constantemente:
- **Rotación Cíclica (Mazo):** Los clips se barajan y emiten equitativamente.
- **Estado Enfriando:** Cada comercial emitido entra en una ventana de enfriamiento que impide que vuelva a salir en la misma tanda o en bloques consecutivos.
- **Reparto Justo:** El planificador equilibra anuncios largos y cortos para que todos reciban una exposición balanceada a lo largo del día.
