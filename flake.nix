{
  description = "OpenCode como agente de IA dentro do ONLYOFFICE Desktop Editors";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: import nixpkgs { inherit system; };
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          plugin = pkgs.callPackage ./plugin.nix { };
          bridge = pkgs.callPackage ./bridge.nix { };
        in
        {
          default = plugin;
          plugin = plugin;
          bridge = bridge;
          plugin-zip = pkgs.callPackage ./plugin-zip.nix { inherit plugin; };
          installer = pkgs.callPackage ./installer.nix { inherit plugin bridge; };
        }
      );

      apps = forAllSystems (
        system:
        let
          install = {
            type = "app";
            program = "${self.packages.${system}.installer}/bin/onlyoffice-opencode-install";
            meta = {
              description = "Instala o plugin e o serviço do bridge para o ONLYOFFICE";
            };
          };
          bridge = {
            type = "app";
            program = "${self.packages.${system}.bridge}/bin/onlyoffice-opencode-bridge";
            meta = {
              description = "Roda o bridge do OpenCode para o ONLYOFFICE em foreground";
            };
          };
        in
        {
          default = install;
          install = install;
          bridge = bridge;
        }
      );

      nixosModules = {
        default = import ./module.nix { inherit self; };
        onlyoffice-opencode = self.nixosModules.default;
      };

      checks = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          tests =
            pkgs.runCommand "onlyoffice-opencode-tests"
              {
                nativeBuildInputs = [ pkgs.nodejs ];
                src = ./bridge;
              }
              ''
                cp -R "$src" bridge
                cd bridge
                node --test test/*.test.mjs

                for file in ${./plugin}/scripts/*.js; do
                  node --check "$file"
                done

                touch "$out"
              '';
        }
      );

      formatter = forAllSystems (system: (pkgsFor system).nixfmt);
    };
}
