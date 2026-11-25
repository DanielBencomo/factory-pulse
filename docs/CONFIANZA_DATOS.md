# Etapa 2 · Contrato de evidencia

| Indicador | Evidencia mínima | Sin evidencia |
|---|---|---|
| Detecciones actuales | Conteo explícito de un cuadro decodificado recientemente; `0` es válido | `null` / «—» |
| Detecciones por zona | Cuadro válido y polígono completo dentro del área calibrada: `0` si no hubo detecciones | Zona parcial, fuera del área o sin cuadro vigente: `null` / «—» |
| Trayectoria y metros | Dos capturas del mismo tramo, con geometría vigente y tiempo/velocidad plausibles | El espagueti se corta; el salto no suma metros ni permanencia |
| Estado de estación | Presencia y telemetría vigentes; ausencia requiere evidencia local negativa | «Sin dato» o «Presente sin dato de proceso» |
| Piezas y calidad | Pulsos válidos para piezas; sólo se incluyen en el porcentaje los pulsos con calidad explícita y verificada | No se infiere cero piezas ni 100% de calidad |

La cámara usa el momento de decodificación en la PC, no la hora del POST.
La actualidad de la ocupación es de 12 s por defecto. Esto no mide latencia
extremo a extremo ni corrige el reloj de cada equipo.

El proveedor administrado envía `coordinate_space: "floor"`,
`calibration_revision` y `zone_revision`. Sin una configuración de zonas
vigente, solo publica el total de detecciones en la imagen. El backend
valida la región calibrada y las zonas sensibles (incluido su perímetro)
antes de guardar posiciones por HTTP o MQTT. Las zonas sensibles solo
aportan conteos. Al publicar eventos por lote, se devuelven únicamente los
aceptados; un dato agregado válido no se pierde por una posición rechazada.

La revisión de zonas representa geometría y privacidad: cambiarlas excluye
del mapa los datos incompatibles. Los eventos anteriores a este contrato no
se migran al historial de piso y no se borran de SQLite. Actualiza y reinicia
backend, frontend y proveedor juntos.

El identificador de seguimiento y el del tramo son distintos. Perder la
detección, pasar por una zona sensible o reconectar el video termina el
tramo aunque el ID de seguimiento vuelva a aparecer. Si entre capturas hay
más de 2 s o la velocidad implícita excede 4.5 m/s, tampoco se dibuja ni se
suma el salto. El calor de tránsito cuenta muestras; el de permanencia
acumula el tiempo entre capturas consecutivas válidas, aproximando su
ubicación al punto medio. La ventana avanza aunque no lleguen datos.

La cobertura reportada es temporal. El polígono calibrado es un límite
geométrico, no garantía de visibilidad sin oclusiones. Una persona en zonas
solapadas puede contar en más de una, y distintos ángulos aún no deduplican.
Calibra con una cámara fija y verifica un recorrido medido, una pausa
cronometrada y una salida/reentrada antes de usar los mapas en planta.

`/api/metrics` conserva el estado actual y devuelve `null` para los indicadores
legados sin base. Usa `/api/analytics` para ventanas operativas y
`/api/spatial/summary` para ventanas espaciales. El ritmo reportado divide
los pulsos de piezas entre la duración de la ventana; no es tasa extrapolada
ni garantiza que todos los pulsos llegaron. Para calidad, envía
`quality_observed: true` e `is_good_piece` sólo desde una fuente de inspección;
el pulsador y el pulso de ciclo de referencia no son inspecciones.
No se reporta OEE sin sus tres componentes medidos con el mismo calendario.
