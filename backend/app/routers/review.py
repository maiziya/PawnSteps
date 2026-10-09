"""Validated owner-scoped weekly review entry point."""
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_owner_id
from app.database import get_session
from app.review_schemas import WeeklyReview
from app.services import review, tracker

router = APIRouter(prefix='/api/review', tags=['review'])


@router.get('/weekly', response_model=WeeklyReview)
async def weekly(session: Annotated[AsyncSession, Depends(get_session)],
                 owner_id: Annotated[str, Depends(get_owner_id)],
                 week_of: Annotated[date | None, Query()] = None):
    async with tracker.owner_transaction(session, owner_id):
        return await review.weekly(session, owner_id, week_of)
