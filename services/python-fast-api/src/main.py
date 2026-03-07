import asyncio
import logging
import uvicorn
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI
from utils import log
from routes.base import router
from routes.health import health_router
from routes.system import system_router
from routes.connection import connection_router
from routes.turbines import turbines_router
from routes.storage import storage_router
from routes.metrics import metrics_router
from routes.stream import stream_router
from routes.model import model_router
from simulation import engine
import conf
from init import init, deinit

log.init(conf.get_log_level())
logger = log.get_logger(__name__)


async def _init_couchbase_and_model(app: FastAPI) -> None:
    """
    Initialise Couchbase connection and load the pre-trained Isolation Forest
    model from disk. Runs in a background thread so the event loop is not
    blocked during the potentially slow Couchbase wait-until-ready.

    The model must be pre-trained by running train_model.py before starting
    the server.
    """
    import db
    from anomaly_detector import detector

    loop = asyncio.get_event_loop()

    # Connect to Couchbase (blocking — run in thread)
    logger.info("Connecting to Couchbase...")
    try:
        await loop.run_in_executor(None, db.init_db)
        logger.info("Couchbase connected. Keyspaces initialised.")
        app.state.db_ready = True
        state = await db.load_pipeline_state()
        if state is not None and "sequence_number" in state:
            n = state["sequence_number"]
            engine.sequence_number = n
            logger.info("Restored pipeline sequence_number from Couchbase: %s", n)
    except Exception as exc:
        logger.warning(f"Couchbase connection failed (running without persistence): {exc}")
        app.state.db_ready = False
        return

    # Load the pre-trained model from disk
    if detector.load_from_disk():
        logger.info(f"Loaded Isolation Forest from disk ({detector._training_samples} samples).")
    else:
        logger.warning(
            "No pre-trained model found on disk. "
            "Run 'python train_model.py' from services/python-fast-api to generate it. "
            "Anomaly scoring will return neutral scores until a model is loaded."
        )

    # Persist model metadata to Couchbase
    asyncio.create_task(db.save_model_state(detector.get_status_dict()))

    app.state.detector = detector
    logger.info("Anomaly detector ready.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if conf.USE_AUTH:
        from utils import auth
        app.state.auth_client = auth.AuthClient(conf.get_auth_config())
    else:
        logger.warning("Authentication is disabled (set USE_AUTH to enable)")

    app.state.engine = engine

    # Standard init hooks
    await init(app)

    # Couchbase + Isolation Forest (non-blocking — failures are soft)
    asyncio.create_task(_init_couchbase_and_model(app))

    yield

    # Shutdown
    await engine.stop()
    await deinit(app)


app = FastAPI(
    title="EdgeGuard API",
    version="0.1.0",
    docs_url="/docs",
    lifespan=lifespan,
    debug=conf.get_http_expose_errors(),
)

app.include_router(router)
app.include_router(health_router)
app.include_router(system_router)
app.include_router(connection_router)
app.include_router(turbines_router)
app.include_router(storage_router)
app.include_router(metrics_router)
app.include_router(stream_router)
app.include_router(model_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def main() -> None:
    if not conf.validate():
        raise ValueError("Invalid configuration.")

    http_conf = conf.get_http_conf()
    logger.info(f"Starting API on port {http_conf.port}")
    uvicorn.run(
        "main:app",
        host=http_conf.host,
        port=http_conf.port,
        reload=http_conf.autoreload,
        log_level="info",
        log_config=None,
    )


if __name__ == "__main__":
    main()
