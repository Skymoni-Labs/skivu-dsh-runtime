#!/usr/bin/env python3
"""Build a pinned offline runtime from verified upstream archives and npm lock.

Run on Linux. Installation scripts are disabled. All large inputs are explicit.
"""
import argparse, gzip, hashlib, json, os, posixpath, shutil, subprocess, tarfile
from pathlib import Path, PurePosixPath
from patch_engine import patch_engine

PROJECT = Path(__file__).resolve().parents[1]

def digest(path):
    with open(path, 'rb') as source: return hashlib.file_digest(source,'sha256').hexdigest()

def extract(archive, target, strip=0):
    with tarfile.open(archive, 'r:*') as source:
        for member in source:
            parts=PurePosixPath(member.name).parts[strip:]
            if not parts or parts==('.',): continue
            if member.name.startswith('/') or any(p in ('..','') for p in parts): raise ValueError('Archive path')
            name='/'.join(parts); dest=target/name
            dest.parent.mkdir(parents=True,exist_ok=True)
            if not dest.parent.resolve().is_relative_to(target.resolve()): raise ValueError('Archive parent')
            if member.isdir(): dest.mkdir(exist_ok=True)
            elif member.issym():
                link=member.linkname
                if link.startswith('/'): link=posixpath.relpath(link.lstrip('/'), posixpath.dirname(name) or '.')
                resolved=posixpath.normpath(posixpath.join(posixpath.dirname(name),link))
                if resolved=='..' or resolved.startswith('../'): raise ValueError('Archive symlink')
                dest.symlink_to(link)
            elif member.isfile() or member.islnk():
                with source.extractfile(member) as inp, dest.open('wb') as out: shutil.copyfileobj(inp,out)
                dest.chmod(member.mode & 0o777)
            else: raise ValueError('Unsupported archive member')

def archive_tree(root, output):
    def entries(folder):
        for entry in sorted(folder.iterdir(),key=lambda p:p.name):
            yield entry
            if entry.is_dir() and not entry.is_symlink(): yield from entries(entry)
    with output.open('wb') as raw, gzip.GzipFile(filename='',fileobj=raw,mode='wb',compresslevel=3,mtime=0) as compressed, tarfile.open(fileobj=compressed,mode='w',format=tarfile.PAX_FORMAT) as archive:
        for path in entries(root):
            name=path.relative_to(root).as_posix()
            info=tarfile.TarInfo(name); info.uid=info.gid=0;info.uname=info.gname='';info.mtime=0
            info.mode=path.lstat().st_mode & 0o777
            if path.is_symlink(): info.type=tarfile.SYMTYPE;info.linkname=os.readlink(path);archive.addfile(info)
            elif path.is_dir():info.type=tarfile.DIRTYPE;archive.addfile(info)
            else:
                info.type=tarfile.REGTYPE;info.size=path.stat().st_size
                with path.open('rb') as inp:archive.addfile(info,inp)

def main():
    parser=argparse.ArgumentParser()
    for arg in ('abi','base','base-sha256','node','node-sha256','host-node','work','ndk','proot','loader','output'):
        parser.add_argument('--'+arg,required=True)
    args=parser.parse_args(); abi=args.abi
    if abi not in ('arm64-v8a','x86_64'):raise ValueError('Unsupported ABI')
    if digest(args.base)!=args.base_sha256 or digest(args.node)!=args.node_sha256:raise ValueError('Input digest mismatch')
    work=Path(args.work);work.mkdir(parents=True,exist_ok=False)
    root=work/'root';root.mkdir();extract(args.base,root)
    node=root/'opt/node';node.mkdir(parents=True);extract(args.node,node,1)
    install=work/'npm';install.mkdir()
    for name in ('package.json','package-lock.json'):shutil.copyfile(PROJECT/'tools/npm'/name,install/name)
    host=Path(args.host_node)
    environment=dict(os.environ,PATH=str(host/'bin')+':'+os.environ.get('PATH',''))
    subprocess.run([str(host/'bin/node'),str(host/'lib/node_modules/npm/bin/npm-cli.js'),'ci','--ignore-scripts','--omit=dev','--os=linux','--cpu='+('arm64' if abi=='arm64-v8a' else 'x64'),'--libc=glibc','--no-audit','--no-fund'],cwd=install,env=environment,check=True)
    modules=root/'opt/dsh/node_modules';modules.parent.mkdir(parents=True)
    shutil.move(str(install/'node_modules'),modules)
    patch_engine(modules)
    for folder in (PROJECT/'engine').iterdir():
        package=json.loads((folder/'package.json').read_text())['name']
        if '/' in package or package.startswith('.'):raise ValueError('Invalid managed package name')
        shutil.copytree(folder,modules/package,symlinks=True)
    # Conventional root directories are empty until the service binds durable data.
    for name in ('workspace','root/skivu-home','tmp','proc','dev','opt/skivu'):(root/name).mkdir(parents=True,exist_ok=True)
    shutil.copyfile(PROJECT/'THIRD-PARTY.md',root/'opt/skivu/THIRD-PARTY.md')
    shutil.copyfile(PROJECT/'LICENSE',root/'opt/skivu/COPYING')
    (root/'tmp').chmod(0o700)
    ndk=Path(args.ndk)/'toolchains/llvm/prebuilt/linux-x86_64/bin'
    triple='aarch64-linux-android26' if abi=='arm64-v8a' else 'x86_64-linux-android26'
    helper=PROJECT/'native'/('rename-excl-arm64.S' if abi=='arm64-v8a' else 'rename-excl-x86_64.S')
    subprocess.run([str(ndk/(triple+'-clang')),'-nostdlib','-static','-fuse-ld=lld','-Wl,-e,_start',str(helper),'-o',str(root/'opt/skivu/rename-excl')],check=True)
    (root/'opt/skivu/rename-excl').chmod(0o755)
    output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
    archive_tree(root,output/'runtime.bin')
    metadata={'version':1,'dshVersion':'0.2.1-rc.2','nodeVersion':'24.18.1','abi':abi,'sha256':digest(output/'runtime.bin'),
        'inputs':{'base':args.base_sha256,'node':args.node_sha256,'npmLock':digest(PROJECT/'tools/npm/package-lock.json')}}
    (output/'runtime.json').write_text(json.dumps(metadata,indent=2)+'\n')
    native=PROJECT/'app/src/main/jniLibs'/abi;native.mkdir(parents=True,exist_ok=True)
    for src,name in [(args.proot,'libproot.so'),(args.loader,'libprootloader.so')]:shutil.copyfile(src,native/name)
    subprocess.run([str(ndk/(triple+'-clang')),'-shared','-fPIC','-O2','-Wl,-z,max-page-size=16384',str(PROJECT/'native/runtime.c'),'-o',str(native/'libruntime.so')],check=True)
    print(json.dumps(metadata))

if __name__=='__main__':main()
