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
7. expone el video anotado al dashboard en el puerto 8001.

No hay reconocimiento facial. El proceso no graba video y las URLs RTSP se
muestran con las credenciales ocultas en los logs.

## Puertos

| Puerto | Proceso | Uso |
|---|---|---|
| 8000 | FastAPI | API, eventos y WebSocket |
| 8001 | Proveedor de visión | MJPEG anotado y estado |
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

En Windows con una NVIDIA RTX, instala el wheel CUDA de PyTorch para que
`--device 0` use la tarjeta:

```powershell
pip install torch==2.13.0+cu130 torchvision==0.28.0+cu130 `
  --index-url https://download.pytorch.org/whl/cu130
```

Para reducir latencia, la captura RTSP lee continuamente y conserva solo el cuadro mas reciente; asi la deteccion no procesa una cola atrasada. La lectura FFmpeg tiene timeout efectivo de 3 segundos para que los cortes no bloqueen el proveedor durante 30 segundos.

Para priorizar fluidez en una camara de 1440 x 1440 usa cuadros de proceso de 640 x 640, modelo de 416 y JPEG calidad 60. Esto reduce detalle y tamano transmitido al dashboard.

## Arranque completo

Terminal 1 — backend en modo real:

```powershell
cd backend
$env:START_MODE="live"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Terminal 2 — cámara de laptop:

```powershell
.\.venv-vision\Scripts\Activate.ps1
python hardware\local_vision_provider.py `
  --source webcam `
  --api http://127.0.0.1:8000 `
  --activate-live-mode
```

Terminal 3 — dashboard:

```powershell
cd frontend
npm install
$env:FP_VISION_TARGET="http://127.0.0.1:8001"
npm run dev
```

Abra `http://localhost:3000`. El dashboard muestra el video con bounding boxes
en un panel y el plano 2D en otro. Los botones **Cámara en otra ventana** y
**Plano en otra ventana** abren cada vista por separado.

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

5. Si la prueba responde `first_frame_ok: true`, inicie el proveedor:

```powershell
python hardware\local_vision_provider.py `
  --source "rtsp://192.168.1.50:8554/live" `
  --rtsp-transport tcp `
  --width 640 --height 640 `
  --image-size 416 --jpeg-quality 60 --device 0 `
  --api http://127.0.0.1:8000 `
  --activate-live-mode
```

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

Después inicie usando el archivo:

```powershell
python hardware\local_vision_provider.py `
  --source "rtsp://192.168.1.50:8554/live" `
  --calib calib-planta.json `
  --api http://127.0.0.1:8000
```

El proveedor consulta `/api/zones`. Con una calibración válida proyecta los
polígonos editados en el dashboard sobre el video. Sin calibración, todavía hay
detección y tracking, pero X/Y representan la imagen normalizada y no deben
interpretarse como metros del piso.

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
| `/vision/floor.mjpg` | Plano 2D y spaghetti |
| `/vision/snapshot.jpg` | Último cuadro anotado |
| `/vision/floor.jpg` | Último cuadro del plano |

Por defecto escucha sólo en `127.0.0.1:8001`. Si Vite se ejecuta en otra
computadora, inicie con `--stream-host 0.0.0.0` y configure:

```powershell
$env:FP_VISION_TARGET="http://IP_DE_LA_COMPUTADORA_DE_VISION:8001"
```

## Diagnóstico rápido

- **Se ve video, pero no hay recuadros:** confirme que la terminal indica que
  cargó `yolo11n.pt`; suba iluminación y pruebe `--confidence 0.25`.
- **Hay recuadros, pero no aparecen tracks en el plano:** el dashboard debe estar
  en **En vivo**; use `--activate-live-mode` y revise `/vision/health`.
- **No aparecen zonas sobre la cámara:** hace falta `--calib` y al menos una zona
  válida en `/api/zones`.
- **RTSP tarda o se corta:** pruebe primero `--probe-source`, use TCP, acerque el
  teléfono al punto de acceso y reduzca la resolución en la app del teléfono.
- **El puerto 8001 está ocupado:** use `--stream-port 8011` y arranque Vite con
  `FP_VISION_TARGET=http://127.0.0.1:8011`.
- **Varias personas intercambian IDs:** evite cruces totalmente ocluidos, use un
  ángulo más alto y buena iluminación. ByteTrack mejora persistencia, pero una
  sola cámara no garantiza reidentificación después de una oclusión prolongada.
