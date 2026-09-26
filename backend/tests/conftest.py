import os

# Las pruebas usan su propia base: nunca tocan factory_pulse.db (datos y layout reales).
# Se define antes de que cualquier módulo importe app.config.
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test_factory_pulse.db")
