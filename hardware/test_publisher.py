"""
Factory Pulse — Telemetry Test Publisher (HTTP & MQTT)
======================================================
Tests ingestion of presence, cycle, machine state, button press, and environment events.

Usage:
  python test_publisher.py --transport http --api-url http://localhost:8000/api/events
  python test_publisher.py --transport mqtt --broker localhost --port 1883
"""

import time
import uuid
import json
import argparse
import requests
from datetime import datetime

def send_http(url: str, event: dict):
    try:
        res = requests.post(url, json=event, timeout=2.0)
        print(f"[HTTP {res.status_code}] Evento enviado: {event['type']} (ID: {event['event_id']})")
    except Exception as e:
        print(f"[HTTP Error] {e}")

def send_mqtt(client, topic: str, event: dict):
    try:
        client.publish(topic, json.dumps(event))
        print(f"[MQTT] Publicado en {topic}: {event['type']}")
    except Exception as e:
        print(f"[MQTT Error] {e}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--transport", choices=["http", "mqtt"], default="http")
    parser.add_argument("--api-url", default="http://localhost:8000/api/events")
    parser.add_argument("--broker", default="localhost")
    parser.add_argument("--port", type=int, default=1883)
    args = parser.parse_args()

    mqtt_client = None
    if args.transport == "mqtt":
        import paho.mqtt.client as mqtt
        mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="test_publisher")
        mqtt_client.connect(args.broker, args.port, 60)
        mqtt_client.loop_start()

    print(f"Iniciando emisor de prueba vía {args.transport.upper()}...")

    # 1. Presencia
    ev_pres = {
        "event_id": f"test-pres-{uuid.uuid4().hex[:8]}",
        "device_id": "esp32-line1-st1",
        "source_id": "test_script",
        "occurred_at": datetime.utcnow().isoformat(),
        "type": "presence",
        "payload": {"station_id": "st-1", "present": True, "confidence": 0.99},
        "quality": 1.0,
        "mode": "live"
    }

    # 2. Ciclo de Máquina
    ev_cyc = {
        "event_id": f"test-cyc-{uuid.uuid4().hex[:8]}",
        "device_id": "esp32-line1-st2",
        "source_id": "test_script",
        "occurred_at": datetime.utcnow().isoformat(),
        "type": "cycle",
        "payload": {"station_id": "st-2", "cycle_time_seconds": 44.5, "is_good_piece": True, "total_parts": 1},
        "quality": 1.0,
        "mode": "live"
    }

    # 3. Botón Andon
    ev_btn = {
        "event_id": f"test-btn-{uuid.uuid4().hex[:8]}",
        "device_id": "esp32-line1-st1",
        "source_id": "test_script",
        "occurred_at": datetime.utcnow().isoformat(),
        "type": "button_press",
        "payload": {"station_id": "st-1", "button_name": "andon_yellow", "action": "request_material"},
        "quality": 1.0,
        "mode": "live"
    }

    events = [ev_pres, ev_cyc, ev_btn]

    for ev in events:
        if args.transport == "http":
            send_http(args.api_url, ev)
        else:
            send_mqtt(mqtt_client, "factory_pulse/plant1/line1/events", ev)
        time.sleep(0.5)

    if mqtt_client:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()

    print("Emisión de prueba finalizada.")

if __name__ == "__main__":
    main()
