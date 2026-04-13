"""
database.py — SQLite database setup using aiosqlite.
Stores user accounts: username, bcrypt password hash, TOTP secret, role.
"""

import aiosqlite
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "users.db")

async def init_db():
    """Create tables if they don't exist."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                totp_secret TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'caller'
            )
        """)
        await db.commit()

async def get_user(username: str):
    """Return user row as dict, or None if not found."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None

async def create_user(username: str, password_hash: str, totp_secret: str, role: str):
    """Insert a new user. Raises if username already exists."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO users (username, password_hash, totp_secret, role) VALUES (?, ?, ?, ?)",
            (username, password_hash, totp_secret, role)
        )
        await db.commit()
