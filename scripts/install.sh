#!/usr/bin/env bash
set -euo pipefail

# Valores substituídos pelo Nix (installer.nix).
PLUGIN_DIR="@PLUGIN_DIR@"
BRIDGE_BIN="@BRIDGE_BIN@"
BRIDGE_STORE="@BRIDGE_STORE@"
GUID="@GUID@"
SERVICE_NAME="opencode-onlyoffice.service"

PORT="${OPENCODE_ONLYOFFICE_PORT:-18765}"
TOKEN="${OPENCODE_ONLYOFFICE_TOKEN:-onlyoffice-opencode-local}"
MODE="all"
START=1
PURGE=0
UNINSTALL=0

usage() {
	cat <<'EOF'
Instalador local do OpenCode para ONLYOFFICE Desktop Editors.

Uso:
  onlyoffice-opencode-install [opções]

Opções:
  --port <porta>       Porta do bridge (padrão: 18765)
  --token <token>      Token do bridge (padrão: onlyoffice-opencode-local)
  --plugin-only        Instala apenas o plugin (não mexe no serviço)
  --bridge-only        Instala apenas o serviço do bridge
  --no-start           Instala o serviço mas não o inicia agora
  --uninstall          Remove o plugin e/ou o serviço
  --purge              Com --uninstall, remove também estado e workspace
  --help, -h           Mostra esta ajuda
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	--port)
		PORT="${2:?Faltou valor para --port}"
		shift 2
		;;
	--port=*)
		PORT="${1#*=}"
		shift
		;;
	--token)
		TOKEN="${2:?Faltou valor para --token}"
		shift 2
		;;
	--token=*)
		TOKEN="${1#*=}"
		shift
		;;
	--plugin-only)
		MODE="plugin"
		shift
		;;
	--bridge-only)
		MODE="bridge"
		shift
		;;
	--no-start)
		START=0
		shift
		;;
	--uninstall)
		UNINSTALL=1
		shift
		;;
	--purge)
		PURGE=1
		shift
		;;
	--help | -h)
		usage
		exit 0
		;;
	*)
		echo "Opção desconhecida: $1" >&2
		usage >&2
		exit 2
		;;
	esac
done

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || ((PORT < 1 || PORT > 65535)); then
	echo "Porta inválida: $PORT" >&2
	exit 2
fi

if ! [[ "$TOKEN" =~ ^[A-Za-z0-9._:-]+$ ]]; then
	echo "Token inválido: use apenas letras, números, ponto, hífen, dois-pontos e sublinhado." >&2
	exit 2
fi

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"

PLUGIN_BASE="$DATA_HOME/onlyoffice/desktopeditors"
STATE_DIR="$STATE_HOME/onlyoffice-opencode"
WORKSPACE="$DATA_HOME/onlyoffice-opencode/workspace"
UNIT_DIR="$CONFIG_HOME/systemd/user"
UNIT_FILE="$UNIT_DIR/$SERVICE_NAME"
GC_ROOT="$STATE_DIR/bridge-gc-root"
OPENCODE_BIN="${OPENCODE_BIN:-$HOME/.opencode/bin/opencode}"

find_plugin_dir() {
	local candidates=(
		"$PLUGIN_BASE/data/sdkjs-plugins"
		"$PLUGIN_BASE/sdkjs-plugins"
	)
	local dir

	for dir in "${candidates[@]}"; do
		if [[ -d "$dir" ]]; then
			printf '%s\n' "$dir"
			return 0
		fi
	done

	mkdir -p "${candidates[0]}"
	printf '%s\n' "${candidates[0]}"
}

install_plugin() {
	local dir
	dir="$(find_plugin_dir)"

	mkdir -p "$dir"
	rm -rf "${dir:?}/$GUID"
	cp -R "$PLUGIN_DIR" "$dir/$GUID"
	chmod -R u+w "$dir/$GUID"

	cat >"$dir/$GUID/scripts/bridge-config.js" <<EOF
window.OPENCODE_BRIDGE = { url: "http://127.0.0.1:$PORT", token: "$TOKEN" };
EOF

	echo "Plugin instalado em $dir/$GUID"
}

