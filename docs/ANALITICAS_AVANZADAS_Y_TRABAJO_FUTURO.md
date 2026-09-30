# Analíticas avanzadas y trabajo futuro

## Propósito

Factory Pulse organiza las analíticas por la pregunta que ayudan a responder, no por el sensor que las produce. En **Métricas → Analíticas** cada usuario puede activar módulos individuales o elegir una vista rápida:

- **Supervisor:** estado, salida, cuello de botella, calidad y paros.
- **Ingeniería industrial:** ocupación, movimiento, rutas, distancia y permanencia.
- **Balanceo:** tiempo por estado, ritmo, cuello y ocupación.

La selección queda guardada en el navegador. Esto evita convertir el tablero en una pared de indicadores: NIST advierte que tanto la falta como el exceso de información pueden ralentizar el proceso, y recomienda priorizar KPIs según el área funcional y la decisión.

## Niveles de evidencia

Cada indicador debe distinguir uno de estos niveles:

| Nivel | Significado | Ejemplos |
|---|---|---|
| **Observado** | El sensor o sistema fuente lo reportó. | posición X/Y, ocupación, ciclo, pieza buena, paro declarado |
| **Inferido** | Una regla documentada lo calcula a partir de observaciones. | quietud, transición, cuello de botella, congestión, estado de estación |
| **No disponible** | Faltan datos indispensables; se muestra `—`, nunca una estimación silenciosa. | OEE completo sin calendario, WIP sin identidad de pieza, MTBF sin fallas |

Todas las ventanas informan **cobertura** y **frescura**. Un conteo vencido se muestra como desconocido, no como cero.

## Analíticas implementadas

### Flujo, espacio y layout

| Analítica | Definición resumida | Decisión que apoya | Límite principal |
|---|---|---|---|
| Ocupación actual | Conteo agregado más reciente dentro del tiempo de vigencia | supervisión de presencia por área | `—` si el dato ya no es reciente |
| Ocupación promedio | persona-segundos / segundos observados | dimensionar área y comparar turnos | depende de cobertura válida |
| Pico de ocupación | máximo conteo observado | validar capacidad y seguridad | un pico aislado no implica congestión sostenida |
| Persona·minuto | suma de ocupación × duración / 60 | carga humana acumulada por zona | no identifica la actividad realizada |
| Zona ocupada | porcentaje de tiempo válido con al menos una persona | utilización espacial | no equivale a utilización productiva |
| Densidad pico | pico de personas / área calibrada en m² | detectar espacios apretados | requiere homografía y dimensiones correctas |
| Exposición a congestión | segundos sobre capacidad y exceso persona·minuto | priorizar cruces o esperas para revisar | la capacidad debe configurarse y validarse |
| Movimiento / quietud / desconocido | composición de persona-tiempo por velocidad | observar tránsito, espera o cobertura insuficiente | quietud no significa improductividad |
| Visitas por hora | entradas agregadas / horas observadas | revisar surtido, búsqueda o secuencia | zonas sensibles nunca publican visitas individuales |
| Distancia agregada | suma de segmentos válidos con filtro de jitter y velocidad | comparar alternativas de layout | no es comparable en metros sin calibración |
| Distancia por persona·hora | distancia / persona-horas observadas | normalizar turnos con distinta dotación | requiere al menos un minuto-persona |
| Rutas principales | conteo agregado de transiciones zona A → zona B | from-to y abastecimiento | no publica secuencias ni IDs |
| Concentración de ruta | transiciones de la ruta más usada / transiciones totales | saber si pocos corredores dominan el flujo | no mide por sí sola eficiencia |
| Diversidad de rutas | entropía normalizada de transiciones | comparar flujo estable vs. disperso | sensible a ventanas pequeñas |
| Retorno inmediato | proporción de transiciones A → B → A | localizar idas y vueltas a investigar | una devolución puede ser parte correcta del proceso |
| Utilización de zonas | zonas públicas con persona·minuto / zonas públicas configuradas | encontrar áreas nunca observadas | depende de que el layout esté completo |

Las secuencias se cortan al entrar a una zona sensible, por lo que no se puede inferir una visita privada a partir de una transición aparente entre dos zonas públicas.

### Operación y proceso

| Analítica | Estado actual | Datos requeridos |
|---|---|---|
| Cronología de estación | implementada | presencia + marcha/ciclo + paros |
| Reparto productivo/espera/presente/ausencia/paro/sin datos | implementada | presencia; proceso para afirmar productivo o espera |
| Piezas por hora y salida vs. meta | implementada | eventos de ciclo y meta de estación |
| Cuello de botella observado | implementada | ritmo medido por estación |
| Calidad por estación | implementada cuando hay dato | ciclo con resultado bueno/rechazado |
| Pareto de paros | implementada | inicio, fin y causa de paro |
| Comparación con periodo anterior | implementada en KPIs principales | dos ventanas equivalentes con cobertura |

## Observaciones automáticas explicables

El backend genera tarjetas con cuatro campos separados:

1. **observación:** qué patrón se detectó;
2. **evidencia:** cifras y ventana que lo sustentan;
3. **siguiente revisión sugerida:** una comprobación humana;
4. **alcance/capa:** la zona y visualización que debe abrir el mapa.

Reglas actuales: cobertura insuficiente, capacidad superada, quietud en apoyo o tránsito, visitas repetidas a materiales, retornos A→B→A, zona con mayor permanencia y ausencia de sobrecapacidad configurada. Ninguna regla atribuye culpa, causa raíz o productividad personal.

## Trabajo futuro priorizado

