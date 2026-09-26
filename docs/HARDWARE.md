# FACTORY PULSE — MATRIZ DE HARDWARE Y SENSORES

Esta matriz describe cada tecnología de sensado, su cableado físico, evento generado en el contrato JSON, resolución real y estado en la plataforma.

---

## 1. Tabla Resumen de Sensores e Integraciones

| Sensor / Tecnología | Evento Generado | Cableado / Conexión Física | Precisión y Limitaciones | Estado en Demo |
|---|---|---|---|---|
| **Pulsador Industrial / Andon** | `button_press` (action: `request_material`, `sos`, `stop_line`) | GPIO 4 y GPIO 5 en ESP32 con `INPUT_PULLUP` hacia GND | Tiempo de respuesta < 50ms. Requiere debouncing por software (50ms). | **ACTIVO (En vivo y Simulado)** |
| **Sensor PIR / Presencia (HC-SR501 / RCWL-0516)** | `presence` (`present: true/false`, `confidence`) | GPIO 18 en ESP32 (VCC 5V, GND, OUT a GPIO 18) | Detección binaria de movimiento en radio de 3-5m. No mide coordenadas X,Y. | **ACTIVO (En vivo y Simulado)** |
| **Optoacoplador / Pulso Ciclo de Máquina (PC817)** | `cycle` (`cycle_time_seconds`, `total_parts`) | GPIO 19 en ESP32 con interrupción `FALLING` conectado a salida de relevador PLC | Precisión al milisegundo por pieza. Aislamiento galvánico hasta 5kV. | **ACTIVO (En vivo y Simulado)** |
| **Sensor Ambiental (DHT22 / BME280)** | `environment` (`temperature_c`, `humidity_pct`, `co2_ppm`) | GPIO 21 en ESP32 con resistencia pull-up de 10k a 3.3V | ±0.5°C temp, ±2% humedad. Muestreo recomendado cada 5 a 15 segundos. | **ACTIVO (En vivo y Simulado)** |
| **Cámara Cenital Visión Local (OpenCV / Webcam)** | `position` (`x, y [0..1]`, `track_id`, `confidence`) | Conexión USB a PC local o RTSP IP sobre Ethernet | 20-50 cm según altura cenital. Oclusiones temporales manejadas por tracker. | **CONTRATO LISTO + PROVEEDOR LOCAL** |
| **Lector RFID / NFC (RC522 / UHF)** | `checkpoint_pass` (`tag_id`, `station_id`) | Bus SPI (SCK: 18, MISO: 19, MOSI: 23, SS: 5, RST: 22) | Lectura puntual a 3-8 cm (HF) o 1-3 m (UHF). No da trayectoria continua. | **REQUIERE HARDWARE (needs_device)** |
| **Balizas BLE Proximidad (iBeacon / ESP32 BLE)** | `proximity_beacon` (`rssi`, `estimated_zone`) | Radiación Bluetooth 2.4 GHz sin cables | Precisión de zona aproximada (2-5m). Afectado por reflexiones metálicas. | **REQUIERE HARDWARE (needs_device)** |
| **UWB Decawave DWM1000 con Anclas** | `position` (`x, y`, `error_radius_cm`) | 4 anclas en esquinas de nave alimentadas a 5V + tag en carro | Alta precisión (10-20 cm). Mayor costo y requiere calibración topográfica. | **EXPERIMENTAL** |
| **Wi-Fi CSI (Channel State Information)** | `presence_csi` (`variance_score`, `motion_level`) | ESP32 en modo promiscuo capturando CSI de subportadoras OFDM | Detección de presencia/respiración por Doppler. **NUNCA vende coordenadas XY exactas.** | **EXPERIMENTAL** |
| **Transformador de Corriente (SCT-013) / Vibración** | `machine_health` (`current_amps`, `vibration_rms`) | Entrada analógica ADC (GPIO 34/35) con circuito de acondicionamiento | 0-30A AC. Detección de arranque/paro y fatiga de rodamientos. | **REQUIERE HARDWARE (needs_device)** |
| **Wearables en Operador (Reloj/Pulsera)** | *N/A* | *Descartado* | **DESCARTADO POR NORMA DE SEGURIDAD:** Riesgo de atrapamiento mecánico en bandas y tornos. | **DESCARTADO** |

---

## 2. Esquema de Ingestión por Capas

```
[ ESP32 Físico ] ----(Wi-Fi / HTTP POST)----> [ POST /api/events ]
                                                     |
[ Broker MQTT ] ----(Topic events)----------> [ MQTT Adapter ]
                                                     |
[ Visión Local ] ---(PositionProvider)------> [ SQLite Database ]
                                                     |
                                            [ Motor de Reglas & KPIs ]
                                                     |
                                            [ WebSocket /ws ] ---> [ React Dashboard ]
```
