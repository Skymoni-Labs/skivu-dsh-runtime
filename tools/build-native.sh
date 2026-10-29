#!/bin/bash
set -euo pipefail
# Linux/WSL; build paths must be new and separate from the checked-in sources.
project="$(cd "$(dirname "$0")/.." && pwd)"
abi="${1:?arm64-v8a or x86_64}"
out="${2:?new absolute build directory}"
case "$abi" in
 arm64-v8a) triple=aarch64-linux-android26 ;;
 x86_64) triple=x86_64-linux-android26 ;;
 *) exit 2 ;;
esac
test ! -e "$out"
mkdir -p "$out/talloc/include" "$out/talloc/lib"
ndk="${ANDROID_NDK_HOME:?point to Android NDK r29 beta4}"
bin="$ndk/toolchains/llvm/prebuilt/linux-x86_64/bin"
t="$out/talloc"
src="$project/third_party/talloc"
cp "$project/native/talloc-config.h" "$t/config.h"
cp "$src/talloc.h" "$t/include/"
"$bin/$triple-clang" -O2 -fPIC -fvisibility=hidden -D__STDC_WANT_LIB_EXT1__=1 \
 -DTALLOC_BUILD_VERSION_MAJOR=2 -DTALLOC_BUILD_VERSION_MINOR=4 -DTALLOC_BUILD_VERSION_RELEASE=3 \
 -I"$t" -I"$src" -I"$src/lib/replace" -c "$src/talloc.c" -o "$t/talloc.o"
"$bin/llvm-ar" rcs "$t/lib/libtalloc.a" "$t/talloc.o"
cp -R "$project/third_party/proot/src" "$out/proot"
cd "$out/proot"
make -j4 \
 CC="$bin/$triple-clang" LD="$bin/$triple-clang" STRIP="$bin/llvm-strip" \
 OBJCOPY="$bin/llvm-objcopy" OBJDUMP="$bin/llvm-objdump" \
 CFLAGS="-Wall -Wextra -O2 -I$t/include" LDFLAGS="-L$t/lib -ltalloc -ldl -Wl,-z,noexecstack" proot
dest="$project/app/src/main/jniLibs/$abi"
mkdir -p "$dest"
cp proot "$dest/libproot.so"
cp loader/loader "$dest/libprootloader.so"
"$bin/$triple-clang" -shared -fPIC -O2 -Wl,-z,max-page-size=16384 \
 "$project/native/runtime.c" -o "$dest/libruntime.so"
