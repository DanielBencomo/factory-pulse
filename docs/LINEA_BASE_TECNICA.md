# Etapa 1 · Línea base técnica

## Verificado

- Python 3.12 y Node.js 24: arranque de FastAPI con una SQLite temporal y
  compilación TypeScript/Vite tras instalar con `npm ci`.
- REST y WebSocket a través del proxy de Vite, en loopback. Los eventos,
  dispositivos, cámaras, zonas y estaciones arrancan vacíos. El plano mínimo
  no se marca como calibrado y la cobertura espacial inicial es cero.
- No se exponen rutas de simulación, cambio de modo ni reproducción.
  Se conserva el discriminador de los registros antiguos para excluir eventos
  no operativos. No se borra la base SQLite anterior.
- Los perfiles configurados apuntan a YOLO 11n/11s/11m y ByteTrack.
  Las dependencias directas se fijaron; el entorno de visión, sus pesos y
  PyTorch CPU/GPU quedan por verificar con una cámara física.

## Riesgos priorizados

| Prioridad | Hallazgo | Siguiente paso |
|---|---|---|
| Bloqueante para cierre | Sin flujo RTSP físico verificado; FPS, latencia y recuperación no medidos | Validar en LAN con teléfono y PC |
| Alta · geometría | Escala del plano y homografía de cada cámara son configuraciones separadas; las coordenadas de imagen sin calibración no validan distancias ni zonas | No usar mapas ni distancias para decisiones hasta validar contra puntos físicos |
| Alta · trazabilidad | ByteTrack asigna IDs temporales por cámara; no deduplica personas entre cámaras ni garantiza continuidad fuera del cuadro | Medir cortes e intercambios de ID; probar inicialmente con una cámara |
| Alta · operación | La API está pensada para red de confianza; el alcance de RFID y sus lecturas extremo a extremo no se verificaron | Aislar red y validar lector por separado antes del piloto |
| Media · mantenimiento | El proveedor concentra captura, tracking, publicación y render; Vite advierte de un paquete grande en Métricas | Separar componentes cuando haya una línea base de campo |

## Validación pendiente con el teléfono

1. Fija el teléfono y conéctalo a la misma red que la PC. Registra RTSP en
   **Cámara → Agregar cámara** y activa el perfil Equilibrado.
2. Abre `/api/cameras/<ID>/health`. Confirma `ready`, `backend_ok`, fecha
   reciente en `updated_at` y el modelo y tracker que realmente se cargaron.
3. Con video anotado, haz un recorrido corto y confirma un recuadro y un ID
   en condiciones normales. Apaga el stream y vuelve a encenderlo, sin
   reiniciar Factory Pulse. Registra FPS, tiempo de recuperación y cualquier
   error. Para latencia extremo a extremo, compara una acción visible en vivo
   con su aparición en el dashboard; no uses `updated_at` como tiempo de cámara.
4. Con la cámara fija y calibrada, verifica que aparecen posiciones reales
   en `/api/events?type=position` y en el plano. La exactitud de zonas, mapas
   de calor y recorridos requiere medición aparte.
