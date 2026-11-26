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

## Modelo y seguimiento

| Perfil | Pesos predeterminados | Confianza | IoU | Tamaño de inferencia |
|---|---|---:|---:|---:|
| Rápido | `yolo11n.pt` | 0.28 | 0.55 | 640 |
| Equilibrado | `yolo11s.pt` | 0.25 | 0.55 | 960 |
| Precisión | `yolo11m.pt` | 0.20 | 0.60 | 1280 |

El perfil predeterminado es Equilibrado. El tracker es ByteTrack, con
`bytetrack.yaml` y estado persistente entre cuadros del mismo proceso.
El endpoint de salud indica los pesos, tracker y versión de Ultralytics
efectivamente cargados, no sólo el perfil configurado.

## Registro y arranque administrado

FastAPI administra las fuentes registradas en **Cámara**. Cada registro conserva
tipo, URL sin credenciales, usuario, contraseña cifrada, transporte, perfil
YOLO y revisión de calibración guardada en SQLite. El navegador consume rutas `/api/cameras/{id}` y
ya no conoce ni depende de un puerto de visión fijo.

El backend detecta automáticamente `.venv-vision` en la raíz. Si el entorno se
encuentra en otro lugar, defina `VISION_PYTHON` con la ruta completa del
intérprete antes de iniciar FastAPI.

## Arranque completo

Sigue las instrucciones del [README](../README.md) desde la raíz del repositorio.

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

```

## Calibración del piso y zonas

1. Fija la cámara y configura las dimensiones **medidas** en **Layout**.
2. Marca cuatro referencias físicas en el piso siguiendo el perímetro del área
   visible. Mide sus coordenadas X/Y desde el mismo origen del plano.
3. En **Cámaras → Calibrar piso**, congela una imagen y marca las cuatro
   correspondencias. Añade por lo menos un control interior que no se usó
   para el ajuste; se recomiendan dos o más distribuidos por el área.
4. Selecciona **Validar y guardar**. Si la desviación máxima supera la
   tolerancia, corrige las referencias y vuelve a medir. Una tolerancia de
   0.25 m es el valor inicial, no una garantía de precisión en planta.
5. Revisa que la tarjeta indique proyección activa y que un recorrido sobre
   referencias medidas coincida con el plano.

El backend publica una sola matriz normalizada para el editor y el proveedor.
Una cámara sin calibración sigue detectando personas en la imagen, pero no
aporta XY ni ocupación por zona. Las referencias delimitan la huella: no se
extrapolan posiciones fuera de ella. Si mueves la cámara o cambias el zoom,
invalida y vuelve a calibrar, aunque la resolución no cambie. Los archivos
JSON de la calibración antigua quedan como referencia local; no se importan
ni se activan automáticamente.

### Dibujar departamentos sobre una captura

Con una calibración activa, abre
**Cámara → Mapear áreas**:

1. pulse **Nueva captura** si desea congelar otro instante;
2. elija *Zona / departamento* o *Línea completa*;
3. marque al menos tres vértices siguiendo el piso visible;
4. asigne nombre, tipo, línea, estación y capacidad;
5. active *Solo conteo agregado* en áreas sensibles y guarde.

El navegador envía puntos y revisión a `/api/cameras/{id}/map-points`.
FastAPI aplica la homografía validada y comprueba la misma revisión al guardar. Los accesos sanitarios se
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

## Continuidad del tracking

En una cámara con calibración administrada, Factory Pulse asigna su propio ID
anónimo por arranque. ByteTrack aporta las detecciones y su ID interno, pero
ese ID no se usa como identidad permanente.

| Situación | Qué ocurre |
|---|---|
| Detecciones consecutivas compatibles | Se mantiene el ID y continúa el tramo. |
| Oclusión breve y una única coincidencia espacial plausible | Puede recuperarse el ID aunque ByteTrack entregue otro, pero empieza un tramo nuevo. |
| Hay alternativas, se vence la ventana o se sale cerca del borde calibrado | Se asigna un ID nuevo; no se deduce quién volvió. |
| Zona sensible, nueva geometría, reconexión o reinicio | Se corta la asociación. En la zona sensible solo se publica el conteo. |

Por defecto, la recuperación permite hasta **1.5 s** y **0.8 m** en el piso,
también limitada por la velocidad plausible. Ambos puntos deben estar a más
de 0.8 m del perímetro calibrado y de zonas sensibles. El modo manual permite
`--recovery-seconds 0` para apagar la recuperación, o una ventana de hasta
2 s. Si la zona visible es pequeña, puede no quedar espacio apto para recuperar.
No se usan rasgos biométricos, no se predicen puntos ni se intenta unir cámaras.
Que se recupere el ID es una asociación geométrica probable, no una confirmación
de identidad. Dos personas que se sustituyen en el mismo punto sin ser vistas
siguen siendo indistinguibles para una sola cámara.

### Verificación con el teléfono por RTSP

Fija y calibra el teléfono. En el interior de la cobertura, tapa brevemente a una
persona (menos de 1.5 s) y verifica su reaparición cerca del último punto:
el ID puede mantenerse, pero el espagueti debe quedar cortado. Repite con dos
personas apareciendo cerca del último punto, con una ausencia superior a 2 s
y después de reconectar RTSP: no debería heredarse el ID en esos casos.
Comprueba también que ningún ID ni punto del plano se publique dentro de una zona
sensible. El videowall muestra recuperaciones y asociaciones descartadas desde
el arranque; esos contadores no sustituyen comparar contra el video observado.

## Endpoints del proveedor

| Ruta | Contenido |
|---|---|
| `/vision/health` | Estado, FPS, IDs activos, zonas, calibración y contadores de continuidad |
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
- **Hay recuadros, pero no aparecen tracks en el plano:** revise `backend_ok`
  en `/api/cameras/<ID>/health` y el puerto de `VISION_BACKEND_URL`.
- **No aparecen zonas sobre la cámara:** hace falta una calibración activa y al menos una zona
  válida en `/api/zones`.
- **RTSP tarda o se corta:** pruebe primero `--probe-source`, use TCP, acerque el
  teléfono al punto de acceso y reduzca la resolución en la app del teléfono.
- **Un proveedor no inicia:** revise el mensaje de la tarjeta y
  `runtime/camera-<id>.log`; confirme que `.venv-vision` existe o configure
  `VISION_PYTHON`.
- **Varias personas intercambian IDs:** evite cruces totalmente ocluidos, use un
  ángulo más alto y buena iluminación. ByteTrack mejora persistencia, pero una
  sola cámara no garantiza reidentificación después de una oclusión prolongada.
