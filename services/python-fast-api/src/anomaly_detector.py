"""
Isolation Forest anomaly detector for wind turbine sensor data.

Generates realistic correlated training data, trains the model on startup,
and scores incoming SensorData in real-time.
"""

from __future__ import annotations

import base64
import io
import os
import pathlib
import random
import time
from typing import TYPE_CHECKING, Any

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest

if TYPE_CHECKING:
    from models.edgeguard import SensorData

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FEATURES = ["vibration", "temperature", "rpm", "powerOutput", "windSpeed", "bladePitch"]
N_TRAINING_SAMPLES = 5000
CONTAMINATION = 0.05
N_ESTIMATORS = 100
RANDOM_STATE = 42
ANOMALY_THRESHOLD = 0.5   # normalised score above which we call it an anomaly
MODEL_VERSION = "1.0.0"

# Persist the model inside the service repo directory so it survives container
# restarts without retraining.  The container mounts the repo at the service
# root, so this path resolves to:
#   <repo>/services/python-fast-api/model/isolation_forest.joblib
_SRC_DIR = pathlib.Path(__file__).parent          # .../src/
_MODEL_DIR = _SRC_DIR.parent / "model"            # .../model/
_MODEL_CACHE_PATH = str(_MODEL_DIR / "isolation_forest.joblib")


# ---------------------------------------------------------------------------
# Training-data generation
# ---------------------------------------------------------------------------

def generate_training_samples(n: int = N_TRAINING_SAMPLES) -> list[dict[str, Any]]:
    """
    Generate realistic correlated normal-operation turbine readings.

    Correlations used:
    - wind_speed  → power_output (positive, cubic-ish)
    - wind_speed  → rpm          (positive, linear)
    - wind_speed  → blade_pitch  (inverse — feather at high wind)
    - rpm         → vibration    (positive, slight)
    - power_output→ temperature  (positive)
    """
    rng = np.random.default_rng(RANDOM_STATE)

    # Base wind speed: Weibull-distributed (realistic for wind farms)
    wind_speed = rng.weibull(2.0, n) * 9.0 + 3.0          # roughly 3–25 m/s, peak ~10
    wind_speed = np.clip(wind_speed, 3.0, 25.0)

    # RPM scales roughly linearly with wind up to rated speed (~12 m/s)
    rpm_base = np.clip(wind_speed * 1.2, 8.0, 20.0)
    rpm = rpm_base + rng.normal(0, 0.3, n)
    rpm = np.clip(rpm, 5.0, 22.0)

    # Power output: roughly cubic until rated power (~12 m/s → 2000 kW)
    power_base = np.clip(0.5 * wind_speed ** 2.5, 100.0, 2000.0)
    power_output = power_base + rng.normal(0, 50, n)
    power_output = np.clip(power_output, 50.0, 2100.0)

    # Temperature rises with power output + ambient noise
    temperature = 35.0 + (power_output / 2000.0) * 25.0 + rng.normal(0, 2.5, n)
    temperature = np.clip(temperature, 30.0, 72.0)

    # Vibration has a slight correlation with RPM + random
    vibration = 0.3 + (rpm / 20.0) * 1.2 + rng.normal(0, 0.15, n)
    vibration = np.clip(vibration, 0.1, 2.5)

    # Blade pitch: feathers (increases) at high wind to limit power
    blade_pitch = np.where(
        wind_speed < 12.0,
        2.0 + (wind_speed / 12.0) * 6.0 + rng.normal(0, 0.5, n),
        8.0 + ((wind_speed - 12.0) / 13.0) * 20.0 + rng.normal(0, 0.8, n),
    )
    blade_pitch = np.clip(blade_pitch, 0.0, 30.0)

    samples = []
    for i in range(n):
        samples.append({
            "vibration":   float(round(vibration[i], 3)),
            "temperature": float(round(temperature[i], 2)),
            "rpm":         float(round(rpm[i], 2)),
            "powerOutput": float(round(power_output[i], 1)),
            "windSpeed":   float(round(wind_speed[i], 2)),
            "bladePitch":  float(round(blade_pitch[i], 2)),
        })
    return samples


