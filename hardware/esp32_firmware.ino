/*
 * =========================================================================================
 * FACTORY PULSE — FIRMWARE DE NODO ESP32
 * =========================================================================================
 *
 * Target: ESP32 Dev Module (WROOM-32) · Arduino core
 * Envío: HTTP POST JSON a la API de Factory Pulse
 *
 * 1. Registra el dispositivo en la app (Dispositivos → Registrar dispositivo).
 *    Queda "esperando conexión".
 * 2. Copia aquí el bloque de configuración que muestra la app para ese dispositivo.
 * 3. Al primer latido la app lo marca "conectado". Si el ID no estaba registrado,
 *    aparece como "detectado sin registrar" para asignarlo.
 *
 * Activa solo los módulos que tenga físicamente este nodo (ENABLE_*).
 *
 * CABLEADO
 * -----------------------------------------------------------------------------------------
 * Componente                 | Pin ESP32        | Notas
 * -----------------------------------------------------------------------------------------
 * RC522 (RFID 13.56 MHz)     | SCK 18, MISO 19, | 3.3 V. Librería MFRC522 (miguelbalboa)
 *                            | MOSI 23, SS 5,   |
 *                            | RST 22           |
 * Pulsador paro / andon      | GPIO 4           | INPUT_PULLUP, normalmente abierto a GND
 * Pulsador solicitar material| GPIO 15          | INPUT_PULLUP
 * Pulsador "pieza terminada" | GPIO 13          | INPUT_PULLUP · da dato de proceso con el kit
 * PIR presencia (opcional)   | GPIO 27          | HC-SR501 / RCWL-0516
 * Pulso de ciclo de máquina  | GPIO 26          | Optoacoplador PC817 desde salida de PLC
 * LED de estado              | GPIO 2           | Encendido = Wi-Fi conectado
 * =========================================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>

// ---------- Configuración (cópiala desde la app) ----------
#define WIFI_SSID    "NOMBRE_DE_TU_RED"
#define WIFI_PASS    "CLAVE_DE_TU_RED"
#define SERVER_BASE  "http://192.168.1.100:8000"
#define DEVICE_ID    "esp32-st-1-rfid"
#define STATION_ID   "st-1"
#define FIRMWARE     "fp-esp32-1.1"
// Déjalo vacío si RFID_INGEST_TOKEN no está configurado en el backend.
#define RFID_API_KEY ""

// ---------- Módulos presentes en este nodo ----------
#define ENABLE_RFID    1
#define ENABLE_BUTTONS 1
#define ENABLE_PIR     0
#define ENABLE_CYCLE   0
// Sin sensor de proceso, un pulsador por pieza terminada permite medir ritmo,
// productivo y espera con el hardware del kit del hackathon.
#define ENABLE_PIECE_BUTTON 1

const unsigned long HEARTBEAT_INTERVAL_MS = 10000;  // la app espera un latido cada 10 s

#if ENABLE_RFID
#include <SPI.h>
#include <MFRC522.h>
const int PIN_RFID_SS = 5;
const int PIN_RFID_RST = 22;
MFRC522 rfid(PIN_RFID_SS, PIN_RFID_RST);
String lastTag = "";
unsigned long lastTagAt = 0;
#endif

const int PIN_BTN_STOP = 4;
const int PIN_BTN_MATERIAL = 15;
const int PIN_BTN_PIECE = 13;
unsigned long lastPieceAt = 0;
const int PIN_PIR = 27;
const int PIN_CYCLE = 26;
const int PIN_LED = 2;

unsigned long lastHeartbeat = 0;
bool lastPresence = false;
volatile unsigned long cyclePulses = 0;
unsigned long lastCycleAt = 0;

void IRAM_ATTR onCyclePulse() { cyclePulses++; }

String eventId(const char* kind) {
  return String(DEVICE_ID) + "-" + kind + "-" + String(millis());
}

// Envía un evento. "payload" es el contenido JSON sin llaves.
int postEvent(const char* type, const char* kind, const String& payload) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  HTTPClient http;
  http.begin(String(SERVER_BASE) + "/api/events");
  http.addHeader("Content-Type", "application/json");
  String json = "{\"event_id\":\"" + eventId(kind) + "\",\"device_id\":\"" DEVICE_ID "\",\"source_id\":\"esp32_" + String(kind) +
                "\",\"type\":\"" + String(type) + "\",\"quality\":1.0,\"mode\":\"live\",\"payload\":{\"station_id\":\"" STATION_ID "\"," + payload + "}}";
  int code = http.POST(json);
  Serial.printf("[%s] HTTP %d\n", type, code);
  http.end();
  return code;
}

// Contrato independiente del modelo de lector: hoy UID/RC522, mañana EPC/UHF.
int postRfidRead(const String& tag) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  HTTPClient http;
  http.begin(String(SERVER_BASE) + "/api/rfid/events");
  http.addHeader("Content-Type", "application/json");
  if (String(RFID_API_KEY).length() > 0) {
    http.addHeader("X-Factory-Pulse-Key", RFID_API_KEY);
  }
  String json = "{\"event_id\":\"" + eventId("rfid") +
                "\",\"reader_id\":\"" DEVICE_ID "\",\"tag_id\":\"" + tag +
                "\",\"event\":\"read\",\"station_id\":\"" STATION_ID +
                "\",\"rssi\":" + String(WiFi.RSSI()) + "}";
  int code = http.POST(json);
  Serial.printf("[rfid] HTTP %d\n", code);
  http.end();
  return code;
}

void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(String(SERVER_BASE) + "/api/devices/" DEVICE_ID "/heartbeat");
  http.addHeader("Content-Type", "application/json");
  String body = "{\"firmware\":\"" FIRMWARE "\",\"rssi\":" + String(WiFi.RSSI()) + ",\"ip\":\"" + WiFi.localIP().toString() + "\"}";
  int code = http.POST(body);
  Serial.printf("[latido] HTTP %d\n", code);
  http.end();
}

void connectWiFi() {
  Serial.printf("Conectando a %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWi-Fi OK, IP " + WiFi.localIP().toString());
    sendHeartbeat();  // aviso inmediato: la app pasa de "esperando" a "conectado"
    lastHeartbeat = millis();
  } else {
    Serial.println("\nSin Wi-Fi, reintentando");
  }
}

bool pressed(int pin) {
  if (digitalRead(pin) != LOW) return false;
  delay(40);  // antirrebote
  if (digitalRead(pin) != LOW) return false;
  while (digitalRead(pin) == LOW) delay(10);
  return true;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
#if ENABLE_BUTTONS
  pinMode(PIN_BTN_STOP, INPUT_PULLUP);
  pinMode(PIN_BTN_MATERIAL, INPUT_PULLUP);
#endif
#if ENABLE_PIR
  pinMode(PIN_PIR, INPUT);
#endif
#if ENABLE_PIECE_BUTTON
  pinMode(PIN_BTN_PIECE, INPUT_PULLUP);
  lastPieceAt = millis();
#endif
#if ENABLE_CYCLE
  pinMode(PIN_CYCLE, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_CYCLE), onCyclePulse, FALLING);
  lastCycleAt = millis();
#endif
#if ENABLE_RFID
  SPI.begin();
  rfid.PCD_Init();
#endif
  Serial.println("\n[Factory Pulse] Nodo " DEVICE_ID);
  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    digitalWrite(PIN_LED, LOW);
    connectWiFi();
    return;
  }
  digitalWrite(PIN_LED, HIGH);

#if ENABLE_RFID
  // Checkpoint: cada tarjeta nueva en la estación genera una entrada.
  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    String tag = "";
    for (byte i = 0; i < rfid.uid.size; i++) {
      if (i) tag += ":";
      if (rfid.uid.uidByte[i] < 0x10) tag += "0";
      tag += String(rfid.uid.uidByte[i], HEX);
    }
    tag.toUpperCase();
    if (tag != lastTag || millis() - lastTagAt > 3000) {  // ignora la misma tarjeta sostenida
      postRfidRead(tag);
      lastTag = tag;
      lastTagAt = millis();
    }
    rfid.PICC_HaltA();
  }
#endif

#if ENABLE_BUTTONS
  if (pressed(PIN_BTN_STOP)) postEvent("button_press", "btn", "\"action\":\"stop_line\",\"button_name\":\"paro\"");
  if (pressed(PIN_BTN_MATERIAL)) postEvent("button_press", "btn", "\"action\":\"request_material\",\"button_name\":\"material\"");
#endif

#if ENABLE_PIECE_BUTTON
  if (pressed(PIN_BTN_PIECE)) {
    float cycle = (millis() - lastPieceAt) / 1000.0;
    lastPieceAt = millis();
    postEvent("cycle", "pza", "\"cycle_time_seconds\":" + String(cycle, 1) + ",\"is_good_piece\":true,\"total_parts\":1,\"source\":\"button\"");
  }
#endif

#if ENABLE_PIR
  bool presence = digitalRead(PIN_PIR) == HIGH;
  if (presence != lastPresence) {
    lastPresence = presence;
    postEvent("presence", "pir", String("\"present\":") + (presence ? "true" : "false") + ",\"confidence\":0.9");
  }
#endif

#if ENABLE_CYCLE
  // Un evento por pieza, con el tiempo de ciclo medido entre pulsos.
  unsigned long pulses = cyclePulses;
  if (pulses > 0) {
    cyclePulses = 0;
    float cycle = (millis() - lastCycleAt) / 1000.0 / pulses;
    lastCycleAt = millis();
    for (unsigned long i = 0; i < pulses; i++) {
      postEvent("cycle", "cyc", "\"cycle_time_seconds\":" + String(cycle, 1) + ",\"is_good_piece\":true,\"total_parts\":1");
    }
  }
#endif

  if (millis() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeat = millis();
    sendHeartbeat();
  }
  delay(20);
}
