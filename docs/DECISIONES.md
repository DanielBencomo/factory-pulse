# FACTORY PULSE — REGISTRO DE DECISIONES DE ARQUITECTURA (ADR)

---

## ADR 01: Persistencia Local en SQLite con Backend como Fuente de la Verdad
- **Decisión:** Usar SQLite local mediante SQLAlchemy asíncrono (`aiosqlite`).
- **Justificación:** Cumple con la restricción de despliegue 100% en borde (*on-premise*) sin requerir servicios en la nube durante el hackathon. Los datos operativos jamás se almacenan exclusivamente en `localStorage` del navegador.
- **Consecuencias:** Idempotencia, portabilidad total y capacidad de respaldar o reiniciar datasets con un único comando o archivo `.db`.

---

## ADR 02: Desacoplamiento de Módulos (8 Familias con Catálogo Declarativo)
- **Decisión:** Implementar un registro declarativo con estados de disponibilidad: `active`, `simulated`, `needs_device` y `experimental`.
- **Justificación:** En un hackathon de 12-15 horas, el equipo de software debe poder demostrar la plataforma completa sin bloquearse si faltan sensores físicos específicos (como lectores UHF o anclas UWB).
- **Consecuencias:** Claridad para el jurado e ingenieros de planta: los módulos sin sensor están claramente rotulados como *needs_device*, evitando afirmaciones falsas.

---

## ADR 03: Descarte de Dispositivos Wearables
- **Decisión:** Excluir formalmente relojes inteligentes, pulseras biométricas y anillos para operadores.
- **Justificación de Seguridad Industrial:** Las normas de seguridad en maquiladoras y líneas de maquinado prohíben joyería y accesorios por alto riesgo de atrapamiento mecánico (*pinch points* en bandas transportadoras y motores).
- **Consecuencias:** Se prioriza la visión cenital anónima y los botones fijos en estación.

---

## ADR 04: Privacidad en Sanitarios y Zonas de Descanso
- **Decisión:** Delimitar sanitarios como zonas agregadas exclusivas (`is_aggregated_only = True`), reportando solo conteo de ocupación y tiempo acumulado grupal sin rastreo individual de `track_id` ni cámaras.
- **Justificación:** Respeto estricto a los derechos laborales y privacidad de los trabajadores.

---

## ADR 05: Cálculo Matemático Estricto de Unión de Intervalos y Universo Temporal
- **Decisión:** Implementar algoritmo de unión de intervalos ordenados para deducir paros autorizados.
- **Justificación:** Si dos paros se solapan (ej. paro de línea y paro de estación al mismo tiempo), sumar sus duraciones directamente descontaría tiempo de forma doble e inflaría artificialmente la disponibilidad.
- **Consecuencias:** Conservación estricta del universo: $T_{planificado} = T_{ajustado} + \bigcup T_{paros}$ y $T_{ajustado} = T_{prod} + T_{espera} + T_{ausente} + T_{desconocido}$.

---

## ADR 06: Honestidad en OEE y Wi-Fi CSI
- **Decisión:** No llamar "OEE" a un indicador que solo mide disponibilidad; etiquetarlo como "Disponibilidad Operativa Parcial".
- **Decisión 2:** Documentar Wi-Fi CSI únicamente como detector de presencia/movimiento experimental, sin venderlo como radar centimétrico de coordenadas X,Y.
