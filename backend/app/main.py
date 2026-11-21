from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .agent.router import router as agent_router
from .compile.router import router as compile_router
from .settings import settings

app = FastAPI(title="Circuito Vivo API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "model": settings.anthropic_model,
        "agent": bool(settings.anthropic_api_key) or None,
        "commit": settings.render_git_commit or None,
    }


app.include_router(compile_router, prefix="/api")
app.include_router(agent_router, prefix="/api")
