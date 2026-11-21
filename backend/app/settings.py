from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]  # repo root

_MAC_BUNDLED_CLI = Path("/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli")


def _default_cli() -> str:
    return str(_MAC_BUNDLED_CLI) if _MAC_BUNDLED_CLI.exists() else "arduino-cli"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(ROOT / "backend" / ".env", ROOT / ".env"), extra="ignore")

    redis_url: str = "redis://127.0.0.1:6379/0"
    arduino_cli: str = _default_cli()
    #: Optional arduino-cli config file (data dir with installed cores). Empty = arduino-cli default.
    arduino_config_file: str = ""
    build_dir: Path = ROOT / "backend" / ".builds"
    shared_dir: Path = ROOT / "shared"
    compile_timeout_s: int = 180
    #: Run compiles inline (no Celery worker) — handy for tests / no-Redis dev.
    compile_eager: bool = False

    anthropic_api_key: str = ""
    #: LLM proxy base URL (e.g. the hackathon proxy; its token is in the URL, so keep it out of git).
    #: Pass-through only: the API key is still required. Empty = api.anthropic.com.
    anthropic_base_url: str = ""
    anthropic_model: str = "claude-opus-5-5"
    anthropic_effort: str = "medium"
    agent_max_tokens: int = 64000

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    #: Set by Render at runtime; reported by /api/health so CD can confirm which commit is live.
    render_git_commit: str = ""


settings = Settings()
