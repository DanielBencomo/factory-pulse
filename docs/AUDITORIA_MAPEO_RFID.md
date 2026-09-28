# Auditoría técnica — mapeo de planta, ocupación y RFID

Fecha: 2026-09-28  
Rama: `vision-yolo-bytetrack-rtsp`

## Resultado

La rama conserva YOLO + ByteTrack + RTSP y añade dos flujos utilizables en una
prueba de planta:

- mapeo manual de departamentos, zonas, estaciones y líneas sobre una captura
  de la cámara calibrada;
- recepción en tiempo real de lecturas RFID HF/UHF mediante un contrato estable.

El mapeo semántico automático no se implementa todavía: el usuario decide el
perímetro y la etiqueta. Esto evita prometer una interpretación de layout que no
puede validarse de forma confiable con una sola imagen.

## Cambios auditados

| Área | Resultado |
|---|---|
| Cámara | Snapshot congelado, editor de polígonos y proyección cámara ↔ piso mediante homografía |
| Layout | Alta validada de zonas y edición puntual del polígono de una línea, con auditoría y aviso WebSocket |
| Ocupación | Snapshot anónimo por cámara, conteo actual por departamento y alerta visual de capacidad |
| Privacidad | Una zona agregada no publica `track_id`; sanitarios se fuerzan a agregado |
| Spaghetti / calor | Ocultos a nivel planta para evitar saturación; filtros por línea, estación, persona y ventanas hasta 60 min |
| RFID | `POST /api/rfid/events` y `/batch`, UID/EPC, antena, RSSI, idempotencia y clave opcional |
| Firmware | El RC522 de referencia usa el nuevo adaptador sin afectar pulsadores, PIR o ciclos |
| Dashboard | Configuración del endpoint RFID, ejemplo `curl`, lectores descubiertos y conteos por área |
| Alertas | La evidencia de un dispositivo offline se serializa correctamente; ya no detiene el procesador en vivo |

## Endpoints nuevos o ampliados

| Método y ruta | Propósito |
|---|---|
| `POST /vision/map-points` | Proyectar puntos normalizados entre cámara y plano |
| `POST /api/zones` | Crear un área con validación de referencias y privacidad |
| `PUT /api/lines/{line_id}/polygon` | Delimitar una línea desde la cámara |
| `GET /api/zones/occupancy/live` | Conteos actuales por zona sin identidades |
| `GET /api/rfid/config` | Descubrir URL, autenticación y capacidad del adaptador |
| `POST /api/rfid/events` | Ingerir una lectura UID/EPC |
| `POST /api/rfid/events/batch` | Ingerir hasta 500 lecturas |

## Riesgos y límites conocidos

1. La cámara debe quedar fija después de generar la homografía. Un movimiento
   físico invalida la proyección y exige recalibrar.
2. ByteTrack mantiene IDs temporales dentro de una cámara; no existe todavía
   reidentificación confiable entre cámaras.
3. Los snapshots de varias cámaras se suman. Si sus campos visuales se traslapan,
   una persona puede contarse dos veces hasta añadir fusión multicámara.
4. El alcance y la tasa de lecturas UHF dependen del lector, antenas, potencia,
   metal circundante y SDK del fabricante. El contrato HTTP ya está preparado.
5. La detección automática de paredes, departamentos o estaciones queda como
   fase posterior y requerirá validación humana antes de guardar.

## Deuda técnica no bloqueante

- Migrar usos heredados de `datetime.utcnow()` antes de una futura versión de
  Python que lo retire.
- Dividir el bundle del frontend; el build actual funciona, pero Vite advierte
  que el JavaScript principal supera 500 kB comprimido antes de gzip.
- Diseñar fusión espacial y temporal para cámaras con solapamiento.
- Evaluar segmentación semántica asistida para sugerir polígonos, manteniendo la
  aprobación manual.

## Verificación ejecutada

- Backend: 35 pruebas aprobadas.
- Proveedor de visión: 13 pruebas aprobadas.
- Frontend: TypeScript y build de producción aprobados.
- Prueba integrada sintética: video anotado, mapeo bidireccional, publicación de
  posiciones, conteo agregado sin IDs y lectura RFID normalizada.
