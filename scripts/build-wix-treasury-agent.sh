#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
repository_dir="${script_dir:h}"
source_dir="$repository_dir/macos/WixTreasuryAgent"
build_dir="$repository_dir/.build/wix-treasury-agent"
app_dir="$build_dir/SP Wix Automação.app"
temporary_build_dir="$(mktemp -d)"
temporary_app_dir="$temporary_build_dir/SP Wix Automação.app"
contents_dir="$temporary_app_dir/Contents"
executable_dir="$contents_dir/MacOS"

trap 'rm -rf "$temporary_build_dir"' EXIT

expected_app_dir="$repository_dir/.build/wix-treasury-agent/SP Wix Automação.app"
if [[ "$app_dir" != "$expected_app_dir" ]]; then
  echo "Caminho de build inesperado: $app_dir" >&2
  exit 1
fi

mkdir -p "$executable_dir"
cp "$source_dir/Info.plist" "$contents_dir/Info.plist"

swiftc \
  "$source_dir/main.swift" \
  -target arm64-apple-macos13.0 \
  -framework AppKit \
  -framework ApplicationServices \
  -o "$executable_dir/SPWixAutomation"

xattr -cr "$temporary_app_dir"
codesign --force --deep --sign - "$temporary_app_dir" >/dev/null

rm -rf "$app_dir"
mkdir -p "$build_dir"
COPYFILE_DISABLE=1 ditto --norsrc "$temporary_app_dir" "$app_dir"

echo "$app_dir"
