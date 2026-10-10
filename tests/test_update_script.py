"""Exercise the real updater with isolated Git repositories and an instrumented Docker CLI."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
DOCKER_STUB = r'''#!/usr/bin/env python3
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile

args = sys.argv[1:]
state_path = Path(os.environ['FAKE_DOCKER_STATE'])
state = json.loads(state_path.read_text())
with Path(os.environ['FAKE_DOCKER_LOG']).open('a') as log:
    log.write(json.dumps({'args': args, 'tls': os.environ.get('TLS_CERT_DIR')}) + '\n')
scenario = os.environ.get('FAKE_DOCKER_SCENARIO', '')
ids = state['ids']
def save():
    state_path.write_text(json.dumps(state))
def service_for(identifier):
    return next((name for name, value in ids.items() if value == identifier), 'backend')
def inspection(identifier):
    service = service_for(identifier)
    return {
        'Config': {
            'Image': 'postgres:17-alpine' if service == 'database' else 'pawnsteps-' + service,
            'Env': ['DATABASE_URL=postgresql+asyncpg://pawnsteps:test@database:5432/pawnsteps'],
            'Labels': {'com.docker.compose.project.config_files': state['config_files']},
        },
        'Image': service + '-image-before',
        'Mounts': [{'Destination': '/var/lib/postgresql/data', 'Name': 'pawnsteps_postgres_data'}],
    }
if args[0] == 'inspect':
    if args[1] != '-f':
        print(json.dumps([inspection(identifier) for identifier in args[1:]]))
    else:
        template, identifier = args[2:4]
        service = service_for(identifier)
        if 'config_files' in template:
            print(state['config_files'])
        elif '/etc/nginx/tls' in template:
            print('/test/certificates' if state['tls'] else '')
        elif 'Health' in template:
            print('exited' if scenario == 'health-fails' and identifier.endswith('-new') else 'healthy')
        elif '.Image' in template:
            print(service + '-image-before')
        elif 'Running' in template:
            print(str(state['running'].get(service, True)).lower())
    sys.exit(0)
if args[0] == 'start':
    for identifier in args[1:]:
        state['running'][service_for(identifier)] = True
    save()
    sys.exit(0)
if args[0] == 'run':
    if '--entrypoint' in args and args[args.index('--entrypoint') + 1] == 'python':
        result = subprocess.run([sys.executable, '-c', args[-1]], input=sys.stdin.buffer.read(), capture_output=True)
        sys.stdout.buffer.write(result.stdout)
        sys.stderr.buffer.write(result.stderr)
        sys.exit(result.returncode)
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as archive:
        image = b'preserved image bytes'
        entry = tarfile.TarInfo('avatar.png')
        entry.size = len(image)
        archive.addfile(entry, io.BytesIO(image))
    sys.stdout.buffer.write(output.getvalue())
    sys.exit(0)
if args[0] != 'compose':
    sys.exit(2)
command_index = next((index for index, value in enumerate(args) if value in {'version', 'ps', 'config', 'build', 'exec', 'stop', 'run', 'up'}), None)
command = args[command_index:]
if command[0] == 'version':
    print('Docker Compose test stub')
elif command[0] == 'ps':
    print(ids[command[-1]])
elif command[0] == 'config':
    if '--environment' in command:
        environment = Path(os.environ['PAWNSTEPS_ENV_FILE']).read_text()
        print('\n'.join(line for line in environment.splitlines() if line.startswith('TLS_CERT_DIR=')))
        sys.exit(0)
    if state['tls'] and not os.environ.get('TLS_CERT_DIR'):
        sys.exit(2)
    print(json.dumps({
        'services': {
            'database': {'image': 'postgres:18-alpine' if scenario == 'database-image-changed' else 'postgres:17-alpine',
                         'volumes': [{'target': '/var/lib/postgresql/data', 'source': 'postgres_data', 'type': 'volume'}]},
            'backend': {'environment': {'DATABASE_URL': 'changed' if scenario == 'database-url-changed' else 'postgresql+asyncpg://pawnsteps:test@database:5432/pawnsteps'}},
        },
        'volumes': {'postgres_data': {'name': 'other_volume' if scenario == 'database-volume-changed' else 'pawnsteps_postgres_data'}},
    }))
elif command[0] == 'build':
    sys.exit(3 if scenario == 'build-fails' else 0)
elif command[0] == 'stop':
    for service in command[1:]:
        state['running'][service] = False
    save()
elif command[0] == 'run':
    sys.exit(4 if scenario == 'migration-fails' else 0)
elif command[0] == 'up':
    service = command[-1]
    ids[service] = service + '-new'
    state['running'][service] = True
    save()
elif command[0] == 'exec':
    if 'pg_dump' in command:
        if scenario == 'backup-fails':
            sys.exit(5)
        sys.stdout.buffer.write(b'PGDMP preserved task and history records')
    elif 'pg_restore' in command:
        sys.exit(0 if sys.stdin.buffer.read().startswith(b'PGDMP') else 1)
    elif 'wget' in command:
        print('{"status":"ok","service":"pawnsteps-api"}')
'''


class UpdateScriptTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='pawnsteps-updater-test-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / 'source'
        self.server = self.root / 'server checkout'
        self.remote = self.root / 'remote.git'
        self.source.mkdir()
        self.git('init', '-b', 'main', cwd=self.source)
        self.git('config', 'user.email', 'updater-test@example.com', cwd=self.source)
        self.git('config', 'user.name', 'Updater test', cwd=self.source)
        (self.source / 'scripts').mkdir()
        shutil.copy(ROOT / 'scripts/update.sh', self.source / 'scripts/update.sh')
        shutil.copy(ROOT / '.gitignore', self.source / '.gitignore')
        shutil.copy(ROOT / 'compose.yaml', self.source / 'compose.yaml')
        shutil.copy(ROOT / 'compose.tls.yaml', self.source / 'compose.tls.yaml')
        (self.source / 'version.txt').write_text('old')
        self.commit('Initial deployment')
        self.git('clone', '--bare', str(self.source), str(self.remote), cwd=self.root)
        self.git('clone', str(self.remote), str(self.server), cwd=self.root)
        self.git('remote', 'add', 'origin', str(self.remote), cwd=self.source)
        (self.server / '.env').write_text('POSTGRES_PASSWORD=test\nJWT_SECRET=keep-existing-secret\n')
        self.environment_before = (self.server / '.env').read_bytes()
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        docker = self.bin / 'docker'
        docker.write_text(DOCKER_STUB)
        docker.chmod(0o755)
        self.state_path = self.root / 'docker-state.json'
        self.log_path = self.root / 'docker-log.jsonl'
        self.state_path.write_text(json.dumps({
            'ids': {service: service + '-old' for service in ['database', 'backend', 'frontend', 'nginx']},
            'running': {service: True for service in ['database', 'backend', 'frontend', 'nginx']},
            'config_files': str(self.server / 'compose.yaml'), 'tls': False,
        }))

    def git(self, *args, cwd):
        return subprocess.run(['git', *args], cwd=cwd, text=True, capture_output=True, check=True).stdout.strip()

    def commit(self, message):
        self.git('add', '.', cwd=self.source)
        self.git('commit', '-m', message, cwd=self.source)

    def publish(self, updater_changed=False):
        (self.source / 'version.txt').write_text('new')
        if updater_changed:
            path = self.source / 'scripts/update.sh'
            path.write_text('# Updated executable snapshot\n' * 300 + path.read_text())
        self.commit('New application version')
        self.git('push', 'origin', 'main', cwd=self.source)
        return self.git('rev-parse', 'HEAD', cwd=self.source)

    def run_update(self, *arguments, scenario=''):
        environment = {**os.environ, 'PATH': str(self.bin) + os.pathsep + os.environ['PATH'],
                       'FAKE_DOCKER_STATE': str(self.state_path), 'FAKE_DOCKER_LOG': str(self.log_path),
                       'FAKE_DOCKER_SCENARIO': scenario}
        environment.pop('PAWNSTEPS_ENV_FILE', None)
        environment.pop('TLS_CERT_DIR', None)
        environment.pop('COMPOSE_PROJECT_NAME', None)
        return subprocess.run(['bash', 'scripts/update.sh', *arguments], cwd=self.server,
                              env=environment, capture_output=True, text=True, timeout=30)

    def calls(self):
        return [json.loads(line)['args'] for line in self.log_path.read_text().splitlines()]

    def test_update_preserves_configuration_and_saves_backups_before_migration(self):
        target = self.publish()
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD', cwd=self.server), target)
        self.assertEqual((self.server / '.env').read_bytes(), self.environment_before)
        backups = list((self.server / '.pawnsteps-deploy/backups').iterdir())
        self.assertEqual(len(backups), 1)
        self.assertTrue((backups[0] / 'database.dump').read_bytes().startswith(b'PGDMP'))
        self.assertTrue((backups[0] / 'uploads.tar.gz').stat().st_size > 0)
        calls = self.calls()
        dump = next(index for index, call in enumerate(calls) if 'pg_dump' in call)
        migration = next(index for index, call in enumerate(calls) if call[0] == 'compose' and 'run' in call)
        self.assertLess(dump, migration)
        self.assertFalse(any('down' in call or 'prune' in call for call in calls))
        self.assertFalse((self.server / '.pawnsteps-update.lock').exists())

    def test_an_already_pulled_checkout_still_deploys_without_a_release_marker(self):
        self.publish()
        self.git('pull', '--ff-only', cwd=self.server)
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any('build' in call for call in self.calls()))

    def test_a_second_update_skips_rebuild_but_force_redeploys(self):
        self.publish()
        self.assertEqual(self.run_update().returncode, 0)
        self.log_path.write_text('')
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('已经是最新部署', result.stdout)
        self.assertFalse(any('build' in call for call in self.calls()))
        self.assertEqual(self.run_update('--force').returncode, 0)
        self.assertTrue(any('build' in call for call in self.calls()))

    def test_build_failure_keeps_the_old_services_running(self):
        self.publish()
        result = self.run_update(scenario='build-fails')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('stop' in call for call in self.calls()))
        self.assertTrue(all(json.loads(self.state_path.read_text())['running'].values()))

    def test_backup_failure_restarts_old_containers_without_migrating(self):
        self.publish()
        result = self.run_update(scenario='backup-fails')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(all(json.loads(self.state_path.read_text())['running'].values()))
        self.assertFalse(any(call[0] == 'compose' and 'run' in call for call in self.calls()))

    def test_migration_and_health_failure_pause_apps_and_retain_backups(self):
        for scenario in ['migration-fails', 'health-fails']:
            with self.subTest(scenario=scenario):
                result = self.run_update(scenario=scenario)
                self.assertNotEqual(result.returncode, 0)
                state = json.loads(self.state_path.read_text())
                self.assertTrue(state['running']['database'])
                self.assertFalse(any(state['running'][service] for service in ['backend', 'frontend', 'nginx']))
                self.assertIn('备份保留在', result.stderr)
                self.assertTrue(list((self.server / '.pawnsteps-deploy/backups').glob('*/database.dump')))

    def test_database_connection_image_and_volume_changes_abort_before_stopping_apps(self):
        self.publish()
        for scenario in ['database-url-changed', 'database-image-changed', 'database-volume-changed']:
            with self.subTest(scenario=scenario):
                result = self.run_update(scenario=scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any('stop' in call for call in self.calls()))

    def test_tls_certificate_mount_and_existing_compose_files_are_reused(self):
        state = json.loads(self.state_path.read_text())
        state['tls'] = True
        state['config_files'] += ',' + str(self.server / 'compose.tls.yaml')
        self.state_path.write_text(json.dumps(state))
        self.publish()
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stderr)
        configs = [json.loads(line) for line in self.log_path.read_text().splitlines() if '"config"' in line]
        self.assertEqual(configs[-1]['tls'], '/test/certificates')

    def test_updater_can_update_its_own_file_without_changing_the_running_snapshot(self):
        self.publish(updater_changed=True)
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.server / 'scripts/update.sh').read_text().startswith('# Updated executable snapshot'))

    def test_explicit_environment_file_certificate_setting_is_preserved(self):
        state = json.loads(self.state_path.read_text())
        state['tls'] = True
        state['config_files'] += ',' + str(self.server / 'compose.tls.yaml')
        self.state_path.write_text(json.dumps(state))
        with (self.server / '.env').open('a') as environment:
            environment.write('TLS_CERT_DIR=/new/certificates\n')
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stderr)
        configs = [json.loads(line) for line in self.log_path.read_text().splitlines() if '"config"' in line]
        self.assertEqual(configs[-1]['tls'], '/new/certificates')

    def test_local_changes_and_concurrent_updates_are_rejected(self):
        (self.server / 'version.txt').write_text('local modification')
        self.assertNotEqual(self.run_update().returncode, 0)
        self.assertFalse(self.log_path.exists())
        self.git('restore', 'version.txt', cwd=self.server)
        (self.server / '.pawnsteps-update.lock').mkdir()
        self.assertNotEqual(self.run_update().returncode, 0)

    def test_check_only_fetches_version_without_changing_checkout_or_services(self):
        before = self.git('rev-parse', 'HEAD', cwd=self.server)
        self.publish()
        result = self.run_update('--check')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD', cwd=self.server), before)
        self.assertFalse(any('build' in call or 'stop' in call for call in self.calls()))


if __name__ == '__main__':
    unittest.main()