def _samples_to_matrix(samples: list[dict[str, Any]]) -> np.ndarray:
    return np.array([[s[f] for f in FEATURES] for s in samples], dtype=np.float64)


# ---------------------------------------------------------------------------
# Singleton detector
# ---------------------------------------------------------------------------

class AnomalyDetector:
    def __init__(self) -> None:
        self._model: IsolationForest | None = None
        self._trained = False
        self._training_samples: int = 0
        self._score_min: float = -0.5
        self._score_max: float = 0.5

    # ------------------------------------------------------------------
    # Training
    # ------------------------------------------------------------------

    def train(self, samples: list[dict[str, Any]] | None = None) -> None:
        """Train the Isolation Forest. Optionally pass pre-generated samples."""
        if samples is None:
            samples = generate_training_samples(N_TRAINING_SAMPLES)

        X = _samples_to_matrix(samples)
        model = IsolationForest(
            n_estimators=N_ESTIMATORS,
            contamination=CONTAMINATION,
            random_state=RANDOM_STATE,
            n_jobs=-1,
        )
        model.fit(X)

        # Calibrate score range on training data so we can normalise to 0–1
        raw_scores = model.decision_function(X)
        self._score_min = float(raw_scores.min())
        self._score_max = float(raw_scores.max())

        self._model = model
        self._trained = True
        self._training_samples = len(samples)

        # Persist to disk for fast reload on container restart
        self._save_to_disk()

    def _save_to_disk(self) -> None:
        try:
            _MODEL_DIR.mkdir(parents=True, exist_ok=True)
            joblib.dump(
                {"model": self._model, "score_min": self._score_min, "score_max": self._score_max},
                _MODEL_CACHE_PATH,
            )
        except Exception:
            pass

    def load_from_disk(self) -> bool:
        try:
            if os.path.exists(_MODEL_CACHE_PATH):
                payload = joblib.load(_MODEL_CACHE_PATH)
                self._model = payload["model"]
                self._score_min = payload["score_min"]
                self._score_max = payload["score_max"]
                self._trained = True
                self._training_samples = N_TRAINING_SAMPLES
                return True
        except Exception:
            pass
        return False

    def serialize_model(self) -> str:
        """Return base64-encoded joblib bytes for storage in Couchbase."""
        buf = io.BytesIO()
        joblib.dump(
            {"model": self._model, "score_min": self._score_min, "score_max": self._score_max},
            buf,
        )
        return base64.b64encode(buf.getvalue()).decode()

    def deserialize_model(self, b64: str) -> None:
        buf = io.BytesIO(base64.b64decode(b64))
        payload = joblib.load(buf)
        self._model = payload["model"]
        self._score_min = payload["score_min"]
        self._score_max = payload["score_max"]
        self._trained = True
        self._training_samples = N_TRAINING_SAMPLES

    # ------------------------------------------------------------------
    # Scoring
    # ------------------------------------------------------------------

    def score(self, sensors: "SensorData") -> tuple[float, str]:
        """
        Score a sensor reading.
        Returns (anomaly_score 0–1, "normal"|"anomaly").
        Higher score = more anomalous.
        """
        if self._model is None:
            # Fallback: not trained yet — return neutral score
            return 0.1, "normal"

        features = [
            sensors.vibration,
            sensors.temperature,
            sensors.rpm,
            sensors.power_output,
            sensors.wind_speed,
            sensors.blade_pitch,
        ]
        X = np.array([features], dtype=np.float64)
        raw = float(self._model.decision_function(X)[0])

        # Normalise: decision_function returns positive = normal, negative = anomaly.
        # We invert and map to 0–1 (1 = most anomalous).
        span = max(self._score_max - self._score_min, 1e-6)
        normalised = 1.0 - (raw - self._score_min) / span
        normalised = float(np.clip(normalised, 0.0, 1.0))

        label = "anomaly" if normalised > ANOMALY_THRESHOLD else "normal"
        return round(normalised, 4), label

    def score_dict(self, sensor_dict: dict[str, Any]) -> tuple[float, str]:
        """Score from a plain dict with camelCase keys."""
        from models.edgeguard import SensorData
        sensors = SensorData.model_validate(sensor_dict)
        return self.score(sensors)

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    @property
    def is_trained(self) -> bool:
        return self._trained

    def get_status_dict(self) -> dict[str, Any]:
        return {
            "trained": self._trained,
            "trainingSamples": self._training_samples,
            "contamination": CONTAMINATION,
            "threshold": ANOMALY_THRESHOLD,
            "features": FEATURES,
            "version": MODEL_VERSION,
        }


