# Etapa 2 · Contrato de evidencia

| Indicador | Evidencia mínima | Sin evidencia |
|---|---|---|
| Detecciones actuales | Conteo explícito de un cuadro decodificado recientemente; `0` es válido | `null` / «—» |
| Detecciones por zona | Conteo explícito para esa zona; un contador externo que afirme cobertura puede reportar cero | Que una cámara no mande una zona no significa que esté vacía |
| Trayectoria y metros | Posiciones de una cámara con `coordinate_space: "floor"` y revisión activa; ancho y largo del plano para convertir a metros | Sin trayectoria de piso o sin dato en metros |
| Estado de estación | Presencia y telemetría vigentes; ausencia requiere evidencia local negativa | «Sin dato» o «Presente sin dato de proceso» |
| Piezas y calidad | Pulsos válidos para piezas; sólo se incluyen en el porcentaje los pulsos con calidad explícita y verificada | No se infiere cero piezas ni 100% de calidad |

La cámara usa el momento de decodificación en la PC, no la hora del POST.
La actualidad de la ocupación es de 12 s por defecto. Esto no mide latencia
extremo a extremo ni corrige el reloj de cada equipo.

El proveedor administrado envía `coordinate_space: "floor"` y
`calibration_revision`. Los datos sin revisión confiable o de una revisión
sustituida se conservan en SQLite, pero se excluyen de la analítica de piso.
El total de detecciones sigue disponible sin proyección. Los proveedores
externos no aportan geometría verificada por ese mecanismo.
La cobertura publicada es temporal: no prueba cobertura física, y varios
ángulos pueden contar la misma persona. Distancias y permanencias son
estimaciones que todavía requieren validación en campo.

`/api/metrics` conserva el estado actual y devuelve `null` para los indicadores
legados sin base. Usa `/api/analytics` para ventanas operativas y
`/api/spatial/summary` para ventanas espaciales. El ritmo reportado divide
los pulsos de piezas entre la duración de la ventana; no es tasa extrapolada
ni garantiza que todos los pulsos llegaron. Para calidad, envía
`quality_observed: true` e `is_good_piece` sólo desde una fuente de inspección;
el pulsador y el pulso de ciclo de referencia no son inspecciones.
No se reporta OEE sin sus tres componentes medidos con el mismo calendario.
