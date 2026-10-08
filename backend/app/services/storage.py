"""Validated raster image uploads backed by local disk or S3."""
from io import BytesIO
from pathlib import Path
import warnings
from uuid import uuid4

import boto3
from anyio import to_thread
from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import settings


def _sanitize_image(data: bytes) -> tuple[bytes, str, str]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as probe:
                if probe.format not in {"JPEG", "PNG", "WEBP"}:
                    raise HTTPException(415, "Upload a PNG, JPEG or WebP image")
                if probe.width * probe.height > 16_000_000:
                    raise HTTPException(413, "Image dimensions exceed 16 megapixels")
                probe.verify()
            with Image.open(BytesIO(data)) as source:
                image = ImageOps.exif_transpose(source)
                image.thumbnail((2048, 2048))
                output = BytesIO()
                if "A" in image.getbands() or image.info.get("transparency") is not None:
                    image.convert("RGBA").save(output, format="PNG", optimize=True)
                    return output.getvalue(), "png", "image/png"
                image.convert("RGB").save(output, format="JPEG", quality=88, optimize=True)
                return output.getvalue(), "jpg", "image/jpeg"
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as exc:
        raise HTTPException(415, "The uploaded file is not a valid supported image") from exc


def _store_image(data: bytes, key: str, content_type: str) -> str:
    if settings.storage_backend == "s3":
        if not settings.s3_bucket or not settings.s3_public_base_url:
            raise HTTPException(503, "S3 image storage is not configured")
        client = boto3.client(
            "s3", region_name=settings.s3_region or None,
            endpoint_url=settings.s3_endpoint_url or None,
            aws_access_key_id=settings.s3_access_key_id or None,
            aws_secret_access_key=settings.s3_secret_access_key or None,
        )
        try:
            client.put_object(Bucket=settings.s3_bucket, Key=key, Body=data,
                              ContentType=content_type, CacheControl="public, max-age=31536000, immutable")
        except Exception as exc:
            raise HTTPException(503, "Image storage is temporarily unavailable") from exc
        return f"{settings.s3_public_base_url.rstrip('/')}/{key}"
    directory = Path(settings.upload_dir).resolve()
    path = directory / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return f"/uploads/{key}"


async def save_image(upload: UploadFile, owner_id: str) -> str:
    data = await upload.read(settings.max_upload_bytes + 1)
    await upload.close()
    if not data:
        raise HTTPException(422, "Choose an image to upload")
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(413, "Images must be smaller than 5 MB")
    cleaned, extension, content_type = await to_thread.run_sync(_sanitize_image, data)
    # UUID-only keys prevent path traversal and never retain a user-supplied filename.
    owner_key = owner_id.split(":", 1)[1]
    key = f"{owner_key}/{uuid4().hex}.{extension}"
    return await to_thread.run_sync(_store_image, cleaned, key, content_type)
