"""
Standalone Isolation Forest training script.

Run this once before starting the server (or whenever you want to retrain):

    cd services/python-fast-api
    python train_model.py

The trained model is saved to model/isolation_forest.joblib and will be
loaded automatically by the FastAPI server on startup.
"""

import sys
import pathlib
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent / "src"))

from anomaly_detector import (
    generate_training_samples,
    AnomalyDetector,
    _MODEL_CACHE_PATH,
    N_TRAINING_SAMPLES,
)


def main() -> None:
    print(f"Generating {N_TRAINING_SAMPLES} synthetic training samples...")
    t0 = time.perf_counter()
    samples = generate_training_samples()
    t1 = time.perf_counter()
    print(f"  Done in {t1 - t0:.2f}s")

    print("Training Isolation Forest...")
    d = AnomalyDetector()
    d.train(samples)  # _save_to_disk() is called inside train()
    t2 = time.perf_counter()
    print(f"  Done in {t2 - t1:.2f}s")

    print(f"Model saved to: {_MODEL_CACHE_PATH}")
    print(f"Total time: {t2 - t0:.2f}s")


if __name__ == "__main__":
    main()
