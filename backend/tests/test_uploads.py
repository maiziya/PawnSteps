"""Uploaded images are validated, re-encoded and stored under isolated UUID keys."""

from io import BytesIO

from PIL import Image

from conftest import assert_mutation, register_user


def png_bytes() -> bytes:
    output = BytesIO()
    Image.new("RGBA", (8, 8), (198, 107, 64, 128)).save(output, format="PNG")
    return output.getvalue()


async def test_image_upload_uses_safe_owned_path(client, guest_headers, monkeypatch, tmp_path):
    from app.config import settings

    monkeypatch.setattr(settings, "upload_dir", tmp_path)
    monkeypatch.setattr(settings, "storage_backend", "local")
    response = await client.post(
        "/api/uploads", headers=guest_headers,
        files={"file": ("../../untrusted.png", png_bytes(), "image/png")},
    )
    payload = assert_mutation(response)
    assert payload["image_url"].startswith(f"/uploads/{guest_headers['X-Guest-Id']}/")
    assert "untrusted" not in payload["image_url"]
    stored = tmp_path / payload["image_url"].removeprefix("/uploads/")
    assert stored.is_file()
    with Image.open(stored) as image:
        assert image.size == (8, 8)
        assert image.format == "PNG"


async def test_image_upload_rejects_forged_image_and_oversized_body(
    client, guest_headers, monkeypatch, tmp_path
):
    from app.config import settings

    monkeypatch.setattr(settings, "upload_dir", tmp_path)
    invalid = await client.post(
        "/api/uploads", headers=guest_headers,
        files={"file": ("fake.png", b"<svg><script>alert(1)</script></svg>", "image/png")},
    )
    assert invalid.status_code == 415
    monkeypatch.setattr(settings, "max_upload_bytes", 10)
    large = await client.post(
        "/api/uploads", headers=guest_headers, files={"file": ("image.png", png_bytes(), "image/png")}
    )
    assert large.status_code == 413
    assert not list(tmp_path.rglob("*"))


async def test_avatar_updates_profile_and_guest_cannot_set_one(client, guest_headers, monkeypatch, tmp_path):
    from app.config import settings

    monkeypatch.setattr(settings, "upload_dir", tmp_path)
    account = await register_user(client)
    headers = {"Authorization": f"Bearer {account['access_token']}"}
    response = await client.post(
        "/api/profile/avatar", headers=headers,
        files={"file": ("avatar.png", png_bytes(), "image/png")},
    )
    payload = assert_mutation(response)
    assert payload["user"]["avatar_url"].startswith("/uploads/")
    profile = assert_mutation(await client.get("/api/profile", headers=headers))
    assert profile["user"]["avatar_url"] == payload["user"]["avatar_url"]
    guest = await client.post(
        "/api/profile/avatar", headers=guest_headers,
        files={"file": ("avatar.png", png_bytes(), "image/png")},
    )
    assert guest.status_code == 401
