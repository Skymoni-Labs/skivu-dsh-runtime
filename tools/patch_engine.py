"""Version-locked Android integration. Refuse unknown upstream engine bytes."""
from pathlib import Path
import hashlib
import re

HASHES = {
    'dsh-fs-local': '63fbb41d2c33e07111884b798be507e68c2752acab8249c821c20ade436e894f',
    'dsh-session-persistence-jsonl': '973dd78679b2661d6f492343bc22b124ae958aa597d3b36c698a2c650f909984',
    'dsh-attachment-local': 'cd39685581b4573a453c6126f8ce73da0bf1257c378827ebb431d6d4064f7662',
    'dsh-host-webserver': '08907285802f0edd3aeb68c91fb443be2804879ab3d41104c4600424be06f3ab',
    'dsh-util-time': '9730c7bc2fe11c1f8a5b1a558e3872039fe6f5ab4fbb279c63de70a8d476b18a',
}

def patch_engine(modules: Path):
    for package, expected in HASHES.items():
        path = modules / '@deepseek-ai' / package / 'lib/index.js'
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError('Unrecognized upstream source: ' + package)
        text = data.decode('utf-8')
        if package in ('dsh-fs-local', 'dsh-session-persistence-jsonl', 'dsh-attachment-local'):
            pattern = r'import \{ ([^}\n]+) \} from "node:fs/promises";'
            matches = [m for m in re.finditer(pattern, text) if 'link' in m.group(1).split(', ')]
            if len(matches) != 1: raise ValueError('Exclusive publication import changed')
            match = matches[0]
            fields = [p for p in match.group(1).split(', ') if p != 'link']
            replacement = 'import { publishExclusive as link } from "skivu-runtime-fs";\n'
            replacement += 'import { ' + ', '.join(fields) + ' } from "node:fs/promises";'
            text = text[:match.start()] + replacement + text[match.end():]
        elif package == 'dsh-host-webserver':
            anchor = 'this.server.listen(this.config.port, this.config.host, () => {'
            if text.count(anchor) != 1: raise ValueError('Listener integration changed')
            text = text.replace(anchor, 'this.server.listen({fd: 3}, () => {')
        elif package == 'dsh-util-time':
            anchor = 'function canonicalClientTimeZone(value) {'
            if text.count(anchor) != 1: raise ValueError('Timezone integration changed')
            text = text.replace(anchor, anchor + '\n\tif (value === "GMT" || value === "+00:00") value = "UTC";')
        path.write_text(text, encoding='utf-8', newline='\n')
