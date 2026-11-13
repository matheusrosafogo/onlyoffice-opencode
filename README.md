# OpenCode para ONLYOFFICE Desktop Editors

Plugin que integra o [OpenCode](https://opencode.ai) ao ONLYOFFICE Desktop
Editors. O painel direito conversa com o documento atual, usa os modelos e
agentes configurados no seu OpenCode e permite copiar, inserir ou substituir o
texto gerado.

> **Importante:** este projeto atende à versão do ONLYOFFICE instalada pelo
> Nix. A versão Flatpak não enxerga `/nix/store` e não é suportada pelo
> instalador.

## Funcionalidades

- Painel lateral com chat e streaming em tempo real.
- Contexto do documento inteiro em cada mensagem (desativável nas
  configurações), com a seleção atual destacada.
- Extração específica por editor:
  - Writer: Markdown do documento.
  - Planilha: intervalo usado da aba ativa.
  - Apresentação: texto dos shapes de cada slide.
  - PDF: somente a seleção.
- Ações por resposta: **Copiar**, **Inserir no cursor** e
  **Substituir seleção**.
- Inserção formatada no Writer: títulos, negrito, itálico, listas, tabelas e
  blocos de código são convertidos de Markdown para HTML e aplicados com
  `PasteHtml`.
- Formatação avançada via bloco `office-doc`: fontes, tamanhos, cores,
  espaçamento, alinhamento, margens, quebras de página, tabelas nativas e
  caixas de texto/quadros.
- Track Changes no Writer: inserir ou substituir conteúdo como revisão
  atribuída a "OpenCode", com aceitar/rejeitar na aba Revisão.
- Ações rápidas: resumir, revisar, melhorar escrita, traduzir, explicar e
  layout avançado.
- Modelos e agentes lidos da configuração global do OpenCode.
- Permissões (`permission.asked`) podem ser respondidas no próprio painel.
- Sessão persistente por documento.
- Banco isolado do OpenCode, com cópia automática das credenciais do banco
  principal.
- Tema claro/escuro e interface em português e inglês.

## Arquitetura

```text
ONLYOFFICE Desktop Editors
  └─ plugin OpenCode (painel direito, HTML/CSS/JS)
        │ HTTP local + token
        ▼
  bridge Node (127.0.0.1:18765)
        │ HTTP Basic (senha aleatória)
        ▼
  opencode serve (processo filho, banco isolado)
        │
        ▼
  modelo escolhido no OpenCode
```

O **bridge** existe porque o plugin roda em um iframe sandboxed e não pode
iniciar processos. Ele esconde a senha do OpenCode, monta o prompt com o
contexto do documento, mapeia documento → sessão e repassa o streaming.

## Requisitos

- ONLYOFFICE Desktop Editors 10.0.0 ou superior, instalado pelo Nix.
- OpenCode 2.2.x ou superior em `~/.opencode/bin/opencode`.
- Um provedor/modelo configurado no OpenCode.
- Nix com flakes habilitado para instalar o plugin/bridge.

## Instalação declarativa (NixOS)

O repositório expõe um módulo NixOS. No seu `configuration.nix` (ou em
`packages/pkgs.nix`):

```nix
let
  # Pine uma tag ou revisão para atualizações previsíveis:
  oc = builtins.getFlake "github:matheusrosafogo/onlyoffice-opencode/v0.3.0";
in
{
  imports = [ oc.nixosModules.default ];

  services.onlyoffice-opencode = {
    enable = true;
    user = "seu-usuario";
  };
}
```

> Prefira fixar uma tag ou revisão (`.../v0.3.0` ou `.../<commit>`). O
> `builtins.getFlake` sem revisão pode continuar usando uma resolução em cache
> até você forçar a atualização do flake.

Depois:

```bash
sudo nixos-rebuild switch
```

O módulo instala o plugin em
`~/.local/share/onlyoffice/desktopeditors/data/sdkjs-plugins/<GUID>` e cria o
serviço `opencode-onlyoffice`.

Opções disponíveis:

| Opção             | Padrão                      | Descrição                             |
| ----------------- | --------------------------- | ------------------------------------- |
| `enable`          | `false`                     | Liga a integração                     |
| `user`            | primeiro usuário normal     | Dono do plugin/serviço                |
| `port`            | `18765`                     | Porta local do bridge                 |
| `token`           | `onlyoffice-opencode-local` | Token exigido pelo bridge             |
| `opencodeBin`     | `~/.opencode/bin/opencode`  | Binário do OpenCode                   |
| `isolateDatabase` | `true`                      | Usa banco isolado e copia credenciais |
| `maxContextChars` | `200000`                    | Limite de caracteres do documento     |

## Instalação manual (sem alterar o NixOS)

Há dois artefatos:

1. **`.plugin`** — a interface do plugin.
2. **Bridge** — o serviço local que fala com o OpenCode.

### 1. Plugin

Baixe `onlyoffice-opencode.plugin` em
[Releases](https://github.com/matheusrosafogo/onlyoffice-opencode/releases) ou
construa localmente:

```bash
nix build github:matheusrosafogo/onlyoffice-opencode#plugin-zip
# result/onlyoffice-opencode.plugin
```

No ONLYOFFICE: **Plugins → Plugin Manager → Install plugin manually** e escolha
o arquivo.

### 2. Bridge

Com o plugin já instalado, instale apenas o serviço:

```bash
nix run github:matheusrosafogo/onlyoffice-opencode#install -- --bridge-only
```

Ou instale plugin + bridge de uma vez (o instalador copia o plugin e cria o
serviço):

```bash
nix run github:matheusrosafogo/onlyoffice-opencode#install
```

O instalador:

- copia o plugin para a pasta do ONLYOFFICE;
- grava `~/.config/systemd/user/opencode-onlyoffice.service`;
- ativa e inicia o serviço do usuário;
- mantém o binário do bridge no store via GC root.

Status e logs:

```bash
systemctl --user status opencode-onlyoffice
journalctl --user -u opencode-onlyoffice -f
```

### Opções do instalador

```text
--port <porta>       Porta do bridge (padrão: 18765)
--token <token>      Token do bridge
--plugin-only        Instala apenas o plugin
--bridge-only        Instala apenas o serviço
--no-start           Não inicia o serviço agora
--uninstall          Remove plugin e/ou serviço
--purge              Com --uninstall, remove estado e workspace
```

Para remover tudo:

```bash
nix run github:matheusrosafogo/onlyoffice-opencode#install -- --uninstall --purge
```

> Não use a instalação manual e o módulo NixOS ao mesmo tempo: os dois tentam
> ocupar a mesma porta e o mesmo serviço.

## Uso

1. Abra um documento no ONLYOFFICE.
2. Abra o painel **OpenCode** (barra lateral direita ou aba **Plugins**).
3. Selecione um trecho, se quiser, e escreva a pergunta.
4. Use as ações rápidas ou **Ctrl+Enter** para enviar.
5. Na resposta, use **Copiar**, **Inserir no cursor** ou
   **Substituir seleção**.

O seletor de modelo e agente fica em **Configurações**. A opção “Enviar o
documento inteiro nas mensagens” vem ligada por padrão; o conteúdo é truncado
quando não cabe na janela do modelo.

## Como funciona a inserção e a formatação

O agente **não edita o documento diretamente**. Ele lê o contexto, gera a
resposta em Markdown e o plugin aplica o resultado quando você clica em
**Inserir no cursor** ou **Substituir seleção**:

- **Writer:** o Markdown é convertido para HTML e inserido com `PasteHtml`.
  Títulos (`##`), negrito, itálico, listas, tabelas, citações e blocos de
  código são preservados. Em **Substituir seleção**, a seleção atual é apagada
  e o HTML formatado é inserido no lugar.
- **Planilha e apresentação:** a inserção usa `PasteText` (texto simples),
  porque a API de plugins do ONLYOFFICE expõe `PasteHtml` apenas para o editor
  de texto.
- **PDF:** somente leitura; a inserção fica desabilitada.

A opção **“Aplicar formatação ao inserir no Writer (Markdown)”** vem ligada por
padrão e pode ser desligada nas configurações para inserir texto puro.

Se você pedir “gere três seções com títulos e uma lista”, o modelo devolve
Markdown estruturado e o Writer recebe os títulos e a lista já formatados.

### Formatação avançada com `office-doc`

Para fontes específicas, tamanhos, cores, espaçamento, alinhamento, margens,
quebras de página, tabelas nativas e quadros/caixas de texto, o modelo usa um
bloco JSON `office-doc`. O plugin aplica o bloco diretamente pela Office API,
sem passar por HTML:

````markdown
```office-doc
{
  "page": { "marginsCm": { "top": 2.5, "bottom": 2.5, "left": 2, "right": 2 } },
  "blocks": [
    {
      "type": "heading",
      "level": 1,
      "text": "Relatório",
      "font": "Arial",
      "size": 18,
      "color": "#1F4E79",
      "align": "center"
    },
    {
      "type": "paragraph",
      "align": "justify",
      "lineSpacing": 1.5,
      "runs": [
        { "text": "Texto normal. " },
        { "text": "Importante", "bold": true, "color": "#C00000" }
      ]
    },
    {
      "type": "table",
      "header": true,
      "rows": [
        [{ "text": "Item", "bold": true }, { "text": "Valor", "bold": true }],
        [{ "text": "Total" }, { "text": "10" }]
      ]
    },
    {
      "type": "textBox",
      "widthCm": 10,
      "heightCm": 4,
      "fill": "#FFF2CC",
      "borderColor": "#BF9000",
      "runs": [{ "text": "Nota", "bold": true }]
    }
  ]
}
```
````

Campos suportados:

- Texto: `font`, `size` (pontos), `color` (`#RRGGBB`), `bold`, `italic`,
  `underline`, `letterSpacing`.
- Parágrafo: `align`, `lineSpacing`, `spacingBefore`, `spacingAfter`,
  `indentLeft`, `indentRight`, `indentFirstLine`, `pageBreakBefore`.
- Blocos: `heading`, `paragraph`, `list`, `pageBreak`, `table`, `textBox`.
- Tabelas: `header`, `widthPercent`, `borderColor`, `borderSizePt` e `rows`
  (células com `text`/`runs`, `fill`, `align`, etc.).
- Quadros: `widthCm`, `heightCm`, `fill`, `borderColor`, `borderWidthPt`,
  `verticalAlign` e `paragraphs`.
- Página: `marginsCm` com `top`, `bottom`, `left`, `right`.

O schema completo também fica em `bridge/workspace/AGENTS.md`, que o OpenCode
lê como instruções do workspace. A ação rápida **Layout avançado** pede uma
resposta nesse formato.

### Track Changes

Ative **Revisões** no rodapé do painel ou em **Configurações → Inserir como
Track Changes no Writer**. Ao inserir ou substituir conteúdo, o plugin:

1. verifica se o Track Changes já está ligado;
2. se não estiver, ativa o modo de revisão assistida com autor `OpenCode`;
3. insere o conteúdo como revisão;
4. restaura o estado anterior ao terminar.

As revisões aparecem na aba **Revisão** do ONLYOFFICE, onde você pode
aceitá-las ou rejeitá-las. No bloco `office-doc`, use `"trackChanges": true`
para forçar revisões naquela inserção ou `false` para ignorar a preferência do
painel.

Track Changes é aplicado apenas no Writer. Planilhas e apresentações continuam
com inserção de texto simples; PDFs não são modificados.

## Como funcionam as sessões e as credenciais

O bridge usa um banco isolado do OpenCode (`OPENCODE_DB`) para não misturar as
conversas do painel com as sessões do TUI. Como o OpenCode guarda as conexões
dos provedores no banco principal, o bridge copia a tabela `credential` de
`~/.local/share/opencode/opencode.db` para o banco isolado na primeira execução
(e quando as credenciais mudam). Sessões, mensagens e permissões continuam
separadas.

O mapeamento `documento → sessão` fica em
`~/.local/state/onlyoffice-opencode/sessions.json`.

Se o seu banco principal estiver em outro lugar, use `--main-db <arquivo>` no
bridge. Para compartilhar o banco principal (sem isolamento), use
`--shared-db`; nesse caso não há cópia de credenciais.

## Privacidade e segurança

- O conteúdo do documento é enviado ao provedor do modelo escolhido, como em
  qualquer ferramenta de IA. Desligue “Enviar o documento inteiro” se não quiser
  esse comportamento.
- O agente e as permissões são herdados da configuração global do OpenCode.
  Se você usa um agente com shell/edição, ele terá esses acessos também no
  workspace do painel.
- O bridge escuta apenas em `127.0.0.1`, exige token e responde CORS somente
  para a origem `null` (iframe do ONLYOFFICE) ou para a própria porta.
- A senha do OpenCode usada pelo processo filho é aleatória e vive apenas em
  memória. O token do bridge não é um segredo forte; ele evita requisições
  acidentais de outras páginas, não um processo local malicioso.

## Solução de problemas

### O plugin não aparece

- Confirme que está usando a versão Nix do ONLYOFFICE, não a Flatpak.
- Verifique a pasta:
  ```bash
  ls ~/.local/share/onlyoffice/desktopeditors/data/sdkjs-plugins
  ```
- Reinicie o ONLYOFFICE.
- Abra com o console de depuração:
  ```bash
  onlyoffice-desktopeditors --ascdesktop-support-debug-info
  ```

### O bridge está offline

```bash
systemctl --user status opencode-onlyoffice
journalctl --user -u opencode-onlyoffice -n 100 --no-pager
```

No módulo NixOS, use `systemctl status opencode-onlyoffice` (sem `--user`).

### O OpenCode não foi encontrado

O serviço espera `~/.opencode/bin/opencode`. Instale/atualize o OpenCode ou
ajuste `--opencode` no serviço (`systemctl --user edit opencode-onlyoffice`).

### Modelos indisponíveis

O bridge copia as credenciais do banco principal do OpenCode. Se o banco estiver
em outro caminho, passe `--main-db`. Como alternativa, rode com `--shared-db`
para usar o banco principal diretamente.

### A sessão ficou presa

Use **Nova conversa** no painel. Se necessário, remova o mapeamento:

```bash
rm ~/.local/state/onlyoffice-opencode/sessions.json
systemctl --user restart opencode-onlyoffice
```

### Diagnóstico

Nas configurações do painel há um bloco de diagnóstico e o botão **Copiar
diagnóstico**. Ele inclui editor, documento, sessão, saúde do bridge e
quantidade de modelos/agentes — sem o token.

## Limitações atuais

- Flatpak não suportado.
- PDF é somente leitura; a inserção fica desabilitada.
- Em planilhas e apresentações a inserção é texto simples; formatação rica
  nessas editores fica para uma próxima versão.
- No Writer, o Markdown puro é mapeado para os estilos do ONLYOFFICE (títulos,
  negrito, itálico, listas, tabelas, citações e código). Para fontes, cores,
  tamanhos, espaçamento, margens e alinhamento específicos, use o bloco
  `office-doc`; o modelo é instruído a usá-lo quando você pedir esse nível de
  formatação.
- Comentários automáticos ficam para uma próxima versão. Track Changes já está
  disponível no Writer.
- O agente não edita o documento diretamente; você aplica a resposta com os
  botões do painel.
- Atualizações da instalação manual exigem baixar/reinstalar o `.plugin` e
  rodar o instalador do bridge novamente.

## Desenvolvimento

```bash
# testes do bridge e checagem de sintaxe
nix flake check

# builds
nix build .#plugin .#plugin-zip .#bridge .#installer

# instalar localmente para testar
nix run .#install -- --no-start
```

Estrutura:

```text
plugin/    interface do ONLYOFFICE (HTML/CSS/JS)
bridge/    servidor Node e testes
scripts/   instalador e gerador de ícones
*.nix      empacotamento e módulo NixOS
```

## Licença

MIT.
