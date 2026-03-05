from fastapi import APIRouter, BackgroundTasks

from anomaly_detector import detector, generate_training_samples

model_router = APIRouter(prefix="/api/model", tags=["model"])


@model_router.get("/status")
async def get_model_status():
    """Return Isolation Forest model metadata."""
    return detector.get_status_dict()


@model_router.post("/retrain")
async def retrain_model(background_tasks: BackgroundTasks):
    """
    Force retrain the Isolation Forest with fresh training data.
    Runs in the background; returns immediately.
    """
    def _retrain():
        import db
        import asyncio
        samples = generate_training_samples()
        detector.train(samples)
        # best-effort: save new model state
        try:
            loop = asyncio.new_event_loop()
            loop.run_until_complete(db.save_model_state(detector.get_status_dict()))
            loop.close()
        except Exception:
            pass

    background_tasks.add_task(_retrain)
    return {"ok": True, "message": "Retraining started in background"}
