/*
 * =========================================================================================
 * FACTORY PULSE — NODO ESP32 Wi‑Fi CSI (EXPERIMENTAL)
 * =========================================================================================
 *
 * Qué hace: estima si hay ACTIVIDAD, QUIETUD o SIN PRESENCIA en la zona usando la
 * variación del canal Wi‑Fi (CSI) entre el ESP32 y el router. No identifica ni ubica
 * personas: da un solo estado para toda la zona, con una confianza.
 *
 * Requisitos
 *   - ESP32 clásico (WROOM-32). Arduino core 2.x con CSI habilitado en el SDK.
 *   - El router a 3–6 m, con la zona de trabajo entre el router y el nodo.
 *   - Arrancar con la zona VACÍA: los primeros CALIBRATION_MS miden la línea base.
 *
 * Envía a la API
 *   POST /api/events  type=presence, payload {station_id, source:"csi", state, confidence, motion}
 *   POST /api/devices/<ID>/heartbeat cada 10 s
 *
 * Ajuste en sitio: si marca actividad con la zona vacía, sube K_ACTIVITY; si no detecta
 * a una persona trabajando, bájalo. Deja este nodo como experimental hasta validarlo
 * contra observación humana (ver estudio de mercado, sección de riesgos técnicos).
 * =========================================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include "esp_wifi.h"

// ---------- Configuración (cópiala desde la app) ----------
#define WIFI_SSID    "NOMBRE_DE_TU_RED"
#define WIFI_PASS    "CLAVE_DE_TU_RED"
#define SERVER_BASE  "http://192.168.1.100:8000"
#define DEVICE_ID    "esp32-st-2-csi"
#define STATION_ID   "st-2"
#define FIRMWARE     "fp-csi-0.9"

const unsigned long CALIBRATION_MS = 20000;   // zona vacía al arrancar
const unsigned long REPORT_MS = 2000;         // cada cuánto se evalúa el estado
const unsigned long KEEPALIVE_MS = 10000;     // reenvía el estado aunque no cambie
const unsigned long HEARTBEAT_MS = 10000;
const float K_ACTIVITY = 3.0;                 // × línea base → actividad
const float K_PRESENCE = 1.6;                 // × línea base → quietud (presencia sin movimiento)

// Ventana deslizante de amplitud media por trama (~5 s con beacons a 10 Hz)
const int WINDOW = 64;
volatile float amp[WINDOW];
volatile int ampHead = 0;
volatile int ampCount = 0;
portMUX_TYPE ampMux = portMUX_INITIALIZER_UNLOCKED;
uint8_t apBssid[6];

float baseline = 0;
unsigned long bootAt, lastReport = 0, lastSent = 0, lastHeartbeat = 0;
String lastState = "";

// Callback de CSI: corre en la tarea de Wi‑Fi, debe ser corto.
void IRAM_ATTR onCsi(void* ctx, wifi_csi_info_t* info) {
  if (!info || !info->buf || memcmp(info->mac, apBssid, 6) != 0) return;  // solo tramas del router
  const int8_t* b = info->buf;
  int n = info->len / 2;
  if (n <= 0) return;
  float sum = 0;
  for (int i = 0; i < n; i++) {
    float im = b[2 * i], re = b[2 * i + 1];
    sum += sqrtf(re * re + im * im);
  }
  portENTER_CRITICAL_ISR(&ampMux);
  amp[ampHead] = sum / n;
  ampHead = (ampHead + 1) % WINDOW;
  if (ampCount < WINDOW) ampCount++;
  portEXIT_CRITICAL_ISR(&ampMux);
}

float motionIndex() {
  float v[WINDOW];
  int c;
  portENTER_CRITICAL(&ampMux);
  c = ampCount;
  for (int i = 0; i < c; i++) v[i] = amp[i];
  portEXIT_CRITICAL(&ampMux);
  if (c < 8) return -1;
  float mean = 0;
  for (int i = 0; i < c; i++) mean += v[i];
  mean /= c;
  float var = 0;
  for (int i = 0; i < c; i++) var += (v[i] - mean) * (v[i] - mean);
  return sqrtf(var / c);  // desviación estándar de la amplitud
}

void sendHeartbeat() {
  HTTPClient http;
  http.begin(String(SERVER_BASE) + "/api/devices/" DEVICE_ID "/heartbeat");
  http.addHeader("Content-Type", "application/json");
  http.POST("{\"firmware\":\"" FIRMWARE "\",\"rssi\":" + String(WiFi.RSSI()) + "}");
  http.end();
}

void sendState(const String& state, float confidence, float motion) {
  HTTPClient http;
  http.begin(String(SERVER_BASE) + "/api/events");
  http.addHeader("Content-Type", "application/json");
  String json = "{\"event_id\":\"" DEVICE_ID "-csi-" + String(millis()) + "\",\"device_id\":\"" DEVICE_ID
                "\",\"source_id\":\"esp32_csi\",\"type\":\"presence\",\"mode\":\"live\",\"quality\":" + String(confidence, 2) +
                ",\"payload\":{\"station_id\":\"" STATION_ID "\",\"source\":\"csi\",\"state\":\"" + state +
                "\",\"confidence\":" + String(confidence, 2) + ",\"motion\":" + String(motion, 3) + "}}";
  int code = http.POST(json);
  Serial.printf("[csi] %s conf=%.2f motion=%.3f HTTP %d\n", state.c_str(), confidence, motion, code);
  http.end();
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); }
  Serial.println("\nWi-Fi OK " + WiFi.localIP().toString());
  memcpy(apBssid, WiFi.BSSID(), 6);

  wifi_csi_config_t cfg = {};
  cfg.lltf_en = true;
  cfg.htltf_en = true;
  cfg.stbc_htltf2_en = true;
  cfg.ltf_merge_en = true;
  cfg.channel_filter_en = true;
  cfg.manu_scale = false;
  ESP_ERROR_CHECK(esp_wifi_set_csi_config(&cfg));
  ESP_ERROR_CHECK(esp_wifi_set_csi_rx_cb(&onCsi, NULL));
  ESP_ERROR_CHECK(esp_wifi_set_csi(true));

  bootAt = millis();
  sendHeartbeat();
  lastHeartbeat = millis();
  Serial.println("Calibrando con la zona vacía...");
}

void loop() {
  unsigned long now = millis();
  if (WiFi.status() != WL_CONNECTED) { WiFi.reconnect(); delay(1000); return; }

  if (now - lastReport >= REPORT_MS) {
    lastReport = now;
    float m = motionIndex();
    if (m >= 0) {
      if (now - bootAt < CALIBRATION_MS) {
        baseline = baseline == 0 ? m : baseline * 0.8f + m * 0.2f;  // media móvil de la línea base
      } else {
        float ratio = baseline > 0 ? m / baseline : 0;
        String state = ratio >= K_ACTIVITY ? "actividad" : ratio >= K_PRESENCE ? "quietud" : "sin_presencia";
        // confianza: qué tan lejos está del umbral más cercano (0.5–0.95)
        float margin = state == "actividad" ? (ratio - K_ACTIVITY) / K_ACTIVITY
                     : state == "quietud" ? min(ratio - K_PRESENCE, K_ACTIVITY - ratio) / K_PRESENCE
                     : (K_PRESENCE - ratio) / K_PRESENCE;
        float confidence = constrain(0.5f + margin, 0.5f, 0.95f);
        if (state != lastState || now - lastSent >= KEEPALIVE_MS) {
          sendState(state, confidence, ratio);
          lastState = state;
          lastSent = now;
        }
      }
    }
  }

  if (now - lastHeartbeat >= HEARTBEAT_MS) {
    lastHeartbeat = now;
    sendHeartbeat();
  }
  delay(10);
}
