"""Deterministic vendor stand-in. Never builds ESP-IDF or touches hardware."""
import json
import pathlib
import subprocess
import sys
import os


def main():
    name = pathlib.Path(sys.argv[0]).stem
    args = sys.argv[1:]
    folder = pathlib.Path(__file__).parent
    if name == 'vendor':
        name, *args = args
    with (folder / 'commands.jsonl').open('a', encoding='utf-8') as log:
        log.write(json.dumps({'program': name, 'args': args}) + '\n')
    if name == 'eim':
        if len(args) != 2 or args[0] != 'run':
            raise SystemExit(2)
        # Actual platform parser, matching EIM 0.20.1's observed activation executor.
        if os.name == 'nt':
            activation = 'function idf.py { ConvertTo-Json -InputObject @($args) -Compress }\n'
            script = folder / ('activation_' + str(os.getpid()) + '.ps1')
            script.write_text(activation + args[1], encoding='utf-8')
            try:
                # Exercise the real parser; return its argv to this deterministic Python stand-in.
                result = subprocess.run(['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(script)], stdin=subprocess.DEVNULL, capture_output=True)
            finally:
                script.unlink(missing_ok=True)
            if result.returncode == 0:
                sys.argv = [__file__, 'idf', *json.loads(result.stdout)]
                main()
                return
            sys.stdout.buffer.write(result.stdout)
            sys.stderr.buffer.write(result.stderr)
        else:
            import shlex
            activation = 'function idf.py() { ' + shlex.quote(sys.executable) + ' ' + shlex.quote(__file__) + ' idf "$@"; }\n'
            result = subprocess.run(['bash', '-c', activation + args[1]], stdin=subprocess.DEVNULL)
        raise SystemExit(result.returncode)
    if name in ('xtensa-addr2line', 'riscv-addr2line'):
        if args == ['--version']:
            print('GNU addr2line (fixture) 2.42.0')
        else:
            assert pathlib.Path(args[args.index('-e') + 1]).read_text() == 'fixture-elf'
            print('app_main at main/main.c:1')
        return
    assert name == 'idf', name
    if args == ['--version']:
        print('ESP-IDF v5.4.2')
    elif 'build' in args:
        if 'seeded_compile_error' in pathlib.Path('main/main.c').read_text():
            print("main/main.c:1:29: error: 'seeded_compile_error' undeclared")
            raise SystemExit(1)
        pathlib.Path('build').mkdir(exist_ok=True)
        pathlib.Path('build/app.elf').write_text('fixture-elf')
        print('Project build complete. Fixture only.')
    elif 'flash' in args:
        print('Fixture flash only. No board connected.')
    elif 'coredump-info' in args:
        print('Core dump fixture: app_main at main/main.c:1')
    else:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
