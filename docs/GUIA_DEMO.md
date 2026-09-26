# Factory Pulse — guía de demostración (5 min)

La guía del jurado pide valorar **lo que realmente funciona durante la demostración**.
Este guion muestra cada fuente del documento del proyecto funcionando con hardware real,
en el modo **En vivo**, y deja el simulador solo para explicar escenarios.

Rúbrica de referencia: comprensión (15) · innovación (15) · **integración IoT (20)** ·
**funcionamiento (20)** · viabilidad (10) · impacto (10) · presentación (10).
Desempate: funcionamiento y calidad, luego integración IoT.

---

## 0. Montaje (antes de presentar)

| Paso | Cómo verificarlo |
|---|---|
| Backend escuchando en la red: `START_MODE=live python -m uvicorn app.main:app --host 0.0.0.0 --port 8000` | `http://<IP>:8000/api/system/mode` responde desde el teléfono |
| Firewall de Windows permite entrada al puerto 8000 | El ESP32 pasa a *conectado* en **Dispositivos** |
| Layout: **Layout → Plantilla → Cargar escenario del hackathon** (10 × 6 m, Materiales → Producción → Calidad) y **Guardar** | El plano muestra las 3 zonas y el pasillo |
| Cámara calibrada: `python hardware/local_vision_provider.py --source webcam --calibrate calib.json --plant-width 8 --plant-height 5` | Caminar por una esquina y ver el punto en la misma esquina del plano |
| Visión publicando: `python hardware/local_vision_provider.py --source webcam --calib calib.json --api http://<IP>:8000 --activate-live-mode` | Panel **Cámara** muestra recuadros/IDs y la franja **Fuentes → Cámara · N tracks** |
| Teléfono RTSP probado: `python hardware/local_vision_provider.py --source "rtsp://<IP>:<PUERTO>/<RUTA>" --probe-source` | Responde `first_frame_ok: true`; no mostrar credenciales al jurado |
| ESP32 registrados y vinculados en **Editar interior** de cada estación | Sensores con borde verde en el plano |
| Tarjetas RFID asignadas en **Dispositivos → Tarjetas RFID** | Al pasar una tarjeta aparece el nombre en el panel de la estación |
| Distancia validada: recorrer 5 m medidos con cinta | La tabla de spaghetti marca 5 m ± 10% |
| **Plan B grabado:** con todo funcionando, **Grabaciones · plan B → Guardar últimos 15 min** | La grabación aparece en la lista |

---

## 1. Problema y alcance (0:00 – 0:40) · *comprensión*

> “Las plantas saben que pierden tiempo en esperas de material, recorridos y paros sin causa,
> pero lo miden con cronómetro y Excel unos días al año. Factory Pulse reconstruye el flujo real
> de una celda con sensores baratos y complementarios, y separa los paros justificados para no
> confundir una condición del proceso con improductividad.”

Decir explícitamente lo que **no** se promete: RFID no localiza al centímetro, el CSI no identifica
personas y estar quieto no prueba improductividad (el sistema lo muestra como “presente sin dato
de proceso”).

## 2. Fuentes en una sola vista (0:40 – 1:40) · *integración IoT*

1. Señalar la franja **Fuentes**: RFID (A), CSI (B), cámara (C), pulsadores (D), proceso (E), cada una en línea.
2. Un compañero **pasa su tarjeta** en Producción → en el panel de la estación aparece su nombre y la hora.
3. Señalar el bounding box y el ID anónimo en el panel de cámara; caminar hacia Calidad → el punto se mueve en el plano y crece el spaghetti de la línea.
4. Se queda quieto frente a la mesa → el CSI pasa de *actividad* a *quietud*; al salir, *sin presencia*.
5. Presiona el pulsador **pieza terminada** → sube el contador de piezas y la estación pasa a *productivo*.

## 3. Paros y alertas (1:40 – 2:40) · *funcionamiento*

1. Presiona el **pulsador de paro** → aparece un paro *pendiente de causa* (no se descuenta todavía).
2. En **Paros y alertas**, **Justificar** → causa “Falta de material”. Explicar: desde ahora ese
   intervalo sale de la espera; los datos crudos no se borran.
3. Mostrar la regla de **discrepancia entre sensores**: pasar la tarjeta sin entrar al campo de la
   cámara → alerta “RFID sin confirmación de cámara”. Es la fusión de fuentes trabajando.

## 4. Métricas (2:40 – 3:50) · *impacto*

En **Métricas**, cada gráfica responde una pregunta:

- ¿Cuándo produjo, esperó o se detuvo cada estación? (línea de tiempo)
- ¿Qué estación limita la salida? (cuello de botella en naranja)
- ¿Quién camina más dentro de la línea? · ¿En qué zonas se pasa el tiempo?
- ¿Qué causas de paro cuestan más? (Pareto)

Los KPI muestran la diferencia contra el periodo anterior: si movemos el material más cerca y el
“caminado en la línea” baja, es el efecto de la acción, no una promesa.

## 5. Viabilidad (3:50 – 4:40) · *viabilidad*

- Kit del prototipo ≈ $1,517 MXN de hardware incremental (estudio de mercado).
- **Layout editable**: cada maquila dibuja su nave, líneas y el interior de cada estación.
- Piloto profesional: 1 celda, $259 mil instalación + $6 mil/mes, con criterios go / stop.
- Privacidad desde el diseño: IDs de cámara anónimos, sanitarios solo en agregado.

## 6. Preguntas (4:40 – 5:00)

---

## Plan B (si un sensor falla frente al jurado)

1. **Herramientas → Grabaciones · plan B → Reproducir** la grabación del ensayo.
2. El encabezado dice **Reproducción** y un aviso indica que son datos grabados: decirlo en voz alta.
3. Al terminar, **Detener y volver a En vivo**.

Si falla un ESP32 en vivo, el sistema lo marca *sin señal* y sigue funcionando con las demás fuentes:
también es algo que el jurado puede valorar.

## Qué no decir

- Porcentajes de mejora de terceros como si fueran de Factory Pulse.
- “Productividad individual”: el sistema mide flujo, no evalúa personas.
- “Certificado” o “industrial”: es un prototipo que demuestra arquitectura y valor analítico.
