#!/usr/bin/env python3
"""
create_user.py — CLI script to create intercom users.

Usage:
    python create_user.py <username> <password> <role>

Roles:
    receiver  — the person receiving calls (the host, on their PC)
    caller    — the person initiating calls (on a phone or remote device)

Example:
    python create_user.py host MyPassword123 receiver
    python create_user.py user1 UserPassword456 caller

After running, you'll see a TOTP QR code URL to open in your browser.
Scan it with Google Authenticator to set up 2FA for this user.
"""

import sys
import asyncio
import os

# Add server directory to path so we can import our modules
sys.path.insert(0, os.path.dirname(__file__))

# Load .env so JWT_SECRET is available when auth.py imports
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

from database import init_db, create_user, get_user
from auth import hash_password, generate_totp_secret
import pyotp


async def main():
    if len(sys.argv) != 4:
        print("Usage: python create_user.py <username> <password> <role>")
        print("Roles: receiver, caller")
        sys.exit(1)

    username = sys.argv[1]
    password = sys.argv[2]
    role = sys.argv[3]

    if role not in ("receiver", "caller"):
        print(f"Error: role must be 'receiver' or 'caller', got '{role}'")
        sys.exit(1)

    # Initialize database
    await init_db()

    # Check if user already exists
    existing = await get_user(username)
    if existing:
        print(f"Error: user '{username}' already exists")
        sys.exit(1)

    # Hash password with bcrypt
    password_hash = hash_password(password)

    # Generate TOTP secret for Google Authenticator
    totp_secret = generate_totp_secret()

    # Create user in database
    await create_user(username, password_hash, totp_secret, role)

    print(f"\n{'='*60}")
    print(f"User created: {username} (role: {role})")
    print(f"{'='*60}")

    # Generate TOTP setup info
    totp = pyotp.TOTP(totp_secret)
    uri = totp.provisioning_uri(name=username, issuer_name="WebRTC Intercom")

    print(f"\nTOTP Secret: {totp_secret}")
    print(f"\nGoogle Authenticator Setup URI:")
    print(f"  {uri}")
    print(f"\nTo show as QR code, open this URL in your browser:")

    # Use Google Charts API to render QR (or use the /auth/setup-totp endpoint)
    import urllib.parse
    qr_url = f"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={urllib.parse.quote(uri)}"
    print(f"  {qr_url}")

    print(f"\nOr after starting the server, visit:")
    print(f"  http://localhost:8080/auth/setup-totp/{username}")
    print(f"\nScan the QR code with Google Authenticator (or any TOTP app).")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    asyncio.run(main())
