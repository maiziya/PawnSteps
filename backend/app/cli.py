"""Explicit one-time administrator bootstrap after applying database migrations."""
import argparse
import asyncio

from app.database import SessionLocal, engine
from app.services.accounts import create_admin


async def _run() -> None:
    async with SessionLocal() as session:
        print(await create_admin(session))
    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description="PawnSteps account administration")
    parser.add_argument("command", choices=["create-admin"])
    parser.parse_args()
    asyncio.run(_run())


if __name__ == "__main__":
    main()
