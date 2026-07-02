"""App Factory Module

Implements the application factory pattern for Flask applications.
This allows creating multiple app instances with different configurations,
essential for testing and production deployment.
"""

from flask import Flask, jsonify
from config import settings
from storage.database import db as database


def create_app(config_name: str = None) -> Flask:
    """Create and configure a Flask application instance.

    Args:
        config_name: Configuration profile to use (development, testing, production).
                     If None, uses settings from config.json/env vars.

    Returns:
        Configured Flask application instance.
    """
    app = Flask(__name__)

    # 1. Load configuration
    if config_name:
        app.config["ENV"] = config_name
    else:
        app.config["ENV"] = settings.env

    app.config["DEBUG"] = settings.debug
    app.config["SECRET_KEY"] = "quant-next-secret-key"  # Should be in env vars for production
    app.config["JSON_SORT_KEYS"] = False

    # 2. Initialize database connection pool
    with app.app_context():
        database._init_pool()
        database._run_migrations()

    # 3. Register blueprints (routes)
    register_blueprints(app)

    # 4. Register error handlers
    register_error_handlers(app)

    return app


def register_blueprints(app: Flask) -> None:
    """Register all API routes."""
    from .routes import data_api, screening_api, backtest_api

    app.register_blueprint(data_api, url_prefix="/api/data")
    app.register_blueprint(screening_api, url_prefix="/api/screening")
    app.register_blueprint(backtest_api, url_prefix="/api/backtest")


def register_error_handlers(app: Flask) -> None:
    """Register global error handlers."""

    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"error": "Not Found", "message": str(e)}), 404

    @app.errorhandler(500)
    def server_error(e):
        return jsonify({"error": "Internal Server Error", "message": str(e)}), 500


# Default instance for development and CLI usage
app = create_app()

if __name__ == "__main__":
    import logging
    logging.basicConfig(level=settings.log_level)
    app.run(host=settings.app["host"], port=settings.app["port"])
