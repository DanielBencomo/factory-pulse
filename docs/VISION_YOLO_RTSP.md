# Visión YOLO + ByteTrack + RTSP

Esta rama restaura la detección de personas en el video y mantiene el resto de
Factory Pulse (dashboard, RFID, CSI, simulador y API) desacoplado. El proveedor
de visión es un proceso Python independiente:

1. recibe webcam, archivo, HTTP/MJPEG o RTSP;
2. detecta exclusivamente la clase `person` con Ultralytics YOLO;
3. conserva un ID temporal mediante ByteTrack;
4. usa el centro inferior del bounding box como posición de los pies;
5. proyecta esa posición al plano mediante una homografía opcional;
6. publica X/Y en el endpoint existente `/api/events/batch`;
7. expone video anotado y limpio al backend, que los publica por ID de cámara.

No hay reconocimiento facial. El proceso no graba video y las URLs RTSP se
muestran con las credenciales ocultas en los logs.

## Puertos

| Puerto | Proceso | Uso |
|---|---|---|
| 8000 | FastAPI | API, eventos y WebSocket |
| 8101–8199 | Proveedores de visión | Puertos internos asignados automáticamente |
| 3000 | Vite | Dashboard |

## Instalación

Desde la raíz del repositorio en PowerShell:

```powershell
py -m venv .venv-vision
.\.venv-vision\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r hardware\vision_requirements.txt
```

La primera ejecución con `yolo11n.pt` puede descargar los pesos del modelo.
Ultralytics selecciona CPU/GPU automáticamente; se puede forzar CPU con
`--device cpu`.

## Registro y arranque administrado

FastAPI administra las fuentes registradas en **Cámara**. Cada registro conserva
tipo, URL sin credenciales, usuario, contraseña cifrada, transporte, perfil
YOLO y archivo de calibración. El navegador consume rutas `/api/cameras/{id}` y
ya no conoce ni depende de un puerto de visión fijo.

El backend detecta automáticamente `.venv-vision` en la raíz. Si el entorno se
encuentra en otro lugar, defina `VISION_PYTHON` con la ruta completa del
intérprete antes de iniciar FastAPI.

## Arranque completo

Terminal 1 — backend en modo real:

```powershell
cd backend
$env:START_MODE="live"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Terminal 2 — dashboard:

```powershell
cd frontend
npm install
npm run dev
```

Abra `http://localhost:3000`. En **Cámara → Agregar cámara** registre una webcam,
RTSP, HTTP/MJPEG o un proveedor existente. FastAPI inicia un proceso por fuente,
elige un puerto libre y el videowall muestra todas las cámaras. Cada tarjeta
permite alternar entre video limpio y anotado. **Planta** conserva el plano 2D
como vista principal.

## Teléfono como cámara RTSP

1. Conecte teléfono y laptop a la misma red Wi-Fi.
2. En la aplicación de cámara RTSP del teléfono, inicie el servidor.
3. Copie la URL que muestra la aplicación. Suele tener una forma como
   `rtsp://192.168.1.50:8554/live`.
4. Verifique primero que OpenCV puede leerla:

```powershell
python hardware\local_vision_provider.py `
  --source "rtsp://192.168.1.50:8554/live" `
  --probe-source
```

5. Si la prueba responde `first_frame_ok: true`, capture IP, puerto, ruta y
   credenciales en **Cámara → Agregar cámara**, seleccione un perfil y guarde.

No guarde una URL con usuario o contraseña en Git. Escríbala sólo en la línea de
comandos local. Si TCP entrega demasiada latencia en una red estable, pruebe
`--rtsp-transport udp`.

El proveedor espera y reintenta la conexión si el teléfono está apagado al
arrancar o se corta durante la transmisión (`--reconnect-attempts 0`, valor
predeterminado). `--probe-source` hace un solo intento para dar un diagnóstico
rápido. El dashboard marca la visión como desconectada cuando deja de recibir
cuadros recientes y recupera el video cuando vuelve la señal.

También se aceptan:

```powershell
# Segunda cámara USB
python hardware\local_vision_provider.py --source 1

# Archivo de prueba; vuelve a empezar al terminar
python hardware\local_vision_provider.py --source .\muestras\pasillo.mp4

# Integración sin cámara ni modelo, útil para comprobar los tres servidores
python hardware\local_vision_provider.py --source synthetic --activate-live-mode
```

