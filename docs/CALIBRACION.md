# Etapa 3 · Calibración de cámara a planta

## Contrato

- `Layout` define ancho y largo físicos. Cada cámara administrada guarda
  una revisión vinculada a ese marco. Coordenadas internas: X/Y normalizadas
  en el plano, convertidas a metros usando ancho para X y largo para Y.
- El ajuste se hace con cuatro anclas en orden de perímetro. La desviación
  se calcula con controles independientes no usados para ajustar la matriz.
  Hay validación de forma, límites, estabilidad, vigencia de captura y error.
- El tablero proyecta polígonos con el backend. El proveedor usa esa misma
  matriz y publica la revisión junto con XY y conteos atribuidos a zonas.
  Las detecciones en imagen no necesitan calibración.
- Al recalibrar, cambiar de fuente o modificar dimensiones, las lecturas de
  las revisiones anteriores dejan de aparecer en el historial visible y en
  las métricas espaciales. Los eventos originales no se borran.
- Un cambio de resolución proporcional mantiene la proyección. Uno de
  proporción detiene la proyección mientras el formato sea incompatible.
  Si el movimiento, el zoom o el recorte conservan la misma proporción,
  invalida la calibración manualmente y vuelve a medir.

## Auditoría de cambios

| Riesgo revisado | Control aplicado |
|---|---|
| Validación circular con las mismas cuatro esquinas | Control independiente y tolerancia en metros |
| Píxeles atados a una resolución concreta | Homografía en coordenadas adimensionales y validación de proporción |
| Geometría fuera de la región medida | Se limita la proyección a la huella de las anclas |
| Puntos ajustados con una revisión pero guardados con otra | El editor envía la revisión al proyectar y al guardar; la API rechaza referencias obsoletas |
| Reinterpretación de historiales al editar el plano | Cambiar dimensiones genera una revisión nueva, incluso si luego se restauran los valores |
| Escala única en un piso rectangular | Conversión por eje; se retira el control independiente de escala |

Se verificaron compilación del tablero, cálculos geométricos y rutas de API
con una SQLite temporal y proveedor local de imágenes en memoria, sin agregar
simuladores ni suites de pruebas al repositorio. Queda pendiente la precisión
con cámara fija y puntos medidos físicamente: esta etapa no valida la exactitud
de mapas de calor ni corrige automáticamente distorsión de lente u oclusiones.
