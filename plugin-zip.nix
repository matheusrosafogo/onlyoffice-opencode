{
  lib,
  stdenvNoCC,
  zip,
  plugin,
}:

stdenvNoCC.mkDerivation {
  pname = "onlyoffice-opencode-plugin-zip";
  version = "0.3.1";

  nativeBuildInputs = [ zip ];

  buildCommand = ''
    mkdir -p "$out"
    cd "${plugin}/share/onlyoffice/sdkjs-plugins/${plugin.guid}"
    zip -r -X "$out/onlyoffice-opencode.plugin" .
  '';

  meta = {
    description = "Arquivo .plugin instalável pelo Plugin Manager do ONLYOFFICE";
    homepage = "https://github.com/matheusrosafogo/onlyoffice-opencode";
    license = lib.licenses.mit;
    platforms = lib.platforms.all;
  };
}
