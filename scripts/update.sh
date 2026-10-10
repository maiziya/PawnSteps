#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Execute a snapshot so fetching a newer updater cannot alter the running script.
if [[ ${1:-} != --internal-run ]]; then
  update_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
  update_snapshot=$(mktemp "${TMPDIR:-/tmp}/pawnsteps-update.XXXXXX")
  cp -- "${BASH_SOURCE[0]}" "$update_snapshot"
  trap 'rm -f -- "$update_snapshot"' EXIT
  bash "$update_snapshot" --internal-run "$update_root" "$@"
  exit $?
fi
shift
project_root=$1
shift
cd -- "$project_root"

say() { printf '%s\n' "$*"; }
fail() { say "更新停止：$*" >&2; exit 1; }
help() {
  say '用法：bash scripts/update.sh [--check] [--force] [--env-file PATH]'
  say '默认更新 origin/main，自动备份并沿用现有 Compose 配置。'
  say '--check 仅检查可用版本；--force 重新部署当前版本。'
}

check_only=false
force=false
env_file=${PAWNSTEPS_ENV_FILE:-.env}
while (($#)); do
  case "$1" in
    --check) check_only=true; shift ;;
    --force) force=true; shift ;;
    --env-file) (($# >= 2)) || fail '缺少环境文件路径'; env_file=$2; shift 2 ;;
    --help|-h) help; exit 0 ;;
    *) fail "未知参数：$1" ;;
  esac
done
for program in git docker tar; do command -v "$program" >/dev/null || fail "缺少命令：$program"; done
[[ $(git rev-parse --show-toplevel) == "$project_root" ]] || fail '请在原部署项目中运行'
[[ $(git symbolic-ref --quiet --short HEAD) == main ]] || fail '服务器代码需要位于 main 分支'
git diff --quiet && git diff --cached --quiet || fail '存在未提交的代码改动，请先处理，环境设置应放在 .env 中'
[[ -f "$env_file" ]] || fail "找不到环境文件：$env_file"
env_file=$(cd -- "$(dirname -- "$env_file")" && printf '%s/%s' "$(pwd -P)" "$(basename -- "$env_file")")
export PAWNSTEPS_ENV_FILE="$env_file"
docker compose version >/dev/null

