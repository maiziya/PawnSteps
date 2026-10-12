"""Reusable owner-scoped configuration; progress stays in each new task ledger."""
from copy import deepcopy
from datetime import timedelta
from uuid import UUID
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.models import Task, TaskTemplate, utcnow
from app.schemas import TaskCreate, TemplateDetails
from app.template_schemas import TemplateCreate, TemplatePatch, TemplateSummary
from app.services import schedules, tracker


BUILTINS = {
    'builtin-reading': {'name': '阅读计划', 'configuration': {'name': '读完一本书', 'target': 100, 'unit': '页', 'daily_minimum': 5, 'daily_goal': 10, 'stages': [{'value': 25, 'name': '完成第一阶段'}, {'value': 50, 'name': '完成一半'}, {'value': 75, 'name': '进入最后阶段'}, {'value': 100, 'name': '读完这本书'}]}},
    'builtin-exercise': {'name': '每日运动', 'configuration': {'name': '每日运动', 'target': 30, 'unit': '分钟', 'daily_quota': 10, 'daily_goal': 20, 'stages': [{'value': 7, 'name': '坚持一周'}, {'value': 14, 'name': '坚持两周'}, {'value': 21, 'name': '建立习惯'}, {'value': 30, 'name': '完成一个月'}]}},
    'builtin-practice': {'name': '学习练习', 'configuration': {'name': '完成一组练习', 'target': 20, 'unit': '题', 'daily_minimum': 2, 'daily_goal': 5, 'stages': [{'value': 5, 'name': '找到节奏'}, {'value': 10, 'name': '完成一半'}, {'value': 15, 'name': '巩固所学'}, {'value': 20, 'name': '完成练习'}]}},
}


def kind(configuration: dict) -> str:
    return 'course' if configuration.get('course_items') is not None else 'plan' if configuration.get('daily_plan') is not None else 'daily' if configuration.get('daily_quota', 0) > 0 else 'normal'


def target(configuration: dict) -> int:
    if configuration.get('course_items') is not None:
        return sum(not item['name'].endswith('/') for item in configuration['course_items'])
    if configuration.get('daily_plan') is not None:
        return sum(max(0, value) for value in configuration['daily_plan'])
    return configuration['target']


async def summaries(session: AsyncSession, owner_id: str) -> list[TemplateSummary]:
    builtins = []
    for identifier, preset in BUILTINS.items():
        configuration = TaskCreate.model_validate(preset['configuration']).model_dump(mode='json')
        builtins.append(TemplateSummary(id=identifier, name=preset['name'], kind=kind(configuration), target=target(configuration), unit=configuration['unit'], is_builtin=True))
    rows = (await session.execute(select(TaskTemplate.id, TaskTemplate.name, TaskTemplate.kind, TaskTemplate.target,
        TaskTemplate.unit, TaskTemplate.created_at, TaskTemplate.updated_at).where(TaskTemplate.owner_id == owner_id)
        .order_by(TaskTemplate.updated_at.desc(), TaskTemplate.id))).mappings().all()
    return builtins + [TemplateSummary(**{**row, 'id': str(row['id'])}) for row in rows]


async def owned(session: AsyncSession, owner_id: str, identifier: str | UUID) -> TaskTemplate:
    try:
        identifier = UUID(str(identifier))
    except ValueError:
        raise HTTPException(404, '模板不存在')
    row = await session.scalar(select(TaskTemplate).where(TaskTemplate.id == identifier, TaskTemplate.owner_id == owner_id))
    if row is None:
        raise HTTPException(404, '模板不存在')
    return row


async def unique_name(session: AsyncSession, owner_id: str, name: str, except_id: UUID | None = None) -> None:
    rows = (await session.execute(select(TaskTemplate.id, TaskTemplate.name).where(TaskTemplate.owner_id == owner_id))).all()
    if any(identifier != except_id and existing.casefold() == name.casefold() for identifier, existing in rows):
        raise HTTPException(409, '已有同名模板，请修改名称或选择更新已有模板')


def configuration_from_task(task: Task) -> dict:
    config = {'name': task.name, 'description': task.description, 'unit': task.unit, 'priority': task.priority,
        'target': task.target if task.course_items is None and task.daily_plan is None else 1,
        'daily_minimum': task.daily_minimum, 'daily_goal': task.daily_goal,
        'daily_quota': task.daily_quota if task.daily_plan is None else 0,
        'daily_plan': deepcopy(task.daily_plan), 'stages': deepcopy(task.stages),
        'course_items': [{'name': item['name'], 'done': False} for item in task.course_items] if task.course_items is not None else None,
        'schedule': schedules.configuration(task, tracker.today() + timedelta(days=1))[0].model_dump()}
    # Validate with the same contract used for task creation, then retain reusable fields only.
    validated = TaskCreate.model_validate(config).model_dump(mode='json')
    for field in ('category_id', 'reward_id', 'deadline', 'plan_start_date'):
        validated.pop(field, None)
    if validated['course_items'] is not None:
        validated['course_items'] = [{'name': item['name'], 'done': False} for item in validated['course_items']]
    return validated