install_bridge() {
	mkdir -p "$STATE_DIR" "$WORKSPACE" "$UNIT_DIR"

	if command -v nix-store >/dev/null 2>&1; then
		nix-store --add-root "$GC_ROOT" --indirect -r "$BRIDGE_STORE" >/dev/null
	else
		ln -sfn "$BRIDGE_STORE" "$GC_ROOT"
	fi

	if [[ ! -x "$OPENCODE_BIN" ]]; then
		echo "Aviso: $OPENCODE_BIN não encontrado ou sem permissão de execução." >&2
		echo "O serviço vai falhar até o OpenCode ser instalado/atualizado." >&2
	fi

	local unit_token="${TOKEN//%/%%}"

	cat >"$UNIT_FILE" <<EOF
[Unit]
Description=OpenCode bridge for ONLYOFFICE
Documentation=https://github.com/matheusrosafogo/onlyoffice-opencode
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$BRIDGE_BIN --port $PORT --token "$unit_token" --opencode "$OPENCODE_BIN" --state-dir "$STATE_DIR" --workspace "$WORKSPACE" --isolate-db
Restart=always
RestartSec=3
Environment=HOME=%h
Environment=XDG_CONFIG_HOME=%h/.config
Environment=XDG_DATA_HOME=%h/.local/share
Environment=XDG_STATE_HOME=%h/.local/state
Environment=PATH=/run/current-system/sw/bin:/run/wrappers/bin:%h/.nix-profile/bin:%h/.local/bin

[Install]
WantedBy=default.target
EOF

	echo "Serviço instalado em $UNIT_FILE"

	if [[ "$START" -eq 1 ]]; then
		systemctl --user daemon-reload
		systemctl --user enable "$SERVICE_NAME"
		# restart em vez de start: atualiza o binário quando o serviço já estava ativo
		systemctl --user restart "$SERVICE_NAME"
		echo "Serviço iniciado. Veja o status com: systemctl --user status $SERVICE_NAME"
	else
		echo "Serviço não iniciado (--no-start). Ative depois com:"
		echo "  systemctl --user daemon-reload && systemctl --user enable --now $SERVICE_NAME"
	fi
}

uninstall() {
	if [[ "$MODE" != "plugin" ]]; then
		systemctl --user disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
		rm -f "$UNIT_FILE"
		systemctl --user daemon-reload >/dev/null 2>&1 || true
		rm -f "$GC_ROOT"
		echo "Serviço removido."
	fi

	if [[ "$MODE" != "bridge" ]]; then
		local dir
		for dir in "$PLUGIN_BASE/data/sdkjs-plugins" "$PLUGIN_BASE/sdkjs-plugins"; do
			rm -rf "${dir:?}/$GUID"
		done
		echo "Plugin removido."
	fi

	if [[ "$PURGE" -eq 1 ]]; then
		rm -rf "$STATE_DIR" "$DATA_HOME/onlyoffice-opencode"
		echo "Estado e workspace removidos."
	fi
}

if [[ "$UNINSTALL" -eq 1 ]]; then
	uninstall
	exit 0
fi

case "$MODE" in
all)
	install_plugin
	install_bridge
	;;
plugin)
	install_plugin
	;;
bridge)
	install_bridge
	;;
*)
	echo "Modo inválido: $MODE" >&2
	exit 2
	;;
esac

cat <<EOF

Próximos passos:
  1. Abra o ONLYOFFICE Desktop Editors (versão Nix, não o Flatpak).
  2. Vá em Plugins → OpenCode.
  3. Logs do bridge: journalctl --user -u $SERVICE_NAME -f
  4. Para remover: $(basename "$0") --uninstall [--purge]
EOF
