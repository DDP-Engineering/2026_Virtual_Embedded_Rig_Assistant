"""Create local test entry points; Windows uses pip's vendored distlib launcher."""
import os
import pathlib
import shutil
import sys

folder = pathlib.Path(sys.argv[1])
scripts = folder / 'sources'
scripts.mkdir(exist_ok=True)
shutil.copyfile(pathlib.Path(__file__).with_name('vendor.py'), folder / 'vendor.py')
for name in ('eim', 'xtensa-addr2line', 'riscv-addr2line'):
    script = '#!/usr/bin/env python3\nimport sys\nsys.path.insert(0, ' + repr(str(folder)) + ')\nfrom vendor import main\nmain()\n'
    if os.name == 'nt':
        from pip._vendor.distlib.scripts import ScriptMaker
        (scripts / (name + '.py')).write_text(script)
        maker = ScriptMaker(str(scripts), str(folder))
        maker.executable = sys.executable
        maker.variants = {''}
        maker.clobber = True
        maker.force = True
        maker.make(name + '.py')
    else:
        path = folder / name
        path.write_text(script.replace('#!/usr/bin/env python3', '#!' + sys.executable, 1))
        path.chmod(0o755)