# ---------------------------------------------------------------------------
# Normal and anomalous data generators
# ---------------------------------------------------------------------------

def generate_normal_point(turbine_id: int, seq: int) -> dict[str, Any]:
    """Generate a single realistic normal-operation sensor reading."""
    wind_speed = random.gauss(10.0, 2.5)
    wind_speed = max(3.0, min(22.0, wind_speed))

    rpm = max(8.0, min(21.0, wind_speed * 1.2 + random.gauss(0, 0.4)))
    power_output = max(100.0, min(2050.0, 0.5 * wind_speed ** 2.5 + random.gauss(0, 60)))
    temperature = max(32.0, min(70.0, 35.0 + (power_output / 2000.0) * 25.0 + random.gauss(0, 2.0)))
    vibration = max(0.1, min(2.8, 0.3 + (rpm / 20.0) * 1.2 + random.gauss(0, 0.12)))
    blade_pitch = (
        2.0 + (wind_speed / 12.0) * 6.0 + random.gauss(0, 0.4)
        if wind_speed < 12.0
        else 8.0 + ((wind_speed - 12.0) / 13.0) * 20.0 + random.gauss(0, 0.6)
    )
    blade_pitch = max(0.0, min(30.0, blade_pitch))

    return {
        "vibration":   round(vibration, 3),
        "temperature": round(temperature, 2),
        "rpm":         round(rpm, 2),
        "powerOutput": round(power_output, 1),
        "windSpeed":   round(wind_speed, 2),
        "bladePitch":  round(blade_pitch, 2),
    }


def generate_anomalous_point(turbine_id: int, seq: int) -> dict[str, Any]:
    """
    Generate a sensor reading with extreme values that will score as anomaly.
    Randomises the failure mode each call.
    """
    failure_mode = random.choice(["overheating", "mechanical_failure", "stall", "power_surge"])

    if failure_mode == "overheating":
        return {
            "vibration":   round(random.uniform(2.5, 5.0), 3),
            "temperature": round(random.uniform(85.0, 120.0), 2),
            "rpm":         round(random.uniform(14.0, 18.0), 2),
            "powerOutput": round(random.uniform(1600.0, 2100.0), 1),
            "windSpeed":   round(random.uniform(9.0, 14.0), 2),
            "bladePitch":  round(random.uniform(8.0, 18.0), 2),
        }
    elif failure_mode == "mechanical_failure":
        return {
            "vibration":   round(random.uniform(6.0, 15.0), 3),
            "temperature": round(random.uniform(55.0, 80.0), 2),
            "rpm":         round(random.uniform(18.0, 28.0), 2),
            "powerOutput": round(random.uniform(100.0, 600.0), 1),
            "windSpeed":   round(random.uniform(8.0, 15.0), 2),
            "bladePitch":  round(random.uniform(1.0, 5.0), 2),
        }
    elif failure_mode == "stall":
        return {
            "vibration":   round(random.uniform(0.1, 0.4), 3),
            "temperature": round(random.uniform(32.0, 42.0), 2),
            "rpm":         round(random.uniform(0.0, 4.0), 2),
            "powerOutput": round(random.uniform(0.0, 80.0), 1),
            "windSpeed":   round(random.uniform(8.0, 16.0), 2),
            "bladePitch":  round(random.uniform(28.0, 45.0), 2),
        }
    else:  # power_surge
        return {
            "vibration":   round(random.uniform(3.0, 7.0), 3),
            "temperature": round(random.uniform(70.0, 95.0), 2),
            "rpm":         round(random.uniform(22.0, 35.0), 2),
            "powerOutput": round(random.uniform(2400.0, 3500.0), 1),
            "windSpeed":   round(random.uniform(18.0, 30.0), 2),
            "bladePitch":  round(random.uniform(0.0, 2.0), 2),
        }


# Module-level singleton
detector = AnomalyDetector()
