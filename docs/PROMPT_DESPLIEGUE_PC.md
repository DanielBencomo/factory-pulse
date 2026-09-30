# Prompt para desplegar Factory Pulse en una PC Windows

Copia el bloque siguiente y entrégaselo al agente que opera tu PC. Sustituye únicamente la URL RTSP; no publiques credenciales.

---

## Prompt listo para copiar

```text
Quiero que despliegues y verifiques Factory Pulse en esta PC Windows usando exclusivamente CPU/GPU de la PC, sin Raspberry Pi ni Hailo.

Repositorio: https://github.com/DanielBencomo/factory-pulse.git
Rama: vision-yolo-bytetrack-rtsp

Objetivo:
- levantar FastAPI en el puerto 8000;
- levantar el proveedor YOLO + ByteTrack en el puerto 8001;
- levantar React/Vite en el puerto 3000;
- usar mi teléfono como cámara RTSP;
- mantener cámara y plano 2D en páginas separadas;
- comprobar detección de personas, ID temporal, zonas, plano, heatmaps, spaghetti segmentado, analítica espacial y selector de analíticas;
- no habilitar reconocimiento facial ni guardar credenciales RTSP en archivos o Git.

Trabaja paso a paso y no des por terminado el despliegue hasta hacer las verificaciones. Si el repositorio ya existe, no borres mis archivos ni mi base de datos: revisa `git status`, conserva cambios locales y actualiza la rama de forma segura. Si hay cambios que impiden actualizar, detente y explícame exactamente cuáles son.

1. Verifica requisitos:
   - Git;
   - Python 3.10–3.12 (preferido 3.12);
   - Node.js 18 o superior y npm;
   - puertos 8000, 8001 y 3000 libres.

2. Clona o actualiza el repositorio y cambia a la rama indicada:
   git clone https://github.com/DanielBencomo/factory-pulse.git
   cd factory-pulse
   git fetch origin
   git switch vision-yolo-bytetrack-rtsp
   git pull --ff-only origin vision-yolo-bytetrack-rtsp

3. Crea un entorno independiente para el backend, instala dependencias y ejecuta sus pruebas:
   py -3.12 -m venv .venv-backend
   .\.venv-backend\Scripts\Activate.ps1
   python -m pip install --upgrade pip
   pip install -r backend\requirements.txt
   cd backend
   pytest -q
   cd ..

4. Inicia el backend en una terminal PowerShell nueva, en modo real:
   cd <RUTA_AL_REPOSITORIO>
   .\.venv-backend\Scripts\Activate.ps1
   cd backend
   $env:START_MODE="live"
   python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

5. Comprueba antes de seguir:
   - http://127.0.0.1:8000/api/health
   - http://127.0.0.1:8000/docs
   - http://127.0.0.1:8000/api/spatial/summary?scope=plant&minutes=15&mode=live
   La última ruta debe devolver JSON con summary, zones, transitions, insights y methodology. Que coverage sea 0 antes de conectar la cámara es válido.

6. Crea otro entorno para visión e instala sus dependencias:
   cd <RUTA_AL_REPOSITORIO>
   py -3.12 -m venv .venv-vision
   .\.venv-vision\Scripts\Activate.ps1
   python -m pip install --upgrade pip
   pip install -r hardware\vision_requirements.txt

7. Pídeme la URL RTSP local del teléfono si todavía no te la di. No la copies a `.env`, documentación, logs compartidos ni Git. Primero diagnostica la fuente:
   python hardware\local_vision_provider.py --source "<URL_RTSP_LOCAL>" --rtsp-transport tcp --probe-source
   Debe informar first_frame_ok: true. Si falla, prueba conectividad a la IP/puerto del teléfono, confirma que ambos están en la misma red y luego prueba UDP. No desactives seguridad del sistema ni expongas el stream a Internet.

8. Si no existe calibración, créala con la cámara ya fijada en alto. Pídeme hacer clic en cuatro puntos del piso en este orden: superior izquierda, superior derecha, inferior derecha e inferior izquierda:
   python hardware\local_vision_provider.py --source "<URL_RTSP_LOCAL>" --rtsp-transport tcp --calibrate calib-planta.json --plant-width 8 --plant-height 5
   Ajusta 8 y 5 a las dimensiones reales que yo confirme. `calib-planta.json` es local y no debe contener la URL RTSP.

9. Inicia el proveedor de visión en otra terminal. Empieza con CPU para máxima compatibilidad:
   cd <RUTA_AL_REPOSITORIO>
   .\.venv-vision\Scripts\Activate.ps1
   python hardware\local_vision_provider.py `
     --source "<URL_RTSP_LOCAL>" `
     --rtsp-transport tcp `
     --calib calib-planta.json `
     --width 640 --height 640 `
     --image-size 416 --jpeg-quality 60 `
     --device cpu `
     --api http://127.0.0.1:8000 `
     --activate-live-mode
   Si la PC tiene CUDA ya funcional, puedes probar `--device 0`, pero no cambies PyTorch ni drivers sin explicarme el riesgo y pedir confirmación.

