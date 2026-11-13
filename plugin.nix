{
  lib,
  stdenvNoCC,
  bridgePort ? 18765,
  bridgeToken ? "onlyoffice-opencode-local",
}:

let
  config = builtins.fromJSON (builtins.readFile ./plugin/config.json);
  guid = lib.removePrefix "asc." config.guid;
  tokenJson = builtins.toJSON bridgeToken;
in
stdenvNoCC.mkDerivation {
  pname = "onlyoffice-opencode-plugin";
  version = "0.1.0";

  src = ./plugin;
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/share/onlyoffice/sdkjs-plugins/${guid}"
    cp -R . "$out/share/onlyoffice/sdkjs-plugins/${guid}"
    chmod -R u+w "$out/share/onlyoffice/sdkjs-plugins/${guid}"

    cat > "$out/share/onlyoffice/sdkjs-plugins/${guid}/scripts/bridge-config.js" <<EOF
    window.OPENCODE_BRIDGE = { url: "http://127.0.0.1:${toString bridgePort}", token: ${tokenJson} };
    EOF

    runHook postInstall
  '';

  passthru = { inherit guid; };

  meta = {
    description = "Plugin do OpenCode para o ONLYOFFICE Desktop Editors";
    homepage = "https://github.com/matheusrosafogo/onlyoffice-opencode";
    license = lib.licenses.mit;
    platforms = lib.platforms.all;
  };
}
