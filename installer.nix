{
  lib,
  writeShellApplication,
  coreutils,
  systemd,
  nix,
  plugin,
  bridge,
}:

let
  guid = plugin.guid;
  pluginDir = "${plugin}/share/onlyoffice/sdkjs-plugins/${guid}";
  bridgeBin = "${bridge}/bin/onlyoffice-opencode-bridge";
  bridgeStore = "${bridge}";
in
writeShellApplication {
  name = "onlyoffice-opencode-install";

  runtimeInputs = [
    coreutils
    systemd
    nix
  ];

  text =
    builtins.replaceStrings
      [ "@PLUGIN_DIR@" "@BRIDGE_BIN@" "@BRIDGE_STORE@" "@GUID@" ]
      [ pluginDir bridgeBin bridgeStore guid ]
      (builtins.readFile ./scripts/install.sh);

  meta = {
    description = "Instalador local do OpenCode para o ONLYOFFICE Desktop Editors";
    homepage = "https://github.com/matheusrosafogo/onlyoffice-opencode";
    license = lib.licenses.mit;
    platforms = lib.platforms.all;
  };
}