lock_dir="$project_root/.pawnsteps-update.lock"
mkdir "$lock_dir" 2>/dev/null || fail '另一次更新正在运行，或上次异常退出留下了 .pawnsteps-update.lock；确认没有更新进程后再移除锁目录'
printf '%s\n' "$$" > "$lock_dir/pid"
maintenance=false
migration_started=false
backup_dir=''
old_backend=''
old_frontend=''
old_nginx=''
backend_running=false
frontend_running=false
nginx_running=false
cleanup() {
  result=$?
  trap - EXIT
  set +e
  if ((result != 0)) && $maintenance; then
    if ! $migration_started; then
      $backend_running && docker start "$old_backend" >/dev/null
      $frontend_running && docker start "$old_frontend" >/dev/null
      $nginx_running && docker start "$old_nginx" >/dev/null
      say '备份阶段失败，已尝试恢复原有服务；数据库迁移尚未开始。' >&2
    else
      "${compose[@]}" stop nginx frontend backend >/dev/null 2>&1
      say '迁移或新版检查失败，应用已暂停；请排查后重新运行更新命令。' >&2
      say "备份保留在：${backup_dir}。数据库不会自动降级或清空。" >&2
    fi
  fi
  rm -f -- "$lock_dir/pid"
  rmdir "$lock_dir"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

say '检查 GitHub main 分支…'
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND=${GIT_SSH_COMMAND:-'ssh -o BatchMode=yes'}
git fetch origin main
checkout_before=$(git rev-parse HEAD)
target=$(git rev-parse FETCH_HEAD)
git merge-base --is-ancestor "$checkout_before" "$target" || fail '本地与 origin/main 已分叉，不能安全自动更新'
if $check_only; then
  say "当前代码：${checkout_before:0:12}；可用代码：${target:0:12}"
  git log --oneline "$checkout_before..$target"
  exit 0
fi

base_compose=(docker compose --project-directory "$project_root" --env-file "$env_file" -f "$project_root/compose.yaml")
database=$("${base_compose[@]}" ps -a -q database)
old_backend=$("${base_compose[@]}" ps -a -q backend)
old_frontend=$("${base_compose[@]}" ps -a -q frontend)
old_nginx=$("${base_compose[@]}" ps -a -q nginx)
[[ -n "$database" && -n "$old_backend" && -n "$old_frontend" && -n "$old_nginx" ]] || fail '找不到完整的现有部署，请确认环境文件和 Compose 项目名称一致'
[[ $(docker inspect -f '{{.State.Running}}' "$database") == true ]] || fail 'PostgreSQL 当前未运行'
old_backend_image=$(docker inspect -f '{{.Image}}' "$old_backend")
old_frontend_image=$(docker inspect -f '{{.Image}}' "$old_frontend")
backend_running=$(docker inspect -f '{{.State.Running}}' "$old_backend")
frontend_running=$(docker inspect -f '{{.State.Running}}' "$old_frontend")
nginx_running=$(docker inspect -f '{{.State.Running}}' "$old_nginx")
config_files=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$database")
[[ -n "$config_files" && "$config_files" != '<no value>' ]] || fail '无法确认现有 Compose 配置'
compose=(docker compose --project-directory "$project_root" --env-file "$env_file")
IFS=',' read -r -a existing_files <<< "$config_files"
for file in "${existing_files[@]}"; do
  [[ -f "$file" ]] || fail "原部署配置不存在：$file"
  compose+=(-f "$file")
done
if [[ -z ${TLS_CERT_DIR:-} ]]; then
  certificate_dir=$("${base_compose[@]}" config --environment | sed -n 's/^TLS_CERT_DIR=//p')
  if [[ -z "$certificate_dir" ]]; then
    certificate_dir=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/nginx/tls"}}{{.Source}}{{end}}{{end}}' "$old_nginx")
  fi
  [[ -z "$certificate_dir" ]] || export TLS_CERT_DIR="$certificate_dir"
fi

git merge --ff-only "$target"

# Validate the incoming deployment against the live database without exposing secrets.
identity_check=$(cat <<'PY'
import hashlib
import json
import sys

text = sys.stdin.read()
decoder = json.JSONDecoder()
config, end = decoder.raw_decode(text)
containers = json.loads(text[end:])
database, backend = containers
old_env = dict(entry.split('=', 1) for entry in backend['Config']['Env'] if '=' in entry)
incoming = config['services']
if incoming['backend']['environment']['DATABASE_URL'] != old_env.get('DATABASE_URL'):
    sys.exit('数据库连接配置发生变化，需要人工确认，更新尚未停止旧服务。')
if incoming['database']['image'] != database['Config']['Image']:
    sys.exit('PostgreSQL 镜像版本发生变化，需要独立规划数据库升级。')
volumes = [item for item in incoming['database']['volumes'] if item['target'] == '/var/lib/postgresql/data']
if len(volumes) != 1 or volumes[0]['type'] != 'volume':
    sys.exit('数据库持久卷配置发生变化，需要人工确认。')
expected = config['volumes'][volumes[0]['source']]['name']
actual = [item.get('Name') for item in database['Mounts'] if item['Destination'] == '/var/lib/postgresql/data']
if actual != [expected]:
    sys.exit('新版没有连接原有数据库持久卷，更新已停止。')
print(hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest())
PY
)
configuration_hash=$({ "${compose[@]}" config --format json; docker inspect "$database" "$old_backend"; } |
  docker run --rm --network none -i --entrypoint python "$old_backend_image" -c "$identity_check")
state_dir="$project_root/.pawnsteps-deploy"
mkdir -p "$state_dir"
current_state="$state_dir/current"
fingerprint=$(printf '%s\n' "$target" "$configuration_hash" "$old_backend" "$old_frontend" "$old_nginx")
if ! $force && [[ -f "$current_state" ]] && [[ $(cat "$current_state") == "$fingerprint" ]] &&
    $backend_running && $frontend_running && $nginx_running &&
    [[ $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$old_backend") == healthy ]]; then
  say "已经是最新部署：${target:0:12}"
  exit 0
fi

say '构建新版镜像，现有站点保持运行…'
project_name=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$database")
[[ -n "$project_name" && "$project_name" != '<no value>' ]] || fail '无法确认镜像所属项目'
rollback_version="$(date -u +%Y%m%dT%H%M%SZ)-$$"
old_backend_tag="${project_name}-rollback-backend:$rollback_version"
old_frontend_tag="${project_name}-rollback-frontend:$rollback_version"
# Keep old image manifests addressable when Compose rebuilds their mutable tags.
docker image tag "$old_backend_image" "$old_backend_tag"
docker image tag "$old_frontend_image" "$old_frontend_tag"
"${compose[@]}" build backend frontend migrate
"${compose[@]}" exec -T database pg_isready -U pawnsteps -d pawnsteps >/dev/null
backup_dir="$state_dir/backups/$(date -u +%Y%m%dT%H%M%SZ)-${target:0:12}-$$"
mkdir -p "$backup_dir"
cp -- "$env_file" "$backup_dir/environment.env"
for index in "${!existing_files[@]}"; do cp -- "${existing_files[$index]}" "$backup_dir/compose-$index.yaml"; done
printf 'checkout_before=%s\ntarget=%s\nbackend_image=%s\nfrontend_image=%s\n' \
  "$checkout_before" "$target" "$old_backend_tag" "$old_frontend_tag" > "$backup_dir/release.txt"

say '进入维护阶段，备份数据库和本地上传图片…'
maintenance=true
"${compose[@]}" stop nginx frontend backend
"${compose[@]}" exec -T database pg_dump -U pawnsteps -d pawnsteps --format=custom > "$backup_dir/database.dump"
[[ -s "$backup_dir/database.dump" ]] || fail '数据库备份为空'
"${compose[@]}" exec -T database pg_restore --list < "$backup_dir/database.dump" >/dev/null
docker run --rm --network none --volumes-from "$old_backend:ro" --entrypoint tar \
  "$old_backend_tag" -C /app/uploads -czf - . > "$backup_dir/uploads.tar.gz"
tar -tzf "$backup_dir/uploads.tar.gz" >/dev/null

say '执行数据库迁移…'
migration_started=true
"${compose[@]}" run --rm -T --no-deps migrate
say '启动新版并检查健康状态…'
"${compose[@]}" up -d --no-deps --force-recreate backend
new_backend=$("${compose[@]}" ps -q backend)
healthy=false
for ((attempt=0; attempt<90; attempt++)); do
  status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$new_backend")
  if [[ "$status" == healthy ]]; then healthy=true; break; fi
  [[ "$status" != exited && "$status" != dead ]] || break
  sleep 2
done
$healthy || fail '新版后端未通过健康检查，请查看 docker compose logs backend'
"${compose[@]}" up -d --no-deps --force-recreate frontend
frontend_ok=false
for ((attempt=0; attempt<30; attempt++)); do
  if "${compose[@]}" exec -T frontend node -e "fetch('http://127.0.0.1:3000/', {signal: AbortSignal.timeout(10000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then
    frontend_ok=true; break
  fi
  sleep 2
done
$frontend_ok || fail '新版前端未通过检查'
"${compose[@]}" up -d --no-deps --force-recreate nginx
proxy_ok=false
for ((attempt=0; attempt<15; attempt++)); do
  if response=$("${compose[@]}" exec -T nginx wget -q -T 10 --no-check-certificate -O- http://127.0.0.1/api/health) &&
      [[ "$response" == *'"status":"ok"'* || "$response" == *'"status": "ok"'* ]]; then
    proxy_ok=true; break
  fi
  sleep 2
done
$proxy_ok || fail '网站 API 入口未通过检查'
new_frontend=$("${compose[@]}" ps -q frontend)
new_nginx=$("${compose[@]}" ps -q nginx)
printf '%s\n' "$target" "$configuration_hash" "$new_backend" "$new_frontend" "$new_nginx" > "$state_dir/current.next"
mv -- "$state_dir/current.next" "$current_state"
maintenance=false
say "更新完成：${target:0:12}"
say "备份位置：$backup_dir"
