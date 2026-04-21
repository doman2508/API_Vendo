#include <WiFi.h>
#include <HTTPClient.h>

// ===== WIFI =====
const char* ssid = "MSX ELEKTRONIKA ";
const char* password = "msx@piastow@2000@";

// ===== API =====
// Produkcja Node/API_Vendo: http://192.168.1.10:3000/api/mes/oven/pulse
// Lokalnie Node/API_Vendo:   http://192.168.0.160:3000/api/mes/oven/pulse
const char* serverUrl = "http://192.168.1.10:3000/api/mes/oven/pulse";
const char* deviceId = "reflow_1";

// ===== PINY =====
const int sensorOutPin = 4;
const int sensorInPin = 21;

// ===== LOGIKA NPN =====
// HIGH = brak plytki
// LOW  = plytka (czujnik sciaga do GND)
const int objectState = LOW;
const int freeState = HIGH;

// ===== CZASY =====
const unsigned long objectStableMs = 120;
const unsigned long freeStableMs = 2500;
const unsigned long minPulseGapMs = 4000;
const unsigned long debugEveryMs = 1000;
const unsigned long httpTimeoutMs = 2500;
const unsigned long wifiRetryMs = 5000;

enum DetectionState {
  WAITING_FOR_OBJECT,
  OBJECT_COUNTED_WAITING_FOR_FREE
};

struct SensorRuntime {
  const char* sensorId;
  int pin;
  int lastRawState;
  unsigned long stateChangedAt;
  unsigned long lastPulseAt;
  DetectionState detectionState;
};

SensorRuntime sensors[] = {
  {"out", sensorOutPin, HIGH, 0, 0, WAITING_FOR_OBJECT},
  {"in", sensorInPin, HIGH, 0, 0, WAITING_FOR_OBJECT},
};

const size_t sensorCount = sizeof(sensors) / sizeof(sensors[0]);

unsigned long lastDebugAt = 0;
unsigned long lastWiFiAttemptAt = 0;

void connectWiFi();
void ensureWiFi();
void updateSensor(SensorRuntime& sensor, unsigned long now);
void printDebug(unsigned long now);
void sendPulse(const char* sensorId);

void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println();
  Serial.println("MES Oven Counter - dual sensor");
  Serial.println("--------------------------------");

  for (size_t i = 0; i < sensorCount; i++) {
    pinMode(sensors[i].pin, INPUT_PULLUP);
    sensors[i].lastRawState = digitalRead(sensors[i].pin);
    sensors[i].stateChangedAt = millis();

    Serial.print("Sensor ");
    Serial.print(sensors[i].sensorId);
    Serial.print(" na GPIO ");
    Serial.print(sensors[i].pin);
    Serial.print(" startuje ze stanem ");
    Serial.println(sensors[i].lastRawState == HIGH ? "HIGH" : "LOW");
  }

  connectWiFi();
}

void loop() {
  unsigned long now = millis();

  ensureWiFi();

  for (size_t i = 0; i < sensorCount; i++) {
    updateSensor(sensors[i], now);
  }

  if (now - lastDebugAt >= debugEveryMs) {
    lastDebugAt = now;
    printDebug(now);
  }

  delay(10);
}

void updateSensor(SensorRuntime& sensor, unsigned long now) {
  int rawState = digitalRead(sensor.pin);

  if (rawState != sensor.lastRawState) {
    sensor.lastRawState = rawState;
    sensor.stateChangedAt = now;

    Serial.print("[");
    Serial.print(sensor.sensorId);
    Serial.print("] Zmiana stanu: ");
    Serial.println(rawState == HIGH ? "HIGH" : "LOW");
  }

  unsigned long stableForMs = now - sensor.stateChangedAt;
  bool objectStable = rawState == objectState && stableForMs >= objectStableMs;
  bool freeStable = rawState == freeState && stableForMs >= freeStableMs;
  bool minGapPassed = now - sensor.lastPulseAt >= minPulseGapMs;

  if (sensor.detectionState == WAITING_FOR_OBJECT) {
    if (objectStable && minGapPassed) {
      sensor.detectionState = OBJECT_COUNTED_WAITING_FOR_FREE;
      sensor.lastPulseAt = now;

      Serial.print(">>> WYKRYTO [");
      Serial.print(sensor.sensorId);
      Serial.println("]");

      sendPulse(sensor.sensorId);
    }
  }

  if (sensor.detectionState == OBJECT_COUNTED_WAITING_FOR_FREE) {
    if (freeStable) {
      sensor.detectionState = WAITING_FOR_OBJECT;

      Serial.print("[");
      Serial.print(sensor.sensorId);
      Serial.println("] Czujnik wolny - gotowy na kolejna plytke");
    }
  }
}

void printDebug(unsigned long now) {
  Serial.println();
  Serial.println("--- DEBUG ---");
  Serial.print("WiFi: ");
  Serial.println(WiFi.status() == WL_CONNECTED ? "OK" : "BRAK");

  for (size_t i = 0; i < sensorCount; i++) {
    unsigned long stableForMs = now - sensors[i].stateChangedAt;

    Serial.print("[");
    Serial.print(sensors[i].sensorId);
    Serial.print("] GPIO=");
    Serial.print(sensors[i].pin);
    Serial.print(" | stan=");
    Serial.print(sensors[i].lastRawState == HIGH ? "HIGH" : "LOW");
    Serial.print(" | stabilny=");
    Serial.print(stableForMs);
    Serial.print("ms | tryb=");
    Serial.println(sensors[i].detectionState == WAITING_FOR_OBJECT ? "WAIT" : "BUSY");
  }
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  Serial.print("Laczenie z WiFi");

  unsigned long start = millis();

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");

    if (millis() - start > 20000) {
      Serial.println("\nWiFi timeout - restart ESP");
      ESP.restart();
    }
  }

  lastWiFiAttemptAt = millis();

  Serial.println("\nPolaczono z WiFi");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  unsigned long now = millis();

  if (now - lastWiFiAttemptAt < wifiRetryMs) {
    return;
  }

  lastWiFiAttemptAt = now;
  Serial.println("WiFi rozlaczone - proba ponownego polaczenia");
  connectWiFi();
}

void sendPulse(const char* sensorId) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.print("Brak WiFi - impuls [");
    Serial.print(sensorId);
    Serial.println("] nie wyslany");
    return;
  }

  HTTPClient http;
  http.setTimeout(httpTimeoutMs);
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");

  String payload = "{\"device_id\":\"" + String(deviceId) + "\",\"sensor_id\":\"" + String(sensorId) + "\"}";
  int httpCode = http.POST(payload);

  Serial.print("HTTP [");
  Serial.print(sensorId);
  Serial.print("] code: ");
  Serial.println(httpCode);

  if (httpCode > 0) {
    String response = http.getString();
    Serial.print("API [");
    Serial.print(sensorId);
    Serial.print("]: ");
    Serial.println(response);
  } else {
    Serial.print("HTTP ERROR [");
    Serial.print(sensorId);
    Serial.print("]: ");
    Serial.println(http.errorToString(httpCode));
  }

  http.end();
}
