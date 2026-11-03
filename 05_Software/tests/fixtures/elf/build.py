"""Build once with the README's pinned xPack GCC, or check a reproduction with --check."""
import argparse
import hashlib
import pathlib
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--arm-bin', type=pathlib.Path, required=True)
parser.add_argument('--riscv-bin', type=pathlib.Path, required=True)
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parent
for arch, folder, flags in [
    ('arm-none-eabi', args.arm_bin.resolve(), ['-mcpu=cortex-m4', '-mthumb']),
    ('riscv-none-elf', args.riscv_bin.resolve(), ['-march=rv32imac', '-mabi=ilp32']),
]:
    for label, size in [('before', 16), ('after', 64)]:
        with tempfile.TemporaryDirectory(prefix='vera-elf-') as temp:
            output = pathlib.Path(temp)/'image.elf'
            command = [str(folder/f'{arch}-gcc'), *flags, '-O0', '-g', '-gdwarf-4',
                       '-ffreestanding', '-fno-builtin', '-fno-unwind-tables',
                       '-fno-asynchronous-unwind-tables', '-nostdlib',
                       '-frandom-seed=vera-elf', f'-fdebug-prefix-map={root}=.',
                       f'-DWORKSPACE={size}', '-Wl,--build-id=none',
                       '-T', 'firmware.ld', 'firmware.c', '-o', str(output)]
            subprocess.run(command, cwd=root, check=True)
            data = output.read_bytes()
            target = root/f'{arch}-{label}.elf'
            if args.check:
                assert data == target.read_bytes(), f'ELF differs: {target}'
            else:
                target.write_bytes(data)
            print(target.name, len(data), hashlib.sha256(data).hexdigest())
