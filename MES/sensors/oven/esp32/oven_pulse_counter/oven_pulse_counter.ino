#include <WiFi.h>
#include <HTTPClient.h>

// ===== WIFI =====
const char* ssid = "UPC290399024";
const char* password = "tm3mqPpkHvvh";

// ===== API =====
// Prototyp FastAPI: http://192.168.0.160:8000/pulse
// Lokalnie Node/API_Vendo: http://192.168.0.160:3000/api/mes/oven/pulse
// Produkcja Node/API_Vendo: http://192.168.1.10:3000/api/mes/oven/pulse
const char* serverUrl = "http://192.168.0.160:3000/api/mes/oven/pulse";

// ===== SENSOR =====
const int sensorPin = 4;
const char* deviceId = "reflow_1";

// ===== LOGIKA =====
volatile bool pulseDetected = false;
volatile unsigned long lastInterrupt = 0;

void IRAM_ATTR isr() {
  unsigned long now = millis();

  // Piec daje wolne impulsy, wiec filtr 400 ms chroni przed podwojnym zliczeniem.
  if (now - lastInterrupt > 400) {
    pulseDetected = true;
    lastInterrupt = now;
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(sensorPin, INPUT);
  attachInterrupt(digitalPinToInterrupt(sensorPin), isr, RISING);

  WiFi.begin(ssid, password);
  Serial.print("Laczenie z WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nPolaczono z WiFi");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  if (pulseDetected) {
    pulseDetected = false;
    sendPulse();
  }
}

void sendPulse() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Brak WiFi!");
    return;
  }

  HTTPClient http;
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");

  String payload = "{\"device_id\":\"" + String(deviceId) + "\"}";
  int httpResponseCode = http.POST(payload);

  Serial.print("Impuls wyslany, kod: ");
  Serial.println(httpResponseCode);

  http.end();
}