10. Verifica el proveedor:
    - http://127.0.0.1:8001/vision/health
    - http://127.0.0.1:8001/vision/annotated.mjpg
    Debe reportar frames recientes. Una persona visible debe tener bounding box y track ID temporal.

11. Instala y compila el frontend:
    cd <RUTA_AL_REPOSITORIO>\frontend
    npm ci
    npm run build

12. Inicia Vite en otra terminal configurando explícitamente ambos proxies:
    cd <RUTA_AL_REPOSITORIO>\frontend
    $env:FP_API_TARGET="http://127.0.0.1:8000"
    $env:FP_VISION_TARGET="http://127.0.0.1:8001"
    npm run dev -- --host 127.0.0.1 --port 3000

13. Abre http://127.0.0.1:3000 y valida:
    - el indicador Servidor está conectado;
    - el modo es En vivo;
    - Cámara muestra video anotado, boxes, IDs y zonas;
    - Planta muestra el plano como vista principal y no incrusta la cámara;
    - las capas Zonas, Rutas, Tránsito y Permanencia funcionan;
    - Rutas se revisa por línea/zona o por persona para evitar saturar toda la planta;
    - el panel Pulso espacial muestra cobertura, ocupación y observaciones explicables;
    - Métricas → Analíticas permite activar/desactivar módulos y usar las vistas Supervisor, Ingeniería industrial y Balanceo;
    - una zona sensible muestra solo conteos agregados, sin IDs ni rutas.

14. En Cámara → Mapear áreas, ayúdame a congelar una captura, dibujar al menos tres zonas, nombrarlas, asignar tipo/línea/capacidad y guardarlas. Después comprueba que aparecen en el plano, video y endpoint espacial.

15. Haz una prueba real caminando entre zonas durante varios minutos y verifica:
    - ID razonablemente persistente;
    - X/Y y entradas/salidas;
    - distancia y persona·minuto;
    - heatmap de tránsito y de permanencia diferentes;
    - transición entre zonas y retorno A→B→A si se realiza;
    - coverage alta y fresh=true mientras llega video;
    - al apagar la cámara el conteo actual cambia a desconocido, no a cero falso.

16. No inventes OEE, WIP, MTBF, causa raíz ni productividad individual si faltan sus señales. Reporta qué quedó observado, inferido o no disponible.

Al finalizar entrégame:
- URLs locales activas;
- comandos exactos que quedaron ejecutándose;
- versión de Python, Node, modelo YOLO y dispositivo CPU/GPU;
- resultado de pytest y npm run build;
- FPS, latencia aproximada y cobertura;
- cualquier error pendiente con su evidencia;
- recomendación concreta para la siguiente prueba, sin modificar más código automáticamente.
```

---

## Puertos y procesos esperados

| Puerto | Proceso | Comprobación |
|---|---|---|
| 8000 | FastAPI + SQLite + WebSocket | `/api/health`, `/docs`, `/api/spatial/summary` |
| 8001 | YOLO + ByteTrack + MJPEG | `/vision/health`, `/vision/annotated.mjpg` |
| 3000 | React/Vite | dashboard |

## Si la cámara funciona pero el dashboard no alcanza el backend

Ejecuta en PowerShell:

```powershell
Test-NetConnection 127.0.0.1 -Port 8000
Invoke-RestMethod http://127.0.0.1:8000/api/health
netstat -ano | Select-String ":8000|:8001|:3000"
```

Después confirma que Vite fue iniciado en la misma terminal donde se definió:

```powershell
$env:FP_API_TARGET="http://127.0.0.1:8000"
$env:FP_VISION_TARGET="http://127.0.0.1:8001"
npm run dev -- --host 127.0.0.1 --port 3000
```

Para que ESP32/RFID de la red local alcancen el backend, conserva `--host 0.0.0.0`, usa la IP LAN que muestra **Dispositivos**, y abre únicamente el puerto 8000 en el perfil de red privada de Windows. No es necesario exponer 8000, 8001 ni el stream RTSP a Internet.