async def detail(session: AsyncSession, owner_id: str, identifier: str) -> TemplateDetails:
    if identifier in BUILTINS:
        preset = BUILTINS[identifier]
        config = TaskCreate.model_validate(preset['configuration']).model_dump(mode='json')
        summary = TemplateSummary(id=identifier, name=preset['name'], kind=kind(config), target=target(config), unit=config['unit'], is_builtin=True)
    else:
        row = await owned(session, owner_id, identifier)
        config = deepcopy(row.configuration)
        summary = TemplateSummary(id=str(row.id), name=row.name, kind=row.kind, target=row.target, unit=row.unit, created_at=row.created_at, updated_at=row.updated_at)
    names = set((await session.scalars(select(Task.name).where(Task.owner_id == owner_id))).all())
    original = config['name']
    candidate = original
    index = 2
    while candidate in names:
        suffix = f' · {index}'
        candidate = original[:100 - len(suffix)] + suffix
        index += 1
    config['name'] = candidate
    config['category_id'] = config['reward_id'] = config['deadline'] = None
    config['plan_start_date'] = tracker.today() if config.get('daily_plan') is not None else None
    return TemplateDetails(**summary.model_dump(), configuration=TaskCreate.model_validate(config))


async def create(session: AsyncSession, owner_id: str, body: TemplateCreate) -> dict:
    task = await tracker.get_task(session, owner_id, body.source_task_id)
    await unique_name(session, owner_id, body.name)
    count = await session.scalar(select(func.count()).select_from(TaskTemplate).where(TaskTemplate.owner_id == owner_id))
    maximum = settings.guest_template_limit if owner_id.startswith('guest:') else settings.user_template_limit
    if count >= maximum:
        raise HTTPException(403, f'最多保存 {maximum} 个模板，请整理已有模板后再保存')
    config = configuration_from_task(task)
    session.add(TaskTemplate(owner_id=owner_id, name=body.name, kind=kind(config), target=target(config), unit=config['unit'], configuration=config))
    await session.flush()
    return await tracker.snapshot(session, owner_id)


async def edit(session: AsyncSession, owner_id: str, identifier: UUID, body: TemplatePatch) -> dict:
    row = await owned(session, owner_id, identifier)
    if body.name is not None:
        await unique_name(session, owner_id, body.name, row.id)
        row.name = body.name
    if body.source_task_id is not None:
        task = await tracker.get_task(session, owner_id, body.source_task_id)
        config = configuration_from_task(task)
        row.configuration, row.kind, row.target, row.unit = config, kind(config), target(config), config['unit']
    row.updated_at = utcnow()
    await session.flush()
    return await tracker.snapshot(session, owner_id)


async def remove(session: AsyncSession, owner_id: str, identifier: UUID) -> dict:
    row = await owned(session, owner_id, identifier)
    await session.delete(row)
    await session.flush()
    return await tracker.snapshot(session, owner_id)


async def migrate_owner(session: AsyncSession, source: str, destination: str) -> None:
    existing = {name.casefold() for name in (await session.scalars(select(TaskTemplate.name).where(TaskTemplate.owner_id == destination))).all()}
    rows = (await session.scalars(select(TaskTemplate).where(TaskTemplate.owner_id == source).order_by(TaskTemplate.created_at, TaskTemplate.id))).all()
    for row in rows:
        original, candidate, index = row.name, row.name, 2
        while candidate.casefold() in existing:
            suffix = f' · {index}'
            candidate = original[:60 - len(suffix)] + suffix
            index += 1
        row.name, row.owner_id = candidate, destination
        existing.add(candidate.casefold())
    await session.flush()


async def export_owned(session: AsyncSession, owner_id: str) -> list[dict]:
    rows = (await session.scalars(select(TaskTemplate).where(TaskTemplate.owner_id == owner_id).order_by(TaskTemplate.created_at, TaskTemplate.id))).all()
    return [{'id': row.id, 'name': row.name, 'kind': row.kind, 'configuration': row.configuration,
             'created_at': tracker.aware(row.created_at), 'updated_at': tracker.aware(row.updated_at)} for row in rows]
