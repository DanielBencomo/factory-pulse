import json
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional
import paho.mqtt.client as mqtt

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.db_models import DBEvent
from app.ws.manager import ws_manager

logger = logging.getLogger("factory_pulse.mqtt")

class MQTTAdapter:
    def __init__(self):
        self.client: Optional[mqtt.Client] = None
        self.is_connected: bool = False
        self.loop = None

    def start(self):
        if not settings.MQTT_ENABLED:
            logger.info("MQTT Adapter is disabled by configuration (settings.MQTT_ENABLED = False).")
            return

        try:
            # Paho MQTT v2 initialization
            self.client = mqtt.Client(
                callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                client_id="factory_pulse_backend"
            )
            if settings.MQTT_USERNAME and settings.MQTT_PASSWORD:
                self.client.username_pw_set(settings.MQTT_USERNAME, settings.MQTT_PASSWORD)

            self.client.on_connect = self._on_connect
            self.client.on_disconnect = self._on_disconnect
            self.client.on_message = self._on_message

            logger.info(f"Connecting to MQTT Broker at {settings.MQTT_BROKER_HOST}:{settings.MQTT_BROKER_PORT}...")
            self.client.connect_async(settings.MQTT_BROKER_HOST, settings.MQTT_BROKER_PORT, keepalive=60)
            self.client.loop_start()
        except Exception as e:
            logger.warning(f"Could not connect to MQTT broker: {e}. Running in HTTP-only ingestion mode.")

    def stop(self):
        if self.client:
            self.client.loop_stop()
            self.client.disconnect()
            logger.info("MQTT Adapter disconnected.")

    def _on_connect(self, client, userdata, flags, rc, properties=None):
        if rc == 0:
            self.is_connected = True
            topic = f"{settings.MQTT_TOPIC_PREFIX}/+/+/events"
            client.subscribe(topic)
            logger.info(f"MQTT Connected successfully! Subscribed to {topic}")
        else:
            self.is_connected = False
            logger.warning(f"MQTT Connection failed with code {rc}")

    def _on_disconnect(self, client, userdata, disconnect_flags, rc, properties=None):
        self.is_connected = False
        logger.warning(f"MQTT Disconnected (rc={rc}). Will attempt auto-reconnect.")

    def _on_message(self, client, userdata, msg):
        try:
            payload_str = msg.payload.decode("utf-8")
            data = json.loads(payload_str)
            logger.debug(f"Received MQTT message on {msg.topic}: {data}")

            # Schedule async task to store event in SQLite & broadcast
            asyncio.create_task(self._process_mqtt_event(data, msg.topic))
        except Exception as e:
            logger.error(f"Error parsing MQTT message: {e}")

    async def _process_mqtt_event(self, data: dict, topic: str):
        try:
            event_id = data.get("event_id", f"mqtt-{datetime.utcnow().timestamp()}")
            occurred_at = datetime.fromisoformat(data["occurred_at"].replace("Z", "+00:00")) if "occurred_at" in data else datetime.utcnow()
            if occurred_at.tzinfo is not None:
                occurred_at = occurred_at.astimezone(timezone.utc).replace(tzinfo=None)
            effect = None

            async with AsyncSessionLocal() as session:
                ev = DBEvent(
                    event_id=event_id,
                    device_id=data.get("device_id", "mqtt-device"),
                    source_id=f"mqtt:{topic}",
                    occurred_at=occurred_at,
                    received_at=datetime.utcnow(),
                    type=data.get("type", "presence"),
                    payload=data.get("payload", {}),
                    quality=float(data.get("quality", 1.0)),
                    mode=data.get("mode", "live")
                )
                session.add(ev)
                if ev.mode == "live" and ev.device_id:
                    from app.devices.registry import touch_device
                    await touch_device(session, ev.device_id, ingest_mode="mqtt")
                if ev.mode == "live":
                    from app.live.effects import apply_event_effects
                    effect = await apply_event_effects(session, ev)
                await session.commit()

            if effect:
                await ws_manager.broadcast({"type": effect})
            if ev.type == "position":
                return  # el procesador en vivo difunde las posiciones resumidas

            # Broadcast to WebSocket clients
            await ws_manager.broadcast({
                "type": "NEW_EVENT",
                "source": "mqtt",
                "event": {
                    "event_id": ev.event_id,
                    "device_id": ev.device_id,
                    "type": ev.type,
                    "payload": ev.payload,
                    "occurred_at": ev.occurred_at.isoformat(),
                    "quality": ev.quality,
                    "mode": ev.mode
                }
            })
        except Exception as e:
            logger.error(f"Error persisting MQTT event: {e}")

mqtt_adapter = MQTTAdapter()
