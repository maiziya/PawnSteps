# Authentication and deployment security

PawnSteps uses random, private symmetric `JWT_SECRET` material and explicitly allows only HS256. User tokens require the `pawnsteps` audience and `user` role. Administrator tokens use a separate `pawnsteps-admin` audience and `admin` role, and every admin request also checks the account's current administrator flag. Passwords use passlib bcrypt. Password changes increment `token_version`, revoking previous sessions, and return a replacement user token.

Guest ownership is a random UUID v4 bearer capability. The browser stores the ID locally and sends it as `X-Guest-Id`. Anyone with that ID can access its guest data, so guest IDs should be treated as credentials. Account login or registration migrates guest data only when that same request supplies the guest ID and `migrate_guest` is enabled. Migration serializes both owners, resolves task name collisions, merges duplicate streak rewards, preserves reward references, and retains daily history through stable task IDs.

Email addresses on password registrations must be verified with `email_code`. Codes are generated with `secrets`, retained only as HMAC digests, expire after 10 minutes, permit five attempts, and are single-use. Per-IP and per-identifier rate counters live in the database. SMTP codes are printed only when `SMTP_ALLOW_CONSOLE=true` in a non-production environment. Production SMTP requires STARTTLS.

WeChat uses the official website OAuth QR flow with `snsapi_login`. OAuth state and two-minute exchange tickets are random, hashed in the database, and consumed once. Both stages are tied to an HttpOnly SameSite=Lax browser cookie. Guest migration additionally requires the original guest ID during ticket exchange. The redirect contains only a browser-bound short-lived ticket in its URL fragment, never a JWT. Configure the callback on the same public host as the frontend so its cookie survives the flow.

Uploads accept verified PNG, JPEG and WebP images with a 5 MB byte limit and 16-megapixel decoded dimension limit. Images are decoded, resized and re-encoded to remove metadata and injected payloads. Storage keys use generated UUIDs. The Nginx request body limit provides an additional pre-parser bound.

Production refuses default JWT secrets, wildcard trusted hosts or wildcard CORS origins. Use HTTPS at the public edge and configure `ALLOWED_HOSTS`, `CORS_ORIGINS`, `FRONTEND_URL`, and `WECHAT_REDIRECT_URI` for that origin. Keep SMTP, S3 and WeChat secrets in the deployment's secret store. Bootstrap the administrator explicitly with `python -m app.cli create-admin`; the command never promotes an existing ordinary account or silently resets an existing administrator password.

## Dependency audit exceptions

The requested `python-jose==3.5.0` dependency has two current audit findings without published fixes in this dependency chain. They are retained because this product explicitly requires python-jose and uses only the unaffected HMAC path:

- `CVE-2026-85394` / `GHSA-3qf3-8w2g-rqmx` concerns accepting DER asymmetric public keys as HMAC material when algorithms are not explicitly restricted. PawnSteps has no asymmetric JWT key path: encoding hardcodes HS256, decoding passes `algorithms=["HS256"]`, and its key is a private random symmetric secret. Do not replace `JWT_SECRET` with an asymmetric public key or broaden the algorithm list.
- `PYSEC-2026-1325` / `CVE-2024-23342` / `GHSA-wj6h-64fc-37mp` concerns timing leakage while signing with the transitive `ecdsa` package. PawnSteps never signs or verifies ECDSA tokens. The transitive package remains installed by python-jose but its affected signing operations are unused.

The application tests reject wrong audiences, stale versions, forged or invalid bearer tokens, guest fallback after invalid bearer authentication, repeated email codes, and incorrect administrator access. Re-run the dependency audit when updating dependencies and re-evaluate these exceptions if JWT algorithms change.
