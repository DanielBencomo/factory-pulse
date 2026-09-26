# FACTORY PULSE — GUÍA DE DEMOSTRACIÓN (PITCH DE 3 A 5 MINUTOS)

Esta guía detalla el relato y la secuencia de botones para presentar **Factory Pulse** ante el jurado del Hackathon de forma fluida, técnica y visualmente contundente.

---

## 1. El Problema Industrial (0:00 - 0:45)
> *"En una maquiladora o planta de ensamble, hasta el 30% del tiempo de un turno se pierde en traslados innecesarios, esperas por desbalanceo de línea o falta de material, y paros no justificados. Las soluciones comerciales exigen millones en infraestructura invasiva o violan la privacidad de los operadores. **Factory Pulse** es una plataforma local, ligera y de bajo costo que unifica visión cenital anónima y nodos ESP32 para diagnosticar el flujo en tiempo real sin violar la privacidad ni inventar datos."*

---

## 2. Secuencia de Demostración en Vivo (0:45 - 3:30)

### Paso 1: Mostrar el Plano 2D y Trayectorias Spaghetti
- **Acción:** En la pantalla principal, señalar el **Plano 2D** a la izquierda.
- **Narrativa:** *Aquí observamos la Línea 1 de ensamble con 4 estaciones de trabajo (SMT, Reflow, AOI, Empaque), pasillo de tránsito, almacén de componentes y zona de sanitarios. Cada operador tiene un identificador efímero (p. ej. `TRK-OP1`). Las líneas spaghetti con flechas muestran el sentido del flujo y el mapa de calor revela zonas de fricción.*
- **Privacidad:** Señalar el área rosa de sanitarios: *Nótese que en sanitarios y descanso sólo se reporta ocupación agregada, sin expedientes ni cámaras individuales.*

### Paso 2: Explicar los Indicadores y el Universo Temporal
- **Acción:** Señalar las tarjetas KPI superiores y la gráfica de dona.
- **Narrativa:** *Diferenciamos estrictamente tiempo productivo, espera, ausencia, desconocido y paros autorizados. No llamamos 'OEE' a métricas incompletas; declaramos la fórmula matemática exacta y garantizamos que la suma de estados coincide al 100% con el tiempo planificado.*

### Paso 3: Disparar una Alerta en el Simulador (Escena 4 o 5)
- **Acción:** Clic en el botón **"Simulador & 8 Escenas"** en la barra superior.
- **Acción:** Seleccionar **"Escena 4: Falta de Material"** o **"Escena 5: Flujo Atípico"**.
- **Narrativa:** *Al activarse la escena, el materialista acumula recorrido excesivo y un operador cruza a una zona restringida. En menos de un segundo, el motor de reglas genera una alerta en la tarjeta de Alertas con evidencia auditable.*
- **Acción:** Clic en **"Reconocer"** o **"Resolver"** en la tarjeta de alerta.

### Paso 4: Declarar un Paro Autorizado y ver el Ajuste Dinámico
- **Acción:** Clic en el botón rojo **"Declarar Paro"**.
- **Acción:** Seleccionar motivo `[MAN-01] Mantenimiento preventivo programado` y hacer clic en **"Iniciar Paro Ahora"**.
- **Narrativa:** *El paro se registra en la base de datos SQLite con actor y motivo. El indicador de tiempo planificado ajustado se recalcula en vivo mediante unión de intervalos, sin duplicar descuentos si hubiera solapamiento y sin borrar la telemetría histórica.*
- **Acción:** Clic en **"Finalizar Paro"** en la tabla de paros para cerrarlo.

### Paso 5: Inyección en Tiempo Real desde ESP32 / Sensor
- **Acción:** En el modal del simulador, usar el **"Inyector Manual de Telemetría"**; seleccionar `button_press -> Solicitar Material (Andon)` y hacer clic en **"Inyectar Evento"**.
- **Narrativa:** *Este mismo endpoint HTTP `POST /api/events` o el tópico MQTT es el que recibe la señal del ESP32 físico que tenemos en la mesa. Al pulsar el botón, el evento viaja por WebSocket y actualiza el Andon y las alertas al instante.*

### Paso 6: Catálogo Modular y Desacoplamiento
- **Acción:** Clic en el botón **"Catálogo (8 Familias)"**.
- **Narrativa:** *Tenemos 8 familias de módulos catalogadas con estados claros (Activo, Simulado, Requiere Hardware, Experimental). Los wearables fueron descartados conscientemente por riesgo industrial de atrapamiento. Podemos apagar o encender módulos según los sensores disponibles en planta.*

---

## 3. Cierre y Conclusión (3:30 - 4:00)
> *"Factory Pulse corre 100% local en una laptop o servidor de borde de planta, almacena en SQLite, se comunica por WebSockets y MQTT con nodos ESP32 de menos de $5 USD, y entrega analítica industrial reproducible lista para producción."*