### P0 — Convertir medición en una línea base confiable

1. **Calendario de turno y demanda por producto.** Guardar inicio/fin, descansos, tiempo planificado, SKU y demanda. Con ello se puede calcular takt de forma trazable y comparar salida con demanda real.
2. **Versionado del layout y calibración.** Guardar vigencia de cada plano, cámara, homografía, capacidad y zona. Sin versiones, una mejora de layout rompe la comparación histórica.
3. **Calidad de datos por fuente.** Medir pérdida de cuadros/eventos, latencia, FPS, continuidad, solapamiento de cámaras y porcentaje de observaciones no asignadas.
4. **Líneas base por contexto.** Comparar mismo producto, turno, dotación y ventana; usar percentiles y bandas, no umbrales universales.

### P1 — KPIs industriales que requieren nuevas señales

| Valor futuro | Qué aportaría | Datos nuevos indispensables | Sensor/sistema posible |
|---|---|---|---|
| Takt real | ritmo necesario para cubrir demanda | demanda, tiempo neto disponible, producto | ERP/MES o captura manual aprobada |
| WIP | unidades entre operaciones | identidad o conteo de pieza por punto | UHF, código de barras, visión de pieza, PLC |
| Tiempo de flujo | entrada → salida por unidad/lote | `case_id`, entrada, salida y ruta | RFID/UHF, MES, lectores de código |
| Tiempo de ciclo por producto | variación y estabilidad | SKU, inicio/fin de operación | PLC/ESP32 de ciclo + orden |
| First Pass Yield y retrabajo | calidad a la primera | pieza, resultado, defecto, reingreso | estación de prueba/MES |
| OEE completo | disponibilidad × rendimiento × calidad | calendario planificado, run time, total/buenas, ciclo ideal validado | PLC/MES/calidad |
| MTBF / MTTR | confiabilidad y mantenibilidad | falla real, reparación, recuperación, activo | CMMS/PLC/andon con causa |
| Bloqueo y falta de material | pérdida por balance o buffer | nivel de buffer + estado aguas arriba/abajo | fotoeléctrico, ToF, PLC |
| Costo de manejo | frecuencia × distancia × carga | origen/destino, tarea, material, peso/costo | UHF en carros, WMS, app de surtido |
| Energía por pieza | costo y sostenibilidad | kWh por activo + piezas buenas | medidor Modbus/CT + ciclo/calidad |

No se debe llamar **OEE** al indicador parcial actual: hasta disponer de sus tres componentes con el mismo calendario, debe rotularse como disponibilidad, ritmo o calidad observada por separado.

### P2 — Analítica de secuencia y optimización

- **From-to ponderado:** frecuencia de movimientos × distancia × costo/carga para comparar escenarios de layout.
- **Process mining y conformidad:** descubrir rutas reales y compararlas con la secuencia esperada usando `case_id`, actividad y timestamp. Antes de habilitarlo se debe aplicar minimización, retención y evaluación de reidentificación del event log.
- **Control estadístico de proceso:** cartas y alertas de estabilidad por producto/lote; requiere valores continuos, contexto y reglas de cambio de modelo.
- **Detección de cambio:** identificar si la distribución de recorridos, ciclo o ocupación se desplazó después de una acción de mejora.
- **Simulación de layout:** usar la matriz from-to y restricciones para comparar “qué pasa si” antes de mover equipo.
- **Fusión multicámara anónima:** homografías por cámara, zonas de solapamiento y continuidad temporal para evitar doble conteo. No requiere rostro, pero sí una política explícita de ID efímero y borrado.
- **Ergonomía observacional:** postura/riesgo con pose anónima solo si existe una finalidad de seguridad, validación humana y gobernanza laboral; debe mantenerse separado de evaluación individual de desempeño.

## Criterios para aceptar una analítica nueva

Una analítica entra al dashboard solo si cumple todo lo siguiente:

1. responde una pregunta y tiene un usuario/decisión definidos;
2. publica fórmula, unidad, ventana, alcance y fuente;
3. informa cobertura, frescura y dato faltante;
4. se valida contra observación manual o fuente de referencia;
5. evita causalidad no demostrada y lenguaje de desempeño personal;
6. tiene límites de privacidad, retención y acceso;
7. puede desactivarse desde el selector del usuario.

## Referencias de diseño

- [ISO/DIS 22400-2 — KPIs para manufacturing operations management](https://committee.iso.org/cms/live/live/en/sites/isoorg/contents/data/standard/08/75/87563.html)
- [ISO/TR 22400-10:2018 — adquisición práctica de datos para KPIs](https://www.iso.org/standard/71283.html)
- [NIST — Assessment of Real-Time Factory Performance](https://www.nist.gov/publications/assessment-real-time-factory-performance-through-application-multi-relationship)
- [NIST — A Method for KPI Assessment in Manufacturing Organizations](https://www.nist.gov/publications/method-key-performance-indicator-assessment-manufacturing-organizations)
- [NIST — Inventory and Flow Time in the US Manufacturing Industry](https://www.nist.gov/publications/inventory-and-flow-time-us-manufacturing-industry)
- [MIT OpenCourseWare — Lean Thinking, takt y Little’s Law](https://ocw.mit.edu/courses/16-660j-introduction-to-lean-six-sigma-methods-january-iap-2012/resources/mit16_660jiap12_1-3part2/)
- [An IoT-Enriched Event Log for Process Mining in Smart Factories](https://arxiv.org/abs/2209.02702)
- [Quantifying the Re-identification Risk of Event Logs for Process Mining](https://arxiv.org/abs/2003.10707)