## Calibración del piso y zonas

Con la cámara en su posición definitiva, seleccione cuatro puntos del piso en
este orden: superior izquierda, superior derecha, inferior derecha e inferior
izquierda.

```powershell
python hardware\local_vision_provider.py `
  --source "rtsp://192.168.1.50:8554/live" `
  --calibrate calib-planta.json `
  --plant-width 8 `
  --plant-height 5
```

Después escriba `calib-planta.json` en **Archivo de calibración** al registrar o
editar esa cámara. El backend lo pasa únicamente al proveedor correspondiente.

El proveedor consulta `/api/zones`. Con una calibración válida proyecta los
polígonos editados en el dashboard sobre el video. Sin calibración, todavía hay
detección y tracking, pero X/Y representan la imagen normalizada y no deben
interpretarse como metros del piso.

### Dibujar departamentos sobre una captura

Con la cámara registrada y el archivo de calibración cargado, abra
**Cámara → Mapear áreas**:

1. pulse **Nueva captura** si desea congelar otro instante;
2. elija *Zona / departamento* o *Línea completa*;
3. marque al menos tres vértices siguiendo el piso visible;
4. asigne nombre, tipo, línea, estación y capacidad;
5. active *Solo conteo agregado* en áreas sensibles y guarde.

El navegador envía los puntos a `/vision/map-points`; el proveedor aplica la
homografía y FastAPI guarda el resultado normalizado. Los accesos sanitarios se
fuerzan siempre a modo agregado, aunque se desmarque la opción.

## Spaghetti sin saturación visual

La vista de cámara no dibuja trayectorias por defecto: conserva bounding boxes,
IDs y zonas legibles. El spaghetti completo se dibuja en el plano independiente.
Controles de las ventanas OpenCV:

| Tecla | Acción |
|---|---|
| `N` | Seleccionar la siguiente persona |
| `A` | Volver a todas las personas |
| `Z` | Recorrer filtros por zona/área |
| `R` | Reiniciar trayectorias locales |
| `V` | Activar/desactivar spaghetti sobre la cámara |
| `Q` o `Esc` | Salir |

Esto permite revisar una persona o una línea/área sin mezclar el spaghetti de
toda la planta. El dashboard sigue almacenando las posiciones anónimas en el
backend para sus métricas y filtros.

Las zonas marcadas `is_aggregated_only` no generan una trayectoria individual:
se muestra presencia anónima, pero se suprime el ID y no se publica la posición
individual dentro de esa zona.

## Endpoints del proveedor

| Ruta | Contenido |
|---|---|
| `/vision/health` | Estado, FPS, tracks, zonas y calibración |
| `/vision/annotated.mjpg` | Cámara con detecciones y zonas |
| `/vision/raw.mjpg` | Cámara limpia sin overlays |
| `/vision/floor.mjpg` | Plano 2D y spaghetti |
| `/vision/snapshot.jpg` | Último cuadro anotado |
| `/vision/floor.jpg` | Último cuadro del plano |
| `POST /vision/map-points` | Cámara ↔ plano mediante la homografía cargada |

Los procesos administrados escuchan sólo en `127.0.0.1`; el backend retransmite
estado, snapshot, proyección y video mediante `/api/cameras/{id}/...`. Así, Vite
solo necesita acceso a FastAPI.

## Diagnóstico rápido

- **Se ve video, pero no hay recuadros:** revise el modelo y perfil en la tarjeta;
  suba iluminación y pruebe Equilibrado o Alta precisión.
- **Hay recuadros, pero no aparecen tracks en el plano:** el dashboard debe estar
  en **En vivo**; use `--activate-live-mode` y revise `/vision/health`.
- **No aparecen zonas sobre la cámara:** hace falta `--calib` y al menos una zona
  válida en `/api/zones`.
- **RTSP tarda o se corta:** pruebe primero `--probe-source`, use TCP, acerque el
  teléfono al punto de acceso y reduzca la resolución en la app del teléfono.
- **Un proveedor no inicia:** revise el mensaje de la tarjeta y
  `runtime/camera-<id>.log`; confirme que `.venv-vision` existe o configure
  `VISION_PYTHON`.
- **Varias personas intercambian IDs:** evite cruces totalmente ocluidos, use un
  ángulo más alto y buena iluminación. ByteTrack mejora persistencia, pero una
  sola cámara no garantiza reidentificación después de una oclusión prolongada.
