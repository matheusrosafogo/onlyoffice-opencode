{
  self,
}:

{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.onlyoffice-opencode;

  normalUsers = lib.filter (user: user.isNormalUser) (lib.attrValues config.users.users);
  defaultUser = if normalUsers == [ ] then "root" else (builtins.head normalUsers).name;

  user = config.users.users.${cfg.user};
  home = user.home;

  plugin = pkgs.callPackage ./plugin.nix {
    bridgePort = cfg.port;
    bridgeToken = cfg.token;
  };
  bridge = pkgs.callPackage ./bridge.nix { };

  stateDir = "${home}/.local/state/onlyoffice-opencode";
  workspace = "${home}/.local/share/onlyoffice-opencode/workspace";

  opencodeBin = if cfg.opencodeBin != null then cfg.opencodeBin else "${home}/.opencode/bin/opencode";

  pluginRootData = "${home}/.local/share/onlyoffice/desktopeditors/data/sdkjs-plugins";
  pluginRootDocs = "${home}/.local/share/onlyoffice/desktopeditors/sdkjs-plugins";

  pluginTarget = "${plugin}/share/onlyoffice/sdkjs-plugins/${plugin.guid}";

  execStart = lib.concatStringsSep " " (
    [
      "${bridge}/bin/onlyoffice-opencode-bridge"
      "--port"
      (toString cfg.port)
      "--token"
      (lib.escapeShellArg cfg.token)
      "--opencode"
      (lib.escapeShellArg opencodeBin)
      "--state-dir"
      (lib.escapeShellArg stateDir)
      "--workspace"
      (lib.escapeShellArg workspace)
      "--max-context-chars"
      (toString cfg.maxContextChars)
    ]
    ++ lib.optional cfg.isolateDatabase "--isolate-db"
  );
in
{
  options.services.onlyoffice-opencode = {
    enable = lib.mkEnableOption "integração do OpenCode com o ONLYOFFICE Desktop Editors";

    user = lib.mkOption {
      type = lib.types.str;
      default = defaultUser;
      description = "Usuário dono do plugin e do serviço do bridge.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 18765;
      description = "Porta HTTP local do bridge.";
    };

    token = lib.mkOption {
      type = lib.types.str;
      default = "onlyoffice-opencode-local";
      description = "Token exigido pelo bridge nas requisições do plugin.";
    };

    opencodeBin = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Binário do OpenCode. Por padrão usa ~/.opencode/bin/opencode.";
    };

    isolateDatabase = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Usa um banco isolado do OpenCode e copia as credenciais do banco principal.";
    };

    maxContextChars = lib.mkOption {
      type = lib.types.int;
      default = 200000;
      description = "Limite de caracteres do documento enviado ao modelo.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = builtins.match "[A-Za-z0-9._:-]+" cfg.token != null;
        message = "services.onlyoffice-opencode.token deve conter apenas letras, números, ponto, hífen, dois-pontos e sublinhado.";
      }
      {
        assertion = builtins.hasAttr cfg.user config.users.users;
        message = "services.onlyoffice-opencode.user aponta para um usuário inexistente.";
      }
    ];

    systemd.tmpfiles.rules = [
      "d ${home}/.local/share/onlyoffice/desktopeditors 0755 ${cfg.user} ${user.group} -"
      "d ${home}/.local/share/onlyoffice/desktopeditors/data 0755 ${cfg.user} ${user.group} -"
      "d ${pluginRootData} 0755 ${cfg.user} ${user.group} -"
      "L+ ${pluginRootData}/${plugin.guid} - - - - ${pluginTarget}"
      "d ${pluginRootDocs} 0755 ${cfg.user} ${user.group} -"
      "L+ ${pluginRootDocs}/${plugin.guid} - - - - ${pluginTarget}"
      "d ${stateDir} 0700 ${cfg.user} ${user.group} -"
      "d ${workspace} 0700 ${cfg.user} ${user.group} -"
    ];

    systemd.services.opencode-onlyoffice = {
      description = "OpenCode bridge for ONLYOFFICE";
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ];

      environment = {
        HOME = home;
        XDG_CONFIG_HOME = "${home}/.config";
        XDG_DATA_HOME = "${home}/.local/share";
        XDG_STATE_HOME = "${home}/.local/state";
        PATH = lib.mkForce (
          lib.concatStringsSep ":" [
            "/run/current-system/sw/bin"
            "/run/wrappers/bin"
            "${home}/.nix-profile/bin"
            "${home}/.local/bin"
          ]
        );
      };

      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = user.group;
        WorkingDirectory = stateDir;
        ExecStart = execStart;
        Restart = "always";
        RestartSec = "3s";
        UMask = "0077";
      };
    };
  };
}
