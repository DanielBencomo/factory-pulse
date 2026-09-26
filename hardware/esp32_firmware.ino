/*
 * =========================================================================================
 * FACTORY PULSE — ESP32 INDUSTRIAL NODE FIRMWARE
 * =========================================================================================
 * 
 * Target: ESP32 Dev Module (WROOM-32)
 * Framework: Arduino / ESP-IDF
 * Telemetría: HTTP POST JSON a la API Factory Pulse / MQTT
 * 
 * DIAGRAMA DE CONEXIONES Y CABLEADO REAL:
 * -----------------------------------------------------------------------------------------
 * Componente / Sensor     | Pin ESP32 | Modo / Resistencia
 * -----------------------------------------------------------------------------------------
 * Botón Andon / Paro      | GPIO 4    | INPUT_PULLUP (Pulsador normalmente abierto a GND)
 * Botón Material Solicitud| GPIO 5    | INPUT_PULLUP (Pulsador normalmente abierto a GND)
 * Sensor PIR Presencia    | GPIO 18   | INPUT (Salida digital HC-SR501 / RCWL-0516)
 * Sensor Ciclo Máquina    | GPIO 19   | INPUT_PULLUP (Optoacoplador PC817 a señal de PLC)
 * Sensor DHT22 (Temp/Hum) | GPIO 21   | INPUT + Resistencia 10k Pull-up a 3.3V
 * LED Estado Conexión     | GPIO 2    | OUTPUT (LED Onboard azul)
 * =========================================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>

// --- CONFIGURACIÓN DE RED Y SERVIDOR ---
const char* WIFI_SSID = "PLANTA_INDUSTRIAL_WIFI";
const char* WIFI_PASS = "FactoryPulse2026";
const char* API_EVENTS_URL = "http://192.168.1.100:8000/api/events";
const char* API_HEARTBEAT_URL = "http://192.168.1.100:8000/api/devices/esp32-line1-st1/heartbeat";

const char* DEVICE_ID = "esp32-line1-st1";
const char* STATION_ID = "st-1";

// --- PINES DE ENTRADA ---
const int PIN_BTN_ANDON = 4;
const int PIN_BTN_MAT = 5;
const int PIN_PIR_PRESENCE = 18;
const int PIN_OPTO_CYCLE = 19;
const int PIN_LED_STATUS = 2;

// --- VARIABLES DE ESTADO Y CONTROL ---
unsigned long lastHeartbeat = 0;
const unsigned long HEARTBEAT_INTERVAL_MS = 15000; // Latido cada 15s

unsigned long lastCycleTime = 0;
volatile int cycleCount = 0;
bool lastPresenceState = false;

// Interrupción para conteo de ciclo de máquina
void IRAM_ATTR onCyclePulse() {
  cycleCount++;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BTN_ANDON, INPUT_PULLUP);
  pinMode(PIN_BTN_MAT, INPUT_PULLUP);
  pinMode(PIN_PIR_PRESENCE, INPUT);
  pinMode(PIN_OPTO_CYCLE, INPUT_PULLUP);
  pinMode(PIN_LED_STATUS, OUTPUT);

  attachInterrupt(digitalPinToInterrupt(PIN_OPTO_CYCLE), onCyclePulse, FALLING);

  Serial.println("\n[Factory Pulse ESP32] Iniciando nodo...");
  connectWiFi();
}

void loop() {
  // 1. Mantener conexión Wi-Fi activa
  if (WiFi.status() != WL_CONNECTED) {
    digitalWrite(PIN_LED_STATUS, LOW);
    connectWiFi();
  } else {
    digitalWrite(PIN_LED_STATUS, HIGH);
  }

  // 2. Comprobar Botón de Emergencia / SOS (GPIO 4)
  if (digitalRead(PIN_BTN_ANDON) == LOW) {
    delay(50); // Debounce
    if (digitalRead(PIN_BTN_ANDON) == LOW) {
      Serial.println("[EVENTO] Boton SOS/Paro presionado!");
      sendButtonEvent("sos", "Paro de emergencia activado por boton físico");
      while (digitalRead(PIN_BTN_ANDON) == LOW) { delay(10); }
    }
  }

  // 3. Comprobar Botón de Material (GPIO 5)
  if (digitalRead(PIN_BTN_MAT) == LOW) {
    delay(50); // Debounce
    if (digitalRead(PIN_BTN_MAT) == LOW) {
      Serial.println("[EVENTO] Solicitud de material Andon presionado!");
      sendButtonEvent("request_material", "Solicitud de lote de componentes");
      while (digitalRead(PIN_BTN_MAT) == LOW) { delay(10); }
    }
  }

  // 4. Comprobar Sensor de Presencia PIR (GPIO 18)
  bool currentPresence = digitalRead(PIN_PIR_PRESENCE) == HIGH;
  if (currentPresence != lastPresenceState) {
    lastPresenceState = currentPresence;
    sendPresenceEvent(currentPresence);
  }

  // 5. Emitir Ciclo de Producción acumulado
  if (cycleCount > 0) {
    int countToSend = cycleCount;
    cycleCount = 0;
    sendCycleEvent(countToSend);
  }

  // 6. Enviar Heartbeat periódico
  if (millis() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeat = millis();
    sendHeartbeat();
  }

  delay(20);
}

void connectWiFi() {
  Serial.print("Conectando a Wi-Fi: ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[Wi-Fi] Conectado! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[Wi-Fi] Tiempo de espera agotado. Reintentando...");
  }
}

void sendButtonEvent(const char* action, const char* notes) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(API_EVENTS_URL);
  http.addHeader("Content-Type", "application/json");

  String json = "{";
  json += "\"event_id\":\"esp32-" + String(DEVICE_ID) + "-" + String(millis()) + "\",";
  json += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  json += "\"source_id\":\"esp32_gpio\",";
  json += "\"type\":\"button_press\",";
  json += "\"quality\":1.0,";
  json += "\"mode\":\"live\",";
  json += "\"payload\":{";
  json += "\"station_id\":\"" + String(STATION_ID) + "\",";
  json += "\"button_name\":\"physical_button\",";
  json += "\"action\":\"" + String(action) + "\",";
  json += "\"notes\":\"" + String(notes) + "\"";
  json += "}}";

  int httpCode = http.POST(json);
  Serial.printf("[HTTP POST Button] Codigo: %d\n", httpCode);
  http.end();
}

void sendPresenceEvent(bool present) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(API_EVENTS_URL);
  http.addHeader("Content-Type", "application/json");

  String json = "{";
  json += "\"event_id\":\"esp32-pir-" + String(DEVICE_ID) + "-" + String(millis()) + "\",";
  json += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  json += "\"source_id\":\"esp32_pir\",";
  json += "\"type\":\"presence\",";
  json += "\"quality\":1.0,";
  json += "\"mode\":\"live\",";
  json += "\"payload\":{";
  json += "\"station_id\":\"" + String(STATION_ID) + "\",";
  json += "\"present\":" + String(present ? "true" : "false") + ",";
  json += "\"confidence\":0.95";
  json += "}}";

  int httpCode = http.POST(json);
  Serial.printf("[HTTP POST Presence] Codigo: %d\n", httpCode);
  http.end();
}

void sendCycleEvent(int parts) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(API_EVENTS_URL);
  http.addHeader("Content-Type", "application/json");

  String json = "{";
  json += "\"event_id\":\"esp32-cyc-" + String(DEVICE_ID) + "-" + String(millis()) + "\",";
  json += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  json += "\"source_id\":\"esp32_opto\",";
  json += "\"type\":\"cycle\",";
  json += "\"quality\":1.0,";
  json += "\"mode\":\"live\",";
  json += "\"payload\":{";
  json += "\"station_id\":\"" + String(STATION_ID) + "\",";
  json += "\"cycle_time_seconds\":45.0,";
  json += "\"is_good_piece\":true,";
  json += "\"total_parts\":" + String(parts);
  json += "}}";

  int httpCode = http.POST(json);
  Serial.printf("[HTTP POST Cycle] Codigo: %d\n", httpCode);
  http.end();
}

void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(API_HEARTBEAT_URL);
  http.addHeader("Content-Type", "application/json");
  int httpCode = http.POST("{}");
  Serial.printf("[HTTP Heartbeat] Codigo: %d\n", httpCode);
  http.end();
}
