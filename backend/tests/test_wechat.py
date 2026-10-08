"""OAuth provider transport is mocked; state, browser binding and migration are real."""

from urllib.parse import parse_qs, urlparse

import httpx

from conftest import assert_mutation, create_task


async def test_wechat_state_ticket_and_guest_migration(
    client, guest_headers, other_guest_headers, monkeypatch
):
    from app.config import settings
    from app.services import accounts

    monkeypatch.setattr(settings, "wechat_app_id", "configured-app-id")
    monkeypatch.setattr(settings, "wechat_app_secret", "configured-app-secret")
    calls = []

    class ProviderClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def get(self, url, params):
            calls.append((url, params))
            return httpx.Response(
                200,
                json={"openid": "test-wechat-openid", "access_token": "provider-access-token"},
                request=httpx.Request("GET", url),
            )

    task = await create_task(client, guest_headers, name="Migrate through WeChat")
    monkeypatch.setattr(accounts.httpx, "AsyncClient", ProviderClient)
    started = assert_mutation(await client.post("/api/auth/wechat/start", headers=guest_headers, json={}))
    authorization = urlparse(started["authorization_url"])
    assert authorization.hostname == "open.weixin.qq.com"
    state = parse_qs(authorization.query)["state"][0]
    assert client.cookies.get("pawnsteps_oauth")
    wrong_browser = await client.get(
        "/api/auth/wechat/callback", params={"state": state, "code": "provider-code"},
        headers={"Cookie": "pawnsteps_oauth=wrong-browser"},
    )
    assert wrong_browser.status_code == 401
    assert not calls

    callback = await client.get(
        "/api/auth/wechat/callback", params={"state": state, "code": "provider-code"}
    )
    assert callback.status_code == 303, callback.text
    assert "provider-access-token" not in callback.headers["location"]
    assert calls[0][1]["code"] == "provider-code"
    ticket = parse_qs(urlparse(callback.headers["location"]).fragment)["ticket"][0]
    repeated_state = await client.get(
        "/api/auth/wechat/callback", params={"state": state, "code": "provider-code"}
    )
    assert repeated_state.status_code == 401
    assert len(calls) == 1

    foreign_guest = await client.post(
        "/api/auth/wechat/exchange", headers=other_guest_headers, json={"ticket": ticket}
    )
    assert foreign_guest.status_code == 401
    exchanged = assert_mutation(await client.post(
        "/api/auth/wechat/exchange", headers=guest_headers, json={"ticket": ticket}
    ))
    assert exchanged["access_token"]
    assert exchanged["tasks"][0]["id"] == task["id"]
    assert exchanged["tasks"][0]["owner_id"].startswith("user:")
    replay = await client.post(
        "/api/auth/wechat/exchange", headers=guest_headers, json={"ticket": ticket}
    )
    assert replay.status_code == 401
