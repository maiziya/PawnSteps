"""Email login validates expiration, single use, rate limits and attempt persistence."""

from datetime import timedelta

import pytest

from conftest import assert_mutation


@pytest.fixture
def sent_codes(monkeypatch):
    from app.services import accounts

    messages = {}

    async def capture_email(email, code):
        messages[email] = code

    monkeypatch.setattr(accounts, "_send_email", capture_email)
    return messages


async def test_email_code_is_hashed_single_use_and_rate_limited(
    client, guest_headers, session_factory, sent_codes
):
    from app.models import EmailCode

    email = "reader@example.com"
    request = await client.post("/api/auth/email-code", headers=guest_headers, json={"email": email})
    assert_mutation(request)
    code = sent_codes[email]
    assert len(code) == 6 and code.isdigit()
    assert code not in request.text
    async with session_factory() as session:
        record = await session.get(EmailCode, email)
        assert record.code != code

    repeated = await client.post("/api/auth/email-code", headers=guest_headers, json={"email": email})
    assert repeated.status_code == 429
    login = await client.post(
        "/api/auth/email-login", headers=guest_headers, json={"email": email, "code": code}
    )
    payload = assert_mutation(login)
    assert payload["access_token"]
    assert payload["user"]["email"] == email
    replay = await client.post(
        "/api/auth/email-login", headers=guest_headers, json={"email": email, "code": code}
    )
    assert replay.status_code == 401


async def test_five_wrong_email_codes_consume_attempts_across_failed_requests(
    client, guest_headers, session_factory, sent_codes
):
    from app.models import EmailCode

    email = "attempts@example.com"
    assert_mutation(await client.post("/api/auth/email-code", headers=guest_headers, json={"email": email}))
    wrong = "000000" if sent_codes[email] != "000000" else "111111"
    for _ in range(5):
        response = await client.post(
            "/api/auth/email-login", headers=guest_headers, json={"email": email, "code": wrong}
        )
        assert response.status_code == 401
    async with session_factory() as session:
        record = await session.get(EmailCode, email)
        assert record.attempts == 5
    blocked = await client.post(
        "/api/auth/email-login", headers=guest_headers, json={"email": email, "code": sent_codes[email]}
    )
    assert blocked.status_code == 401


async def test_expired_email_code_is_rejected(client, guest_headers, sent_codes, monkeypatch):
    from app.services import accounts

    email = "expired@example.com"
    assert_mutation(await client.post("/api/auth/email-code", headers=guest_headers, json={"email": email}))
    later = accounts._now() + timedelta(minutes=11)
    monkeypatch.setattr(accounts, "_now", lambda: later)
    response = await client.post(
        "/api/auth/email-login", headers=guest_headers, json={"email": email, "code": sent_codes[email]}
    )
    assert response.status_code == 401


async def test_registration_requires_email_ownership_and_consumes_code(client, guest_headers, sent_codes):
    body = {"username": "verifiedreader", "email": "verified@example.com", "password": "correct-horse-73!"}
    unverified = await client.post("/api/auth/register", headers=guest_headers, json=body)
    assert unverified.status_code == 422
    assert_mutation(await client.post(
        "/api/auth/email-code", headers=guest_headers, json={"email": body["email"]}
    ))
    body["email_code"] = sent_codes[body["email"]]
    registered = assert_mutation(await client.post("/api/auth/register", headers=guest_headers, json=body), 201)
    assert registered["user"]["email"] == body["email"]
    reused = await client.post(
        "/api/auth/email-login", headers=guest_headers,
        json={"email": body["email"], "code": body["email_code"]},
    )
    assert reused.status_code == 401
