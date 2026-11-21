from celery import Celery
from celery.signals import worker_init

from ..settings import settings

celery_app = Celery("circuito_vivo", broker=settings.redis_url, backend=settings.redis_url, include=["app.compile.tasks"])
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    result_expires=3600,
    worker_prefetch_multiplier=1,
    task_acks_late=False,
    broker_connection_retry_on_startup=True,
    task_always_eager=settings.compile_eager,
    # A compile never needs more than compile_timeout_s; the extra margin covers library installs.
    task_time_limit=settings.compile_timeout_s + 240,
)


@worker_init.connect
def _install_libraries_on_start(**_: object) -> None:
    """Make sure every board's libraries (Servo, ESP32Servo…) are installed before the first job."""
    from .boards import all_toolchains
    from .cli import ensure_libraries

    names = [lib for tc in all_toolchains() for lib in tc.libraries]
    try:
        ensure_libraries(names)
    except Exception:  # noqa: BLE001 — never prevent the worker from starting (offline, etc.)
        import logging

        logging.getLogger(__name__).warning("could not verify arduino-cli libraries", exc_info=True)
