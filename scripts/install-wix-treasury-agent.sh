#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
repository_dir="${script_dir:h}"
source_app="$repository_dir/.build/wix-treasury-agent/SP Wix Automação.app"
darwin_user="$(id -un)"
darwin_user_dir="$(dscl . -read "/Users/$darwin_user" NFSHomeDirectory | awk '{print $2}')"
install_dir="$darwin_user_dir/Applications"
installed_app="$install_dir/SP Wix Automação.app"
backup_dir="$darwin_user_dir/Library/Application Support/SP Wix Automação/Backups"

if [[ ! -d "$source_app" ]]; then
  "$script_dir/build-wix-treasury-agent.sh" >/dev/null
fi

mkdir -p "$install_dir"

if [[ -d "$installed_app" ]]; then
  backup_suffix="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$backup_dir"
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$installed_app" || true
  mv "$installed_app" "$backup_dir/SP Wix Automação-$backup_suffix.backup"
fi

ditto --norsrc "$source_app" "$installed_app"
xattr -cr "$installed_app"
codesign --force --deep --sign - "$installed_app" >/dev/null
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$installed_app"
/usr/bin/swift -e 'import Foundation; import CoreServices; let scheme: CFString = "spwix" as CFString; let bundle: CFString = "br.com.spassessoria.wixtreasury" as CFString; let result = LSSetDefaultHandlerForURLScheme(scheme, bundle); exit(result == 0 ? EXIT_SUCCESS : EXIT_FAILURE)' >/dev/null

echo "$installed_app"
