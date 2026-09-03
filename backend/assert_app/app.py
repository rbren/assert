from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from . import verification
from .config import CANVAS_URL, CORS_ORIGINS, POLL_INTERVAL_SECONDS
from .db import engine, session_scope
from .models import Base, Remediation, Run
from .routes import router

log = logging.getLogger(__name__)


async def _poll_runs() -> None:
    """Ingest finished work even when no client is watching."""
    while True:
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
        try:
            with session_scope() as db:
                for run in db.scalars(
                    select(Run).where(Run.status == "investigating")
                ).all():
                    verification.sync_run(db, run)
                for rem in db.scalars(
                    select(Remediation).where(Remediation.status == "working")
                ).all():
                    verification.sync_remediation(db, rem)
        except Exception:
            log.exception("Run poller iteration failed")


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    task = asyncio.create_task(_poll_runs())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


def create_app() -> FastAPI:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
    )
    Base.metadata.create_all(engine)

    app = FastAPI(title="assert", version="0.1.0", lifespan=lifespan)

    if CORS_ORIGINS:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=CORS_ORIGINS,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(router, prefix="/api")

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True, "canvas_url": CANVAS_URL}

    return app


app = create_app()
