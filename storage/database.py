"""Database Module

Thread-safe SQLite connection pool management with context manager support.
Handles automatic initialization and migration of the quant database schema.
"""

import sqlite3
import logging
from pathlib import Path
from threading import Lock, local
from typing import Any, List, Dict, Optional, Generator
from contextlib import contextmanager
from config import settings


logger = logging.getLogger(__name__)


class DatabaseError(Exception):
    """Base exception for database operations."""
    pass


class QueryResult:
    """Wraps query results with convenient access methods."""

    def __init__(self, cursor: sqlite3.Cursor):
        self._cursor = cursor

    @property
    def columns(self) -> List[str]:
        return [col[0] for col in self._cursor.description] if self._cursor.description else []

    def all(self) -> List[Dict[str, Any]]:
        """Return all rows as list of dictionaries."""
        if not self._cursor.description:
            return []
        cols = self.columns
        return [dict(zip(cols, row)) for row in self._cursor.fetchall()]

    def first(self) -> Optional[Dict[str, Any]]:
        """Return the first row as a dictionary."""
        rows = self.all()
        return rows[0] if rows else None

    def scalar(self) -> Any:
        """Return single value from first column of first row."""
        if not self._cursor.description:
            return None
        row = self._cursor.fetchone()
        return row[0] if row else None


class DatabaseManager:
    """SQLite Connection Pool Manager

    Thread-safe singleton that manages a pool of SQLite connections.
    Supports context manager pattern for automatic connection release.

    Usage:
        db = DatabaseManager()
        with db.connection() as conn:
            conn.execute("SELECT * FROM stocks")

        results = db.query("SELECT * FROM stocks WHERE code=?", ("sh600519",))
        first_row = results.first()
    """
    _instance: Optional["DatabaseManager"] = None
    _lock: Lock = Lock()

    def __new__(cls) -> "DatabaseManager":
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        db_path = settings.get("data.base_path") / "quant.db" if Path(settings.get("data.base_path")).exists() else Path("quant.db")
        self.db_path = str(db_path)
        self._pool: List[sqlite3.Connection] = []
        self._in_use: set[sqlite3.Connection] = set()
        self._max_connections = 10
        self._min_connections = 2

        self._init_pool()
        self._run_migrations()
        self._initialized = True

    def _init_pool(self) -> None:
        """Initialize connection pool with minimum connections."""
        for _ in range(self._min_connections):
            conn = self._create_connection()
            self._pool.append(conn)

    def _create_connection(self) -> sqlite3.Connection:
        """Create a new SQLite connection with optimal settings."""
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")  # Write-Ahead Logging for concurrency
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA cache_size=-64000")  # 64MB cache
        return conn

    @contextmanager
    def connection(self) -> Generator[sqlite3.Connection, None, None]:
        """Get a connection from the pool with automatic release.

        Usage:
            with db.connection() as conn:
                conn.execute("INSERT INTO ...")
        """
        conn = self._acquire()
        try:
            yield conn
        finally:
            self._release(conn)

    def _acquire(self) -> sqlite3.Connection:
        """Acquire a connection from the pool."""
        with self._lock:
            if not self._pool and len(self._in_use) < self._max_connections:
                return self._create_connection()
            elif not self._pool:
                raise DatabaseError("Connection pool exhausted")
            conn = self._pool.pop()
            self._in_use.add(conn)
            return conn

    def _release(self, conn: sqlite3.Connection) -> None:
        """Release a connection back to the pool."""
        with self._lock:
        if conn in self._in_use:
            self._in_use.remove(conn)
            if len(self._pool) < self._max_connections:
                self._pool.append(conn)
            else:
                conn.close()

    def execute(self, sql: str, params: tuple = ()) -> int:
        """Execute a write query and return affected rows."""
        with self.connection() as conn:
            try:
                cursor = conn.execute(sql, params)
                conn.commit()
                return cursor.rowcount
            except sqlite3.Error as e:
                conn.rollback()
                raise DatabaseError(f"Execute failed: {e}")

    def query(self, sql: str, params: tuple = ()) -> QueryResult:
        """Execute a read query and return results."""
        with self.connection() as conn:
            try:
                cursor = conn.execute(sql, params)
                return QueryResult(cursor)
            except sqlite3.Error as e:
                raise DatabaseError(f"Query failed: {e}")

    def _run_migrations(self) -> None:
        """Run database migrations to ensure schema is up-to-date."""
        MIGRATIONS = [
            # v1 - Initial schema
            """CREATE TABLE IF NOT EXISTS stocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL UNIQUE,
                name TEXT,
                market TEXT CHECK(market IN ('sh', 'sz')),
                sector TEXT,
                industry TEXT,
                is_st BOOLEAN DEFAULT FALSE,
                is_delisted BOOLEAN DEFAULT FALSE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );""",
            """CREATE INDEX IF NOT EXISTS idx_stocks_symbol ON stocks (symbol);""",

            # v2 - Daily K-line data
            """CREATE TABLE IF NOT EXISTS daily_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stock_id INTEGER NOT NULL,
                date DATE NOT NULL,
                open REAL NOT NULL,
                high REAL NOT NULL,
                low REAL NOT NULL
                close REAL NOT NULL,
                volume BIGINT NOT NULL,
                amount REAL NOT NULL,
                adj_factor REAL DEFAULT 1.0,
                UNIQUE (stock_id, date),
                FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE CASCADE
            );""",
            """CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_data (date);""",

            # v3 - Strategy signals
            """CREATE TABLE IF NOT EXISTS strategy_signals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                strategy_name TEXT NOT NULL,
                symbol TEXT NOT NULL,
                signal_type TEXT CHECK(signal_type IN ('buy', 'sell', 'hold')),
                price REAL,
                confidence FLOAT DEFAULT 0.5,
                metadata JSON,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );""",

            # v4 - Backtest results
            """CREATE TABLE IF NOT EXISTS backtest_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                strategy_name TEXT NOT NULL,
                params JSON,
                start_date DATE,
                end_date DATE,
                total_return REAL,
                annualized_return REAL,
                max_drawdown REAL,
                sharpe_ratio REAL,
                win_rate FLOAT,
                metadata JSON,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );""",

            # v5 - Migration tracking
            """CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );"""
        ]

        with self.connection() as conn:
            conn.execute("PRAGMA foreign_keys = ON")
            for i, sql in enumerate(MIGRATIONS, 1):
                current_version = self._get_schema_version()
                if current_version < i:
                    logger.info(f"Applying migration v{i}...")
                    conn.execute(sql)
                    conn.execute("INSERT INTO schema_migrations (version) VALUES (?)", (i,))
            conn.commit()

    def _get_schema_version(self) -> int:
        """Get current database schema version."""
        try:
            result = self._pool[0].execute("SELECT MAX(version) FROM schema_migrations").fetchone()
            return result[0] if result and result[0] is not None else 0
        except (IndexError, sqlite3.Error):
            return 0

    def close_all(self) -> int:
        """Close all connections in the pool."""
        with self._lock:
            closed = len(self._pool) + len(self._in_use)
            for conn in self._pool:
                conn.close()
            for conn in self._in_use:
                conn.close()
            self._pool.clear()
            self._in_use.clear()
            return closed


db = DatabaseManager()  # Singleton instance
