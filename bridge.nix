{
  lib,
  stdenvNoCC,
  nodejs,
  makeWrapper,
}:

stdenvNoCC.mkDerivation {
  pname = "onlyoffice-opencode-bridge";
  version = "0.2.0";

  src = ./bridge;
  dontBuild = true;

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/share/onlyoffice-opencode-bridge" "$out/bin"
    cp -R . "$out/share/onlyoffice-opencode-bridge"
    chmod -R u+w "$out/share/onlyoffice-opencode-bridge"

    makeWrapper ${nodejs}/bin/node "$out/bin/onlyoffice-opencode-bridge" \
      --add-flags "$out/share/onlyoffice-opencode-bridge/server.mjs"

    runHook postInstall
  '';

  meta = {
    description = "Bridge local entre o ONLYOFFICE Desktop Editors e o OpenCode V2";
    homepage = "https://github.com/matheusrosafogo/onlyoffice-opencode";
    license = lib.licenses.mit;
    platforms = lib.platforms.all;
  };
}
